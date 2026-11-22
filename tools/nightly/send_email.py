#!/usr/bin/env python3
"""Send the nightly report email through Resend's HTTP API (#4055).

Usage (the ``summary`` job of .github/workflows/nightly.yml):

    RESEND_API_KEY=... python3 tools/nightly/send_email.py --payload payload.json

``payload.json`` is built by report.py ``--email-out`` (``from``, ``to``, ``subject``, ``text``).

- No ``RESEND_API_KEY`` or an empty ``to``: log ``::warning::`` and exit 0 (nothing to send to,
  or the secret is not set up; the run is not failed for that).
- Resend answers anything but 2xx, or the request fails: log ``::error::`` with the status and
  exit 1, so the job fails and the org Workflow Failure Monitor sees it.

The key is read from the environment and never printed. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

API_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 30


def _one_line(text: str, limit: int = 200) -> str:
    return " ".join(text.split())[:limit]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: the Bearer key must only ever go to api.resend.com."""

    def redirect_request(self, *_args, **_kwargs):
        return None  # the 3xx then surfaces as an HTTPError


def _no_redirect_open(request, timeout):
    return urllib.request.build_opener(_NoRedirect).open(request, timeout=timeout)


def _error_message(exc: urllib.error.HTTPError) -> str:
    """The ``message`` field of a JSON error body, one line, 200 chars; never the raw body."""
    try:
        message = json.loads(exc.read().decode("utf-8", "replace")).get("message")
    except (OSError, ValueError, AttributeError):
        return ""
    return _one_line(message) if isinstance(message, str) else ""


def send(payload_path: str, api_key: str, opener=_no_redirect_open, url: str = API_URL) -> int:
    """Return the process exit code. ``opener`` and ``url`` are injectable for tests."""
    try:
        with open(payload_path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, ValueError) as exc:
        print(f"::error::Could not read the email payload: {type(exc).__name__}")
        return 1
    if not api_key:
        print("::warning::RESEND_API_KEY is empty; not sending the nightly report email")
        return 0
    if not str(payload.get("to") or "").strip():
        print("::warning::NIGHTLY_REPORT_TO is empty; not sending the nightly report email")
        return 0
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "bc-arcade-nightly",
        },
    )
    try:
        with opener(request, timeout=TIMEOUT_SECONDS) as response:
            status = response.status
    except urllib.error.HTTPError as exc:
        detail = f" {_error_message(exc)}" if exc.fp else ""
        print(f"::error::Resend rejected the nightly report email: HTTP {exc.code}{detail}")
        return 1
    except (urllib.error.URLError, OSError) as exc:
        print(f"::error::Could not reach Resend: {type(exc).__name__}")
        return 1
    if not 200 <= status < 300:
        print(f"::error::Resend returned HTTP {status} for the nightly report email")
        return 1
    print(f"Nightly report email sent (HTTP {status})")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--payload", required=True)
    args = parser.parse_args(argv)
    return send(args.payload, os.environ.get("RESEND_API_KEY", "").strip())


if __name__ == "__main__":
    sys.exit(main())
