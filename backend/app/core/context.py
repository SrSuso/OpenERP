"""Per-request ambient context.

Holds values that cross-cutting concerns (logging, auditing) need but that we
do not want to thread through every function signature.  Backed by
:mod:`contextvars`, so it is safe under asyncio concurrency.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_request_id: ContextVar[str | None] = ContextVar("openerp_request_id", default=None)
_client_ip: ContextVar[str | None] = ContextVar("openerp_client_ip", default=None)
_user_id: ContextVar[int | None] = ContextVar("openerp_user_id", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex


def get_request_id() -> str | None:
    return _request_id.get()


def get_client_ip() -> str | None:
    return _client_ip.get()


def get_user_id() -> int | None:
    """Authenticated user for the current request, if any.

    Populated by the auth layer in phase 1; the audit log (phase 2) reads it.
    """
    return _user_id.get()


def set_user_id(user_id: int | None) -> None:
    _user_id.set(user_id)


@contextmanager
def request_context(
    *, request_id: str | None = None, client_ip: str | None = None
) -> Iterator[str]:
    """Bind a request id (and client ip) for the duration of the block."""
    rid = request_id or new_request_id()
    tokens = (_request_id.set(rid), _client_ip.set(client_ip), _user_id.set(None))
    try:
        yield rid
    finally:
        _request_id.reset(tokens[0])
        _client_ip.reset(tokens[1])
        _user_id.reset(tokens[2])
