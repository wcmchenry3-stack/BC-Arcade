"""A throwaway test CA that signs App Store–shaped JWS (#2786). Never real Apple keys.

The chain mirrors Apple's: a self-signed root, an intermediate carrying
Apple's WWDR marker OID (1.2.840.113635.100.6.2.1) and a leaf carrying the
App Store receipt-signing OID (1.2.840.113635.100.6.11.1), all EC P-256, with
the extensions OpenSSL's X509_STRICT mode needs. Tests trust this root by
passing it to :class:`purchases.apple_store.AppStoreVerifier`.
"""

from __future__ import annotations

import base64
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

LEAF_OID = x509.ObjectIdentifier("1.2.840.113635.100.6.11.1")
INTERMEDIATE_OID = x509.ObjectIdentifier("1.2.840.113635.100.6.2.1")

BUNDLE_ID = "com.buffingchi.games"
APP_APPLE_ID = 1234567890
HEARTS = "com.buffingchi.games.premium.hearts"


def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _cert(
    subject: str,
    key: ec.EllipticCurvePrivateKey,
    issuer: str,
    issuer_key: ec.EllipticCurvePrivateKey,
    *,
    ca: bool,
    marker: x509.ObjectIdentifier | None,
    not_before: datetime,
    not_after: datetime,
) -> x509.Certificate:
    builder = (
        x509.CertificateBuilder()
        .subject_name(_name(subject))
        .issuer_name(_name(issuer))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(not_before)
        .not_valid_after(not_after)
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=not ca,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=ca,
                crl_sign=ca,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()),
            critical=False,
        )
    )
    if marker is not None:
        builder = builder.add_extension(
            x509.UnrecognizedExtension(marker, b"\x05\x00"), critical=False
        )
    return builder.sign(issuer_key, hashes.SHA256())


def _der(cert: x509.Certificate) -> bytes:
    return cert.public_bytes(serialization.Encoding.DER)


@dataclass(frozen=True)
class TestCA:
    root_der: bytes
    x5c: list[str]
    leaf_key: ec.EllipticCurvePrivateKey

    def sign(self, payload: dict, *, alg: str = "ES256", x5c: list[str] | None = None) -> str:
        headers = {"x5c": self.x5c if x5c is None else x5c}
        return jwt.encode(payload, self.leaf_key, algorithm=alg, headers=headers)


def make_ca(
    *,
    leaf_not_after: datetime | None = None,
    leaf_marker: bool = True,
    name: str = "BC Arcade Test",
) -> TestCA:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=1)
    end = now + timedelta(days=365)
    root_key = ec.generate_private_key(ec.SECP256R1())
    int_key = ec.generate_private_key(ec.SECP256R1())
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    root_cn, int_cn, leaf_cn = f"{name} Root", f"{name} Intermediate", f"{name} Leaf"
    root = _cert(
        root_cn,
        root_key,
        root_cn,
        root_key,
        ca=True,
        marker=None,
        not_before=start,
        not_after=end,
    )
    inter = _cert(
        int_cn,
        int_key,
        root_cn,
        root_key,
        ca=True,
        marker=INTERMEDIATE_OID,
        not_before=start,
        not_after=end,
    )
    leaf = _cert(
        leaf_cn,
        leaf_key,
        int_cn,
        int_key,
        ca=False,
        marker=LEAF_OID if leaf_marker else None,
        not_before=start,
        not_after=leaf_not_after or end,
    )
    x5c = [base64.b64encode(_der(c)).decode() for c in (leaf, inter, root)]
    return TestCA(root_der=_der(root), x5c=x5c, leaf_key=leaf_key)


@lru_cache(maxsize=1)
def default_ca() -> TestCA:
    return make_ca()


def now_ms(delta: timedelta = timedelta(0)) -> int:
    return int((datetime.now(timezone.utc) + delta).timestamp() * 1000)


def transaction(
    original_transaction_id: str,
    *,
    product_id: str = HEARTS,
    environment: str = "Sandbox",
    bundle_id: str = BUNDLE_ID,
    app_account_token: str | None = None,
    signed_date: int | None = None,
    **extra: object,
) -> dict:
    """A JWSTransactionDecodedPayload-shaped dict for a non-consumable."""
    claims: dict = {
        "transactionId": f"{original_transaction_id}9",
        "originalTransactionId": original_transaction_id,
        "bundleId": bundle_id,
        "productId": product_id,
        "purchaseDate": now_ms(timedelta(minutes=-5)),
        "originalPurchaseDate": now_ms(timedelta(minutes=-5)),
        "quantity": 1,
        "type": "Non-Consumable",
        "inAppOwnershipType": "PURCHASED",
        "signedDate": signed_date if signed_date is not None else now_ms(),
        "environment": environment,
        "transactionReason": "PURCHASE",
        "storefront": "USA",
        "storefrontId": "143441",
    }
    if app_account_token is not None:
        claims["appAccountToken"] = app_account_token
    claims.update(extra)
    return claims


def notification(
    notification_type: str,
    signed_transaction: str | None,
    *,
    environment: str = "Sandbox",
    bundle_id: str = BUNDLE_ID,
    app_apple_id: int | None = APP_APPLE_ID,
    signed_date: int | None = None,
    notification_uuid: str | None = None,
    subtype: str | None = None,
) -> dict:
    """A ResponseBodyV2DecodedPayload-shaped dict."""
    data: dict = {"bundleId": bundle_id, "environment": environment, "bundleVersion": "1"}
    if app_apple_id is not None:
        data["appAppleId"] = app_apple_id
    if signed_transaction is not None:
        data["signedTransactionInfo"] = signed_transaction
    body: dict = {
        "notificationType": notification_type,
        "notificationUUID": notification_uuid or str(uuid.uuid4()),
        "version": "2.0",
        "signedDate": signed_date if signed_date is not None else now_ms(),
        "data": data,
    }
    if subtype is not None:
        body["subtype"] = subtype
    return body
