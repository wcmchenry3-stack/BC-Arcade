"""Client-IP resolution for per-IP rate limits and logs (#2863, SECURITY.md §9).

Unit tests drive :func:`limiter.client_ip` with real Starlette requests (so
repeated header lines behave as they do in production); the integration tests
at the bottom drive real routes through ``TestClient`` with a chosen socket
peer and prove a forged ``X-Forwarded-For`` cannot move a caller's bucket.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

import limiter as limiter_module
from limiter import (
    DEFAULT_PROXY_HOPS,
    DEFAULT_PROXY_MODE,
    ProxyTrust,
    _real_ip,
    client_ip,
    load_proxy_trust,
    session_key,
)

PEER = "10.201.3.4"  # stands in for Render's proxy, the socket peer in production

CLOUDFLARE = ProxyTrust("cloudflare", 1)
RENDER = ProxyTrust("render", 1)
NONE = ProxyTrust("none", 1)


def make_request(headers: list[tuple[str, str]] | None = None, peer: str | None = PEER) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or [])],
        "client": (peer, 443) if peer is not None else None,
    }
    return Request(scope)


def xff(value: str) -> tuple[str, str]:
    return ("X-Forwarded-For", value)


def cf(value: str) -> tuple[str, str]:
    return ("CF-Connecting-IP", value)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_default_matches_production() -> None:
    assert DEFAULT_PROXY_MODE == "cloudflare"
    assert DEFAULT_PROXY_HOPS == 1
    assert load_proxy_trust({}) == ProxyTrust("cloudflare", 1)


@pytest.mark.parametrize("mode", ["cloudflare", "render", "none", " Render "])
def test_modes_parse(mode: str) -> None:
    assert load_proxy_trust({"TRUSTED_PROXY_MODE": mode}).mode == mode.strip().lower()


def test_hops_parse() -> None:
    assert load_proxy_trust({"TRUSTED_PROXY_MODE": "render", "TRUSTED_PROXY_HOPS": "2"}).hops == 2


@pytest.mark.parametrize(
    "env",
    [
        {"TRUSTED_PROXY_MODE": "xff"},
        {"TRUSTED_PROXY_MODE": "leftmost"},
        {"TRUSTED_PROXY_HOPS": "0"},
        {"TRUSTED_PROXY_HOPS": "-1"},
        {"TRUSTED_PROXY_HOPS": "11"},
        {"TRUSTED_PROXY_HOPS": "one"},
    ],
)
def test_bad_config_refuses_to_start(env: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        load_proxy_trust(env)


def test_module_default_is_used_when_no_trust_is_passed(monkeypatch: pytest.MonkeyPatch) -> None:
    req = make_request([cf("203.0.113.9")])
    monkeypatch.setattr(limiter_module, "_TRUST", NONE)
    assert client_ip(req) == PEER == _real_ip(req)
    monkeypatch.setattr(limiter_module, "_TRUST", CLOUDFLARE)
    assert client_ip(req) == "203.0.113.9" == _real_ip(req)


# ---------------------------------------------------------------------------
# Spoofed / multi-hop X-Forwarded-For
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("trust", [CLOUDFLARE, RENDER])
def test_spoofed_leftmost_xff_is_ignored(trust: ProxyTrust) -> None:
    # The client sent "1.2.3.4"; Render appended the real peer it saw.
    req = make_request([xff("1.2.3.4, 198.51.100.7")])
    assert client_ip(req, trust) == "198.51.100.7"


def test_client_supplied_xff_alone_never_changes_the_bucket() -> None:
    # A request that reached us without a proxy appending anything: the one
    # entry *is* what a trusted hop would have written in render mode, so the
    # only safe reading on a direct connection is mode "none".
    assert client_ip(make_request([xff("1.2.3.4")]), NONE) == PEER


@pytest.mark.parametrize(
    ("chain", "hops", "expected"),
    [
        ("198.51.100.7", 1, "198.51.100.7"),
        ("1.1.1.1, 2.2.2.2, 198.51.100.7", 1, "198.51.100.7"),
        ("1.1.1.1, 198.51.100.7, 10.0.0.2", 2, "198.51.100.7"),
        ("forged, 198.51.100.7, 10.0.0.2, 10.0.0.3", 3, "198.51.100.7"),
        ("198.51.100.7,10.0.0.2", 2, "198.51.100.7"),  # no spaces
    ],
)
def test_multi_hop_chain_counts_from_the_right(chain: str, hops: int, expected: str) -> None:
    assert client_ip(make_request([xff(chain)]), ProxyTrust("render", hops)) == expected


def test_fewer_entries_than_hops_falls_back_to_peer() -> None:
    # A trusted proxy did not append — no entry is known to be proxy-written,
    # and the left-most one must never be used instead.
    assert client_ip(make_request([xff("1.2.3.4")]), ProxyTrust("render", 2)) == PEER


def test_repeated_xff_header_lines_are_one_list() -> None:
    # Client sent its own header line; the proxy added a second one.
    req = make_request([xff("1.2.3.4"), xff("198.51.100.7")])
    assert client_ip(req, RENDER) == "198.51.100.7"


def test_rightmost_entry_malformed_falls_back_to_peer_not_leftward() -> None:
    req = make_request([xff("1.2.3.4, not-an-ip")])
    assert client_ip(req, RENDER) == PEER


@pytest.mark.parametrize("value", ["not-an-ip", "", " , ", "1.2.3.4:8080", "999.1.1.1", "unknown"])
def test_malformed_xff_falls_back_to_peer(value: str) -> None:
    assert client_ip(make_request([xff(value)]), RENDER) == PEER


def test_xff_ignored_in_none_mode() -> None:
    req = make_request([xff("1.2.3.4, 198.51.100.7"), cf("203.0.113.9")])
    assert client_ip(req, NONE) == PEER


# ---------------------------------------------------------------------------
# CF-Connecting-IP
# ---------------------------------------------------------------------------


def test_cloudflare_mode_uses_cf_connecting_ip_over_xff() -> None:
    req = make_request([cf("203.0.113.9"), xff("1.2.3.4, 104.23.0.1")])
    assert client_ip(req, CLOUDFLARE) == "203.0.113.9"


@pytest.mark.parametrize("trust", [RENDER, NONE])
def test_cf_connecting_ip_is_ignored_outside_cloudflare_mode(trust: ProxyTrust) -> None:
    req = make_request([cf("203.0.113.9")])
    assert client_ip(req, trust) == PEER


def test_cloudflare_mode_without_cf_header_uses_proxy_appended_xff() -> None:
    # e.g. a Cloudflare DNS-only record: Render's own hop is still trustworthy.
    req = make_request([xff("1.2.3.4, 198.51.100.7")])
    assert client_ip(req, CLOUDFLARE) == "198.51.100.7"


@pytest.mark.parametrize("value", ["not-an-ip", "", "1.2.3.4, 5.6.7.8", "[2001:db8::1]"])
def test_malformed_cf_header_falls_through_to_trusted_xff_then_peer(value: str) -> None:
    assert client_ip(make_request([cf(value)]), CLOUDFLARE) == PEER
    req = make_request([cf(value), xff("1.2.3.4, 198.51.100.7")])
    assert client_ip(req, CLOUDFLARE) == "198.51.100.7"


def test_duplicate_cf_header_lines_are_not_trusted() -> None:
    req = make_request([cf("1.2.3.4"), cf("203.0.113.9")])
    assert client_ip(req, CLOUDFLARE) == PEER


# ---------------------------------------------------------------------------
# IPv6 and canonical form
# ---------------------------------------------------------------------------


def test_ipv6_cf_header() -> None:
    assert client_ip(make_request([cf("2001:DB8:0::1")]), CLOUDFLARE) == "2001:db8::1"


def test_ipv6_xff_chain() -> None:
    req = make_request([xff("1.2.3.4, 2001:db8::abcd")])
    assert client_ip(req, RENDER) == "2001:db8::abcd"


def test_ipv4_mapped_ipv6_shares_the_ipv4_bucket() -> None:
    assert client_ip(make_request([cf("::ffff:198.51.100.7")]), CLOUDFLARE) == "198.51.100.7"


def test_ipv6_peer_is_returned_as_is() -> None:
    assert client_ip(make_request(peer="2001:db8::2"), NONE) == "2001:db8::2"


def test_no_client_and_no_headers_is_unknown() -> None:
    assert client_ip(make_request(peer=None), CLOUDFLARE) == "unknown"


# ---------------------------------------------------------------------------
# Bucketing: forged headers from two clients
# ---------------------------------------------------------------------------


def test_one_client_rotating_forged_xff_stays_in_one_bucket() -> None:
    keys = {
        client_ip(make_request([xff(f"7.7.7.{i}, 198.51.100.7")]), trust)
        for i in range(20)
        for trust in (CLOUDFLARE, RENDER)
    }
    assert keys == {"198.51.100.7"}


def test_two_clients_forging_the_same_xff_stay_split() -> None:
    a = make_request([xff("1.2.3.4"), cf("198.51.100.7")])
    b = make_request([xff("1.2.3.4"), cf("198.51.100.8")])
    assert client_ip(a, CLOUDFLARE) != client_ip(b, CLOUDFLARE)
    a = make_request([xff("1.2.3.4, 198.51.100.7")])
    b = make_request([xff("1.2.3.4, 198.51.100.8")])
    assert client_ip(a, RENDER) != client_ip(b, RENDER)


def test_forging_a_victims_ip_does_not_land_in_the_victims_bucket() -> None:
    victim = client_ip(make_request([cf("198.51.100.7")]), CLOUDFLARE)
    attacker = make_request([xff("198.51.100.7"), cf("203.0.113.66")])
    assert client_ip(attacker, CLOUDFLARE) != victim


# ---------------------------------------------------------------------------
# session_key
# ---------------------------------------------------------------------------


def test_session_key_with_session_id() -> None:
    assert session_key(make_request([("X-Session-ID", "abc-123")])) == "abc-123"


def test_session_key_without_session_id_falls_back_to_client_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(limiter_module, "_TRUST", CLOUDFLARE)
    req = make_request([xff("1.2.3.4"), cf("198.51.100.7")])
    assert session_key(req) == "198.51.100.7"


# ---------------------------------------------------------------------------
# Integration: real routes, one per kind of per-IP limit
# ---------------------------------------------------------------------------


@pytest.fixture(params=["cloudflare", "render"])
def trust(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> ProxyTrust:
    t = ProxyTrust(request.param, 1)
    monkeypatch.setattr(limiter_module, "_TRUST", t)
    return t


@pytest.fixture()
def proxied() -> Iterator[TestClient]:
    """A client whose socket peer is 'Render's proxy', like production."""
    from main import app

    with TestClient(app, client=(PEER, 443)) as c:
        yield c


