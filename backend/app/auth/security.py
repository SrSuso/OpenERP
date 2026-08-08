"""Password hashing and session token generation.

Argon2id (via ``argon2-cffi``) for passwords — deliberately slow, tuned by
the library's own defaults. SHA-256 for session tokens — deliberately fast,
because the token itself already carries 256 bits of entropy from
:func:`secrets.token_urlsafe`; hashing it the way we hash passwords would
just add latency to every authenticated request for no security benefit.
"""

from __future__ import annotations

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()

#: Bytes of randomness in a session token (before base64url encoding).
SESSION_TOKEN_BYTES = 32


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def generate_session_token() -> str:
    """The raw value sent to the client in the cookie. Only its hash
    (:func:`hash_session_token`) is ever written to the database."""
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
