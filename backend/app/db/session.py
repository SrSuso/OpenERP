"""Async engine and session management.

One engine per process, created lazily.  Request handlers get a session via the
:func:`get_session` dependency; scripts and the worker use
:func:`session_scope`.

Transaction policy: a session yielded by :func:`get_session` commits when the
handler returns normally and rolls back on any exception.  Multi-step business
operations (a checkout, a goods receipt) therefore land as a single database
transaction without each service having to manage one.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings, get_settings

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


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one transaction per request."""
    async with get_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Transactional scope for scripts, jobs and the worker."""
    async with get_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()
