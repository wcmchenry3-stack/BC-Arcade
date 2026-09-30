import ipaddress

from fastapi import Request
from slowapi import Limiter


def _real_ip(request: Request) -> str:
    """Resolve real client IP via X-Forwarded-For (Render injects this).

    Render's load balancer sets X-Forwarded-For to the real client IP.
    Without this, all requests share the load balancer's IP and hit the
    same rate-limit bucket, making per-IP limiting ineffective.

    TODO(follow-up, SECURITY.md §9 "Known issue: X-Forwarded-For"): this trusts
    the *first* hop, which the client controls — a client that sends its own
    X-Forwarded-For picks its bucket and escapes every per-IP limit (including
    the /purchases per-IP limit, #840). Take the right-most hop appended by
    Render's proxy instead; left unchanged here because it moves every
    existing per-IP bucket.
    """
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        candidate = xff.split(",")[0].strip()
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            pass
    return request.client.host if request.client else "unknown"


def session_key(request: Request) -> str:
    """Rate-limit key bucketed by X-Session-ID, falling back to IP.

    Used by the write API routes (#364) so limits are per-session — a single
    session cannot exhaust the budget for everyone sharing its IP, and a
    misbehaving session is isolated.
    """
    sid = request.headers.get("X-Session-ID", "").strip()
    return sid or _real_ip(request)


limiter = Limiter(key_func=_real_ip)
