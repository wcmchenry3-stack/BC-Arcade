"""Shared rate limiter and the one place the API derives a client IP (#2863).

Every per-IP rate-limit bucket and every logged client IP comes from
:func:`client_ip`. Nothing else may read ``X-Forwarded-For``,
``CF-Connecting-IP`` or ``request.client`` to identify a caller.

Trust model (SECURITY.md §9, RENDER.md "Client IP"):

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
"""

from __future__ import annotations

import ipaddress
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

CF_CONNECTING_IP = "cf-connecting-ip"
X_FORWARDED_FOR = "x-forwarded-for"


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


_TRUST = load_proxy_trust()


def _parse_ip(value: str) -> str | None:
    """Canonical text of one IP address, or ``None`` if ``value`` is not one.

    Canonical so equivalent spellings share a bucket (``2001:DB8::1`` and
    ``2001:db8:0::1``; an IPv4-mapped IPv6 address and its IPv4 form).
    """
    try:
        ip = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return str(ip.ipv4_mapped)
    return str(ip)


def _from_cloudflare(request: Request) -> str | None:
    values = request.headers.getlist(CF_CONNECTING_IP)
    # Cloudflare sends exactly one. Two header lines means something other
    # than Cloudflare added one — trust neither.
    if len(values) != 1:
        return None
    return _parse_ip(values[0])


def _from_forwarded_for(request: Request, hops: int) -> str | None:
    # Several header lines are one list, in order (RFC 9110 §5.3).
    entries = [e for v in request.headers.getlist(X_FORWARDED_FOR) for e in v.split(",")]
    if len(entries) < hops:
        # Fewer entries than trusted proxies: a trusted hop did not append,
        # so no entry is known to be proxy-written.
        return None
    return _parse_ip(entries[-hops])


def _peer(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def client_ip(request: Request, trust: ProxyTrust | None = None) -> str:
    """The caller's IP under the configured proxy trust model (module docstring)."""
    trust = _TRUST if trust is None else trust
    if trust.mode == "none":
        return _peer(request)
    if trust.mode == "cloudflare":
        ip = _from_cloudflare(request)
        if ip is not None:
            return ip
    return _from_forwarded_for(request, trust.hops) or _peer(request)


def _real_ip(request: Request) -> str:
    """Per-IP rate-limit key: :func:`client_ip`.

    Kept as its own function (and name) because it is the limiter's default
    key and route audits assert on ``key_func.__name__``.
    """
    return client_ip(request)


def session_key(request: Request) -> str:
    """Rate-limit key bucketed by X-Session-ID, falling back to IP.

    Used by the write API routes (#364) so limits are per-session — a single
    session cannot exhaust the budget for everyone sharing its IP, and a
    misbehaving session is isolated.
    """
    sid = request.headers.get("X-Session-ID", "").strip()
    return sid or _real_ip(request)


limiter = Limiter(key_func=_real_ip)
