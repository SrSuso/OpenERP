"""Fast, database-free checks for QZ's optional server-side signing."""

from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID

from app.core.config import Settings
from app.tickets.qz_signing import sign_digest, validate_signing_material
from app.tickets.router import get_qz_security, sign_qz_request
from app.tickets.schemas import QzSignRequest


def _material(common_name: str = "OpenERP") -> tuple[str, str, rsa.RSAPrivateKey]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    cert_pem = certificate.public_bytes(serialization.Encoding.PEM).decode("ascii")
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    return cert_pem, key_pem, key


def test_signs_the_exact_qz_digest_with_sha512_rsa() -> None:
    certificate, private_key, key = _material()
    digest = "a" * 64

    signature = sign_digest(certificate, private_key, digest)

    key.public_key().verify(
        base64.b64decode(signature),
        digest.encode("ascii"),
        padding.PKCS1v15(),
        hashes.SHA512(),
    )


def test_rejects_a_certificate_and_private_key_that_do_not_match() -> None:
    certificate, _, _ = _material("Certificate")
    _, another_private_key, _ = _material("Other key")

    with pytest.raises(ValueError, match="do not match"):
        validate_signing_material(certificate, another_private_key)


@pytest.mark.asyncio
async def test_authenticated_qz_contract_exposes_the_certificate_but_never_the_key() -> None:
    certificate, private_key, key = _material()
    settings = Settings(
        environment="test",
        cors_origins=[],
        qz_signing_certificate=certificate,
        qz_signing_private_key=private_key,
    )
    digest = "b" * 64

    security = await get_qz_security(settings)
    signed = await sign_qz_request(QzSignRequest(digest=digest), settings)

    assert security.model_dump() == {"enabled": True, "certificate": certificate}
    assert private_key not in security.model_dump_json()
    key.public_key().verify(
        base64.b64decode(signed.signature),
        digest.encode("ascii"),
        padding.PKCS1v15(),
        hashes.SHA512(),
    )
