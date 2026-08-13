"""Canonical client address as normalised by the trusted ASGI server.

The application never reads forwarding headers itself. In production Uvicorn
accepts them only from Nginx's fixed backend-network address; direct local/test
requests keep their socket peer as the client. Keeping this helper tiny avoids
different security-sensitive consumers inventing different IP rules.
"""

from __future__ import annotations

from starlette.requests import Request


def client_ip(request: Request) -> str | None:
    """Return the ASGI peer address, after any trusted-proxy normalisation."""
    if request.client is None:
        return None
    return request.client.host[:64]
