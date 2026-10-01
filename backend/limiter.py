"""Shared rate limiter and the one place the API derives a client IP (#2863).

Every per-IP rate-limit bucket (:func:`client_ip_bucket`) and every logged
client IP (:func:`client_ip`) comes from here. No other app code reads
``X-Forwarded-For``, ``CF-Connecting-IP`` or ``request.client`` to identify a
caller. (Sentry never gets them either: see ``SENTRY_SCRUBBED_KEYS`` in
``main.py``.)

Trust model (SECURITY.md §9, RENDER.md "Client IP and rate-limit keys"):

    client → Cloudflare (owner's zone, proxied) → Render proxy → uvicorn

- ``request.client.host`` (the socket peer) is Render's proxy, not the
  caller: uvicorn only rewrites it from ``X-Forwarded-For`` for peers in
  ``FORWARDED_ALLOW_IPS`` (default loopback only), and the start command
  sets neither that nor ``--forwarded-allow-ips``. Keep it that way — with
  ``*`` uvicorn would hand us the client-controlled left-most entry.
- ``X-Forwarded-For`` is a list each proxy *appends* to. Only the entries
  appended by proxies we trust are meaningful; everything to their left
  arrived from the client and is attacker-controlled. So the resolver counts
  ``TRUSTED_PROXY_HOPS`` entries in from the **right**, never the left.
- ``CF-Connecting-IP`` is set by Cloudflare's edge, which replaces any value
  the client sent. It is only trustworthy on requests that actually went
  through Cloudflare — see the *.onrender.com note in SECURITY.md §9.

``TRUSTED_PROXY_MODE``:

``cloudflare`` (default — production and dev are fronted by Cloudflare)
    ``CF-Connecting-IP`` when it holds one valid IP; otherwise the
    ``render`` rule below; otherwise the peer.
``render``
    The ``X-Forwarded-For`` entry ``TRUSTED_PROXY_HOPS`` from the right
    (1 = the entry Render's proxy appended for the peer it saw); otherwise
    the peer. Behind a proxied Cloudflare zone this is a Cloudflare egress
    IP, so use ``cloudflare`` there.
``none``
    The socket peer; forwarding headers are ignored. For running uvicorn
    directly with no proxy in front.

A missing, malformed or ambiguous value never falls back to a *more*
client-controlled source: it falls through to the next trusted rule and
finally to the peer.

Rate-limit buckets are per IPv4 address and per IPv6 /64 (one subscriber's
usual allocation); logs keep the full address.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from fastapi import Request
from slowapi import Limiter

ProxyMode = Literal["cloudflare", "render", "none"]
PROXY_MODES: tuple[str, ...] = ("cloudflare", "render", "none")
DEFAULT_PROXY_MODE: ProxyMode = "cloudflare"
DEFAULT_PROXY_HOPS = 1
MAX_PROXY_HOPS = 10
# IPv6 buckets cover a /64: that is what one subscriber or device is usually
# given, so per-address buckets would let one client rotate through 2**64 of
# them (and grow limiter storage without bound).
IPV6_BUCKET_PREFIX = 64

CF_CONNECTING_IP = "cf-connecting-ip"
X_FORWARDED_FOR = "x-forwarded-for"

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

_log = logging.getLogger("audit")


@dataclass(frozen=True)
class ProxyTrust:
    mode: ProxyMode = DEFAULT_PROXY_MODE
    hops: int = DEFAULT_PROXY_HOPS


def load_proxy_trust(environ: Mapping[str, str] | None = None) -> ProxyTrust:
    """Read ``TRUSTED_PROXY_MODE`` / ``TRUSTED_PROXY_HOPS``.

    A bad value raises at import, so a typo stops the deploy (Render keeps
    the previous instance) instead of silently trusting the wrong header.
    """
    env = os.environ if environ is None else environ
    mode = (env.get("TRUSTED_PROXY_MODE") or DEFAULT_PROXY_MODE).strip().lower()
    if mode not in PROXY_MODES:
        raise ValueError(
            f"TRUSTED_PROXY_MODE must be one of {', '.join(PROXY_MODES)}; got {mode!r}"
        )
    raw_hops = (env.get("TRUSTED_PROXY_HOPS") or str(DEFAULT_PROXY_HOPS)).strip()
    try:
        hops = int(raw_hops)
    except ValueError:
        raise ValueError(f"TRUSTED_PROXY_HOPS must be an integer; got {raw_hops!r}") from None
    if not 1 <= hops <= MAX_PROXY_HOPS:
        raise ValueError(f"TRUSTED_PROXY_HOPS must be between 1 and {MAX_PROXY_HOPS}; got {hops}")
    return ProxyTrust(mode=mode, hops=hops)  # type: ignore[arg-type]


def proxy_header_debug_enabled(environ: Mapping[str, str] | None = None) -> bool:
    """``LOG_PROXY_HEADERS=1``: temporary, dev-only raw-header logging.

    For the owner checks in RENDER.md. Never honoured when
    ``ENVIRONMENT=production``: the raw values are client IPs and forgeries.
    """
    env = os.environ if environ is None else environ
    if env.get("LOG_PROXY_HEADERS", "").strip() != "1":
        return False
    return env.get("ENVIRONMENT") != "production"


_TRUST = load_proxy_trust()
_LOG_PROXY_HEADERS = proxy_header_debug_enabled()


def log_proxy_trust() -> None:
    """Log the trust settings once at startup (``main`` calls it after logging is set up)."""
    _log.info(
        json.dumps(
            {
                "event": "client_ip_trust",
                "mode": _TRUST.mode,
                "hops": _TRUST.hops,
                "log_proxy_headers": _LOG_PROXY_HEADERS,
            }
        )
    )
    if os.environ.get("LOG_PROXY_HEADERS", "").strip() == "1" and not _LOG_PROXY_HEADERS:
        _log.warning('{"event": "log_proxy_headers_ignored", "reason": "production"}')


def _peer(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _xff_entries(request: Request) -> list[str]:
    # Several header lines are one list, in order (RFC 9110 §5.3).
    return [e for v in request.headers.getlist(X_FORWARDED_FOR) for e in v.split(",")]


def proxy_header_debug(request: Request) -> dict | None:
    """Raw forwarding headers of one request, when ``LOG_PROXY_HEADERS`` is on.

    What reached uvicorn *before* any trust decision, so the RENDER.md checks
    can tell which hop wrote what.
    """
    if not _LOG_PROXY_HEADERS:
        return None
    entries = [e.strip() for e in _xff_entries(request)]
    return {
        "cf_connecting_ip": request.headers.getlist(CF_CONNECTING_IP),
        "xff_count": len(entries),
        "xff_tail": entries[-3:],
        "peer": _peer(request),
    }


def _parse_ip(value: str) -> IPAddress | None:
    """One IP address in canonical form, or ``None`` if ``value`` is not one.

    Canonical so equivalent spellings share a bucket (``2001:DB8::1`` and
    ``2001:db8:0::1``; an IPv4-mapped IPv6 address and its IPv4 form). An
    address with a zone ID (``fe80::1%eth0``) is not a public client address
    and is rejected.
    """
    try:
        ip = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.scope_id is not None:
            return None
        if ip.ipv4_mapped is not None:
            return ip.ipv4_mapped
    return ip


def _from_cloudflare(request: Request) -> IPAddress | None:
    values = request.headers.getlist(CF_CONNECTING_IP)
    # Cloudflare sends exactly one. Two header lines means something other
    # than Cloudflare added one — trust neither.
    if len(values) != 1:
        return None
    return _parse_ip(values[0])


def _from_forwarded_for(request: Request, hops: int) -> IPAddress | None:
    entries = _xff_entries(request)
    if len(entries) < hops:
        # Fewer entries than trusted proxies: a trusted hop did not append,
        # so no entry is known to be proxy-written.
        return None
    return _parse_ip(entries[-hops])


_warned_cf_header_ignored = False


def _warn_if_cf_header_ignored(request: Request, trust: ProxyTrust) -> None:
    """Once per process: a Cloudflare header arrived but the mode ignores it.

    A valid-but-wrong mode is not an error at boot, yet behind Cloudflare it
    can put every caller into a few shared buckets; this makes it visible.
    """
    global _warned_cf_header_ignored
    if _warned_cf_header_ignored or CF_CONNECTING_IP not in request.headers:
        return
    _warned_cf_header_ignored = True
    _log.warning(
        json.dumps(
            {
                "event": "client_ip_cf_header_ignored",
                "mode": trust.mode,
                "hint": "request carries CF-Connecting-IP; check TRUSTED_PROXY_MODE (RENDER.md)",
            }
        )
    )


def _resolve(request: Request, trust: ProxyTrust | None) -> IPAddress | str:
    trust = _TRUST if trust is None else trust
    if trust.mode != "cloudflare":
        _warn_if_cf_header_ignored(request, trust)
    if trust.mode == "none":
        return _peer(request)
    if trust.mode == "cloudflare":
        ip = _from_cloudflare(request)
        if ip is not None:
            return ip
    return _from_forwarded_for(request, trust.hops) or _peer(request)


def client_ip(request: Request, trust: ProxyTrust | None = None) -> str:
    """The caller's full address under the configured trust model (module docstring).

    For the ``"ip"`` field of the request and 429 logs. Rate limits key on
    :func:`client_ip_bucket`.
    """
    return str(_resolve(request, trust))


def ip_bucket(value: IPAddress | str) -> str:
    """Rate-limit bucket of an address: IPv4 as is, IPv6 as its /64.

    A value that is not an IP address (a test client's peer name,
    ``"unknown"``) is its own bucket.
    """
    ip = _parse_ip(value) if isinstance(value, str) else value
    if ip is None:
        return str(value)
    if isinstance(ip, ipaddress.IPv6Address):
        return str(ipaddress.ip_network(f"{ip}/{IPV6_BUCKET_PREFIX}", strict=False))
    return str(ip)


def client_ip_bucket(request: Request, trust: ProxyTrust | None = None) -> str:
    """Per-IP rate-limit key: :func:`client_ip` with IPv6 widened to its /64."""
    return ip_bucket(_resolve(request, trust))


def _real_ip(request: Request) -> str:
    """The limiter's default key: :func:`client_ip_bucket`.

    Kept as its own function (and name) because route audits assert on
    ``key_func.__name__``.
    """
    return client_ip_bucket(request)


def session_key(request: Request) -> str:
    """Rate-limit key bucketed by X-Session-ID, falling back to IP.

    Used by the write API routes (#364) so limits are per-session — a single
    session cannot exhaust the budget for everyone sharing its IP, and a
    misbehaving session is isolated.
    """
    sid = request.headers.get("X-Session-ID", "").strip()
    return sid or _real_ip(request)


limiter = Limiter(key_func=_real_ip)
