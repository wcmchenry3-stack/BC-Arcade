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
from types import SimpleNamespace

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
    ocsp_url: str | None = None,
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
    if ocsp_url is not None:
        builder = builder.add_extension(
            x509.AuthorityInformationAccess(
                [
                    x509.AccessDescription(
                        x509.oid.AuthorityInformationAccessOID.OCSP,
                        x509.UniformResourceIdentifier(ocsp_url),
                    )
                ]
            ),
            critical=False,
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
    # For OCSP tests: (certificate, its issuer, the issuer's key), leaf first.
    chain: tuple = ()

    def sign(self, payload: dict, *, alg: str = "ES256", x5c: list[str] | None = None) -> str:
        headers = {"x5c": self.x5c if x5c is None else x5c}
        return jwt.encode(payload, self.leaf_key, algorithm=alg, headers=headers)


def make_ca(
    *,
    leaf_not_after: datetime | None = None,
    leaf_marker: bool = True,
    name: str = "BC Arcade Test",
    ocsp_url: str | None = None,
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
        ocsp_url=ocsp_url,
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
        ocsp_url=ocsp_url,
    )
    x5c = [base64.b64encode(_der(c)).decode() for c in (leaf, inter, root)]
    return TestCA(
        root_der=_der(root),
        x5c=x5c,
        leaf_key=leaf_key,
        chain=((leaf, inter, int_key), (inter, root, root_key)),
    )


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


def ocsp_responder(ca: TestCA, *, status: str = "good"):
    """A fake ``requests.post`` answering OCSP requests for ``ca``'s chain.

    ``status``: ``good`` / ``revoked`` sign a response with the issuer's key;
    ``http_error`` answers 500; ``unreachable`` raises a connection error.
    """
    import requests
    from cryptography.x509 import ocsp

    by_serial = {cert.serial_number: (cert, issuer, key) for cert, issuer, key in ca.chain}
    seen: list[int] = []

    def post(url, headers=None, data=None, timeout=None):
        if status == "unreachable":
            raise requests.exceptions.ConnectionError("no route")
        req = ocsp.load_der_ocsp_request(data)
        seen.append(req.serial_number)
        if status == "http_error":
            return SimpleNamespace(status_code=500, content=b"")
        cert, issuer, key = by_serial[req.serial_number]
        now = datetime.now(timezone.utc)
        good = status == "good"
        builder = (
            ocsp.OCSPResponseBuilder()
            .add_response(
                cert=cert,
                issuer=issuer,
                algorithm=hashes.SHA256(),
                cert_status=ocsp.OCSPCertStatus.GOOD if good else ocsp.OCSPCertStatus.REVOKED,
                this_update=now - timedelta(minutes=5),
                next_update=now + timedelta(hours=1),
                revocation_time=None if good else now - timedelta(minutes=1),
                revocation_reason=None,
            )
            .responder_id(ocsp.OCSPResponderEncoding.HASH, issuer)
        )
        der = builder.sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.DER)
        return SimpleNamespace(status_code=200, content=der)

    post.seen = seen  # type: ignore[attr-defined]
    return post
