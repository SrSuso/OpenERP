"""Server-side QZ Tray message signing.

QZ sends a SHA-256 digest of each protected WebSocket call. OpenERP signs that
short digest with SHA-512/RSA, keeping the private key out of React, PostgreSQL
and Git. The public certificate is returned to an authenticated browser so QZ
can identify the site before accepting silent print calls.
"""

from __future__ import annotations

import base64
from functools import lru_cache

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa


@lru_cache(maxsize=2)
def _load_material(certificate_pem: str, private_key_pem: str) -> rsa.RSAPrivateKey:
    try:
        certificate = x509.load_pem_x509_certificate(certificate_pem.encode("utf-8"))
        key = serialization.load_pem_private_key(private_key_pem.encode("utf-8"), password=None)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid QZ signing certificate or private key.") from exc
    if not isinstance(key, rsa.RSAPrivateKey):
        raise ValueError("QZ signing requires an RSA private key.")
    public_key = certificate.public_key()
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise ValueError("QZ signing requires an RSA certificate.")
    if public_key.public_numbers() != key.public_key().public_numbers():
        raise ValueError("QZ signing certificate and private key do not match.")
    return key


def validate_signing_material(certificate_pem: str, private_key_pem: str) -> None:
    _load_material(certificate_pem, private_key_pem)


def sign_digest(certificate_pem: str, private_key_pem: str, digest: str) -> str:
    key = _load_material(certificate_pem, private_key_pem)
    signature = key.sign(digest.encode("ascii"), padding.PKCS1v15(), hashes.SHA512())
    return base64.b64encode(signature).decode("ascii")
