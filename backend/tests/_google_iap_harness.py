"""Shared harness for the Google Play IAP tests (#2787, split in #2955).

Google is mocked at the HTTP transport layer (``tests/google_play_fakes.py``):
the real google-auth token exchange (signed with a throwaway service-account
key), the real Play Developer API client and the real OIDC verification run
against fakes. No network, no real time: sleeps and clocks are injected.

Not a test module. Plain helpers are imported directly; the fixtures defined
here (``google_install``, ``google_gp``) reach a test module through its
``pytest_plugins = ["tests._google_iap_harness"]`` line, which avoids the
F811 shadowing an imported fixture would cause. Plugin fixtures are visible to
every backend test module, so their names carry a ``google_`` prefix.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from db.base import get_session_factory
from db.models import Purchase
from purchases import google
from purchases.google_notifications import GoogleRuntime, build_runtime
from tests._helpers import session_headers
from tests.google_play_fakes import (
    HEARTS,
    FakeJwks,
    FakePlay,
    FakeTokenEndpoint,
    make_config,
    oidc_token,
    play_purchase,
    push_body,
)


def NOW() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------


@dataclass
class Harness:
    runtime: GoogleRuntime
    play: FakePlay
    tokens: FakeTokenEndpoint
    jwks: FakeJwks
    sleeps: list[float] = field(default_factory=list)
    clock: list[float] = field(default_factory=lambda: [1_000.0])

    @property
    def verifier(self):
        return self.runtime.verifier


def make_harness(envs: frozenset[str] = frozenset({"production", "test"})) -> Harness:
    play, tokens, jwks = FakePlay(), FakeTokenEndpoint(), FakeJwks()
    sleeps: list[float] = []
    clock = [1_000.0]

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    runtime = build_runtime(
        make_config(envs),
        play_transport=play.transport(),
        token_transport=tokens.transport(),
        jwks_transport=jwks.transport(),
        sleep=fake_sleep,
        clock=lambda: clock[0],
    )
    return Harness(runtime, play, tokens, jwks, sleeps, clock)


@pytest.fixture()
def google_install() -> Iterator:
    def _install(h: Harness) -> Harness:
        google._runtime = h.runtime
        return h

    yield _install
    google.reset_google_runtime()


@pytest.fixture()
def google_gp(google_install) -> Harness:
    return google_install(make_harness())


def tok() -> str:
    return "gp-" + uuid.uuid4().hex + uuid.uuid4().hex


def sid() -> str:
    return str(uuid.uuid4())


def post_google(client, session, token, source="sync", product=HEARTS):
    return client.post(
        "/purchases/google",
        json={"product_id": product, "purchase_token": token, "source": source},
        headers=session_headers(session),
    )


def post_rtdn(client, note, *, bearer: str | None = None, message_id: str | None = None):
    return client.post(
        "/purchases/google/notifications",
        json=push_body(note, message_id),
        headers={"Authorization": f"Bearer {bearer or oidc_token()}"},
    )


async def row(token: str) -> Purchase | None:
    async with get_session_factory()() as db:
        return (
            await db.execute(select(Purchase).where(Purchase.store_key == token))
        ).scalar_one_or_none()


def utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def grant(client, h: Harness, token: str | None = None, **kw) -> tuple[str, str]:
    token = token or tok()
    h.play.purchases[token] = play_purchase(**kw)
    session = sid()
    r = post_google(client, session, token)
    assert r.status_code == 200, r.text
    return session, token


# ---------------------------------------------------------------------------
# RTDN push authentication
# ---------------------------------------------------------------------------


def rtdn_raw(client, headers: dict, content: bytes = b"{}"):
    return client.post("/purchases/google/notifications", content=content, headers=headers)