def via_proxy(trust: ProxyTrust, real_ip: str, forged: str | None) -> dict[str, str]:
    """Headers as they reach uvicorn for a caller at ``real_ip`` who sent ``forged``."""
    chain = f"{forged}, {real_ip}" if forged else real_ip
    if trust.mode == "cloudflare":
        # Cloudflare overwrote any client CF-Connecting-IP; Render appended
        # a Cloudflare egress address after the client's own XFF.
        return {"CF-Connecting-IP": real_ip, "X-Forwarded-For": f"{chain}, 104.23.0.1"}
    return {"X-Forwarded-For": chain}


def _hammer(
    client: TestClient,
    trust: ProxyTrust,
    method: str,
    path: str,
    limit: int,
    extra: Callable[[], dict[str, str]] = dict,
    json_body: Callable[[], dict[str, str]] | None = None,
    content: bytes | None = None,
) -> None:
    """``limit`` calls from one caller that rotates a forged XFF every time,
    then one more → 429; a second caller forging the same XFF is unaffected."""

    def call(real_ip: str, forged: str) -> int:
        headers = {**extra(), **via_proxy(trust, real_ip, forged)}
        body = json_body() if json_body else None
        r = client.request(method, path, headers=headers, json=body, content=content)
        return r.status_code

    for i in range(limit):
        assert call("198.51.100.7", f"7.7.{i // 250}.{i % 250}") != 429, f"call {i} throttled"
    assert call("198.51.100.7", "9.9.9.9") == 429
    assert call("198.51.100.8", "9.9.9.9") != 429


