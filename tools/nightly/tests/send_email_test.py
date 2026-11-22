"""pytest suite for tools/nightly/send_email.py (#4055): the Resend send and its fail-safes."""

import http.server
import importlib.util
import io
import json
import threading
import urllib.error
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "send_email.py"
_spec = importlib.util.spec_from_file_location("nightly_send_email", SCRIPT)
send_email = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(send_email)

PAYLOAD = {"from": "a <a@x.test>", "to": "o@x.test", "subject": "s", "text": "t"}


class Response:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def payload(tmp_path):
    path = tmp_path / "email.json"
    path.write_text(json.dumps(PAYLOAD))
    return str(path)


def never_called(*_args, **_kwargs):
    raise AssertionError("must not call Resend")


def test_posts_json_with_bearer_key_to_resend(payload, capsys):
    seen = {}

    def opener(request, **_kwargs):
        seen["url"] = request.full_url
        seen["method"] = request.get_method()
        seen["auth"] = request.get_header("Authorization")
        seen["body"] = json.loads(request.data)
        return Response(200)

    assert send_email.send(payload, "re_secret", opener) == 0
    assert seen["url"] == "https://api.resend.com/emails"
    assert seen["method"] == "POST"
    assert seen["auth"] == "Bearer re_secret"
    assert seen["body"] == PAYLOAD
    assert "re_secret" not in capsys.readouterr().out


def test_empty_key_warns_and_skips_with_exit_0(payload, capsys):
    assert send_email.send(payload, "", never_called) == 0
    assert "::warning::RESEND_API_KEY is empty" in capsys.readouterr().out


def test_empty_recipient_warns_and_skips_with_exit_0(tmp_path, capsys):
    path = tmp_path / "email.json"
    path.write_text(json.dumps({**PAYLOAD, "to": "  "}))
    assert send_email.send(str(path), "re_secret", never_called) == 0
    assert "::warning::NIGHTLY_REPORT_TO is empty" in capsys.readouterr().out


def test_non_2xx_fails_with_the_status_and_hides_the_key(payload, capsys):
    def opener(request, **_kwargs):
        raise urllib.error.HTTPError(
            request.full_url,
            403,
            "Forbidden",
            {},
            io.BytesIO(b'{"message":"domain not verified"}'),
        )

    assert send_email.send(payload, "re_secret", opener) == 1
    out = capsys.readouterr().out
    assert "::error::" in out and "HTTP 403" in out and "domain not verified" in out
    assert "re_secret" not in out


def test_unexpected_non_2xx_status_fails(payload, capsys):
    assert send_email.send(payload, "k", lambda _request, **_kwargs: Response(302)) == 1
    assert "HTTP 302" in capsys.readouterr().out


def test_network_error_fails(payload, capsys):
    def opener(_request, **_kwargs):
        raise urllib.error.URLError("boom")

    assert send_email.send(payload, "k", opener) == 1
    assert "::error::Could not reach Resend" in capsys.readouterr().out


def test_unreadable_payload_fails(tmp_path, capsys):
    assert send_email.send(str(tmp_path / "nope.json"), "k", never_called) == 1
    assert "::error::" in capsys.readouterr().out


def test_main_reads_the_key_from_the_environment(payload, monkeypatch, capsys):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    assert send_email.main(["--payload", payload]) == 0
    assert "RESEND_API_KEY is empty" in capsys.readouterr().out


def test_error_output_is_only_the_json_message_never_the_raw_body(payload, capsys):
    secret_ish = "RAW-BODY-MARKER"

    def opener(request, **_kwargs):
        body = json.dumps({"message": "m" * 300, "extra": secret_ish}).encode()
        raise urllib.error.HTTPError(request.full_url, 422, "x", {}, io.BytesIO(body))

    assert send_email.send(payload, "k", opener) == 1
    out = capsys.readouterr().out
    assert "HTTP 422 " + "m" * 200 in out and "m" * 201 not in out
    assert secret_ish not in out


def test_error_output_for_a_non_json_body_is_only_the_status(payload, capsys):
    def opener(request, **_kwargs):
        raise urllib.error.HTTPError(
            request.full_url, 500, "x", {}, io.BytesIO(b"<html>RAW</html>")
        )

    assert send_email.send(payload, "k", opener) == 1
    out = capsys.readouterr().out
    assert "HTTP 500" in out and "RAW" not in out


def test_a_redirect_is_not_followed_and_the_key_never_reaches_another_host(payload, capsys):
    hits = {"first": [], "second": []}

    class Second(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            hits["second"].append(self.headers.get("Authorization"))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args):
            pass

    second = http.server.HTTPServer(("127.0.0.1", 0), Second)
    target = f"http://127.0.0.1:{second.server_port}/emails"

    class First(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            hits["first"].append(self.headers.get("Authorization"))
            self.send_response(307)  # 307 keeps the method and body
            self.send_header("Location", target)
            self.end_headers()

        def log_message(self, *_args):
            pass

    first = http.server.HTTPServer(("127.0.0.1", 0), First)
    servers = [first, second]
    for server in servers:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{first.server_port}/emails"
        assert send_email.send(payload, "re_secret", url=url) == 1
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()
    assert hits["first"] == ["Bearer re_secret"]
    assert hits["second"] == []
    assert "HTTP 307" in capsys.readouterr().out
