"""Async engine and session management.

One engine per process, created lazily.  Request handlers get a session via the
:func:`get_session` dependency; scripts and the worker use
:func:`session_scope`.

Transaction policy: a session yielded by :func:`get_session` commits when the
handler returns normally and rolls back on any exception.  ``SessionDep`` uses
FastAPI's function scope so this finalisation happens before any HTTP response
is sent.  Multi-step business operations (a checkout, a goods receipt)
therefore land as a single database transaction without each service having to
manage one.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings, get_settings
from app.core.errors import ConflictError
from app.core.logging import get_logger

logger = get_logger(__name__)

_READ_ONLY_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_CONFLICT_SQLSTATES = frozenset(
    {
        "23503",  # foreign_key_violation
        "23505",  # unique_violation
        "23P01",  # exclusion_violation
    }
)

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def create_engine(settings: Settings | None = None) -> AsyncEngine:
    """Build a new engine.  Prefer :func:`get_engine` outside of tests."""
    settings = settings or get_settings()
    return create_async_engine(
        settings.async_database_url,
        echo=settings.db_echo,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=settings.db_pool_pre_ping,
        connect_args={
            "options": f"-c statement_timeout={settings.db_statement_timeout_ms}",
        },
    )


def get_engine() -> AsyncEngine:
    """Process-wide engine, created on first use."""
    global _engine
    if _engine is None:
        _engine = create_engine()
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _sessionmaker


async def dispose_engine() -> None:
    """Close pooled connections.  Called on application shutdown."""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessionmaker = None


async def _rollback_after_error(session: AsyncSession) -> None:
    """Best-effort rollback that never hides the original request error."""
    try:
        await session.rollback()
    except Exception:
        logger.exception("database.rollback_failed")


def _has_pending_orm_changes(session: AsyncSession) -> bool:
    return bool(session.new or session.dirty or session.deleted)


async def _commit_request(session: AsyncSession) -> None:
    try:
        await session.commit()
    except IntegrityError as exc:
        await _rollback_after_error(session)
        sqlstate = getattr(exc.orig, "sqlstate", None)
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if sqlstate in _CONFLICT_SQLSTATES:
            logger.warning(
                "database.commit_conflict",
                extra={"sqlstate": sqlstate, "constraint": constraint},
            )
            raise ConflictError("The operation conflicts with the current database state.") from exc
        logger.error(
            "database.commit_integrity_error",
            extra={"sqlstate": sqlstate, "constraint": constraint},
        )
        raise
    except Exception:
        await _rollback_after_error(session)
        logger.error("database.commit_failed")
        raise


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one transaction per request.

    Mutating requests commit centrally.  A read-only request closes its read
    transaction with rollback unless authentication's sliding-expiry policy
    actually dirtied an ORM object, in which case that small write is committed.
    """
    async with get_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await _rollback_after_error(session)
            raise
        else:
            if request.method in _READ_ONLY_METHODS and not _has_pending_orm_changes(session):
                await session.rollback()
            else:
                await _commit_request(session)


# The function-scoped dependency finalises (commit/rollback and session close)
# after the endpoint has produced a response object, but before ASGI sends the
# HTTP response to the client.  Keep this alias central: every request router
# imports it, so future endpoints inherit the same transaction boundary.
SessionDep = Annotated[AsyncSession, Depends(get_session, scope="function")]


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Transactional scope for scripts, jobs and the worker."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await _rollback_after_error(session)
            raise