def _first_limit(spec: str) -> int:
    return int(spec.split(";")[0].split("/")[0])


def test_default_key_route_health(proxied: TestClient, trust: ProxyTrust) -> None:
    _hammer(proxied, trust, "GET", "/health", 120)


def test_purchases_per_ip_limit_ignores_forged_xff_and_fresh_sessions(
    proxied: TestClient, trust: ProxyTrust
) -> None:
    from purchases.router import PURCHASE_IP_RATE_LIMIT

    # A fresh session (and store key) per call, so only the per-IP bucket fills.
    _hammer(
        proxied,
        trust,
        "POST",
        "/purchases/google",
        _first_limit(PURCHASE_IP_RATE_LIMIT),
        extra=lambda: {"X-Session-ID": str(uuid.uuid4()), "Content-Type": "application/json"},
        json_body=lambda: {
            "product_id": "com.buffingchi.games.premium.hearts",
            "purchase_token": uuid.uuid4().hex,
            "source": "sync",
        },
    )


def test_purchase_webhook_per_ip_limit(proxied: TestClient, trust: ProxyTrust) -> None:
    from purchases.router import GOOGLE_NOTIFICATION_IP_RATE_LIMIT

    limit = _first_limit(GOOGLE_NOTIFICATION_IP_RATE_LIMIT)
    _hammer(proxied, trust, "POST", "/purchases/google/notifications", limit, content=b"{}")


def test_session_key_route_falls_back_to_client_ip(proxied: TestClient, trust: ProxyTrust) -> None:
    # /stats/me is session-keyed; with no X-Session-ID the key is the client IP.
    _hammer(proxied, trust, "GET", "/stats/me", 60)


def test_rate_limit_log_records_resolved_ip(
    proxied: TestClient, trust: ProxyTrust, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO):
        proxied.get("/health", headers=via_proxy(trust, "198.51.100.7", "1.2.3.4"))
    text = caplog.text
    assert '"ip": "198.51.100.7"' in text
    assert '"ip": "1.2.3.4"' not in text
