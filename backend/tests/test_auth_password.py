"""Password hashing (app.auth.security)."""

from __future__ import annotations

from app.auth.security import hash_password, verify_password


def test_hash_is_not_the_plaintext() -> None:
    hashed = hash_password("correct horse battery staple")
    assert hashed != "correct horse battery staple"
    assert hashed.startswith("$argon2")


def test_verify_accepts_the_right_password() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_rejects_the_wrong_password() -> None:
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_hash_is_salted() -> None:
    """Hashing the same password twice must not produce the same digest."""
    assert hash_password("same password") != hash_password("same password")
