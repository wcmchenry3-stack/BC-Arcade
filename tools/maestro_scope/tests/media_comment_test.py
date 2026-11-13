"""pytest suite for e2e/maestro/media_comment.py (#3805): the opt-in filter, comment body,
PR resolution (PR run, fork, dispatch with zero/one/several PRs) and the never-fail contract."""

import importlib.util
import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location(
    "media_comment", REPO_ROOT / "e2e" / "maestro" / "media_comment.py"
)
mc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mc)

REPO = "owner/repo"


def touch(path, name):
    f = path / name
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(b"x")


def test_find_names_filters_by_prefix_extension_and_safety(tmp_path):
    touch(tmp_path, "mahjong-demo-open.png")
    touch(tmp_path, "mahjong-demo-open.mp4")
    touch(tmp_path / "debug" / "takeScreenshot", "mahjong-demo-zoom.png")
    touch(tmp_path, "sudoku-smoke.png")  # not opted in
    touch(tmp_path, "mahjong-notes.txt")  # not media
    touch(tmp_path, "mahjong-bad|name.png")  # unsafe in a table
    names = mc.find_names([str(tmp_path / "nope"), str(tmp_path)])
    assert names == ["mahjong-demo-open.mp4", "mahjong-demo-open.png", "mahjong-demo-zoom.png"]


def test_find_names_accepts_files_and_other_prefixes(tmp_path):
    touch(tmp_path, "sudoku-smoke.png")
    assert mc.find_names([str(tmp_path / "sudoku-smoke.png")]) == []
    assert mc.find_names([str(tmp_path)], prefixes=("sudoku-",)) == ["sudoku-smoke.png"]


def test_parse_names_refilters_untrusted_output():
    raw = "mahjong-a.png, mahjong-a.png,evil|x.png,sudoku-b.png,mahjong-c.mp4,,mahjong-d.exe"
    assert mc.parse_names(raw) == ["mahjong-a.png", "mahjong-c.mp4"]
    assert mc.parse_names("") == []


def test_build_body_has_marker_names_and_links():
    body = mc.build_body(
        "android", ["a.png", "b.mp4"], "https://x/artifact/1", "https://x/run/2", "abcdef123456"
    )
    assert body.startswith("<!-- maestro-media:android -->")
    assert "| `a.png` | screenshot |" in body and "| `b.mp4` | recording |" in body
    assert "(https://x/artifact/1)" in body and "(https://x/run/2)" in body and "`abcdef1`" in body
    assert "[`maestro-android-media`]" in body


def test_build_body_without_artifact_url_has_no_link():
    body = mc.build_body("ios", ["a.png"], "", "https://x/run/2", "abc")
    assert "`maestro-ios-media`" in body and "[`maestro-ios-media`]" not in body


def test_resolve_pr_pull_request_event():
    assert mc.resolve_pr("pull_request", "42", "b", REPO, False) == (42, "")
    assert mc.resolve_pr("pull_request", "", "b", REPO, False)[0] is None


def test_resolve_pr_fork_never_comments():
    pr, reason = mc.resolve_pr("pull_request", "42", "b", REPO, True)
    assert pr is None and "fork" in reason


def test_resolve_pr_schedule_does_not_comment():
    assert mc.resolve_pr("schedule", "", "dev", REPO, False)[0] is None


def _gh_returning(prs, calls=None):
    def gh(args):
        if calls is not None:
            calls.append(args)
        return json.dumps(prs)

    return gh


def test_resolve_pr_dispatch_one_pr_and_query():
    calls = []
    assert mc.resolve_pr(
        "workflow_dispatch", "", "feat/x", REPO, False, _gh_returning([{"number": 7}], calls)
    ) == (7, "")
    args = calls[0]
    assert args[:4] == ["api", "-X", "GET", f"repos/{REPO}/pulls"]
    assert "head=owner:feat/x" in args and "state=open" in args


def test_resolve_pr_dispatch_branch_with_query_characters_is_one_field():
    # A branch name with &, # or + stays one -f value for gh to encode; it can't add parameters.
    calls = []
    mc.resolve_pr(
        "workflow_dispatch",
        "",
        "feat/a&state=closed#b+c",
        REPO,
        False,
        _gh_returning([{"number": 3}], calls),
    )
    args = calls[0]
    assert "head=owner:feat/a&state=closed#b+c" in args
    assert not any("?" in a for a in args)
    assert args.count("state=open") == 1


def test_wanted_rejects_trailing_newline():
    assert not mc._wanted("mahjong-demo-open.png\n", ("mahjong-",))
    assert not mc._wanted("mahjong-demo\nopen.png", ("mahjong-",))
    assert mc._wanted("mahjong-demo-open.png", ("mahjong-",))


def test_resolve_pr_dispatch_zero_or_several_prs():
    pr, reason = mc.resolve_pr("workflow_dispatch", "", "b", REPO, False, _gh_returning([]))
    assert pr is None and "0 open" in reason
    pr, reason = mc.resolve_pr(
        "workflow_dispatch", "", "b", REPO, False, _gh_returning([{"number": 1}, {"number": 2}])
    )
    assert pr is None and "2 open" in reason


def test_resolve_pr_dispatch_api_failure_is_not_fatal():
    def gh(_args):
        raise subprocess.CalledProcessError(1, "gh")

    assert mc.resolve_pr("workflow_dispatch", "", "b", REPO, False, gh)[0] is None


def test_upsert_creates_when_no_marker_comment():
    calls = []

    def gh(args):
        calls.append(args)
        return ""

    assert mc.upsert_comment(REPO, 5, "android", "body", gh) == "created"
    assert calls[-1][:3] == ["api", "-X", "POST"] and calls[-1][3].endswith("/issues/5/comments")


def test_upsert_updates_existing_marker_comment():
    calls = []

    def gh(args):
        calls.append(args)
        return "999\n"

    assert mc.upsert_comment(REPO, 5, "android", "body", gh) == "updated"
    assert calls[-1][:3] == ["api", "-X", "PATCH"] and calls[-1][3].endswith("/issues/comments/999")
    assert "maestro-media:android" in calls[0][-1]


def base_env(**kw):
    env = {
        "PLATFORM": "android",
        "MEDIA_NAMES": "mahjong-demo-open.png",
        "GITHUB_REPOSITORY": REPO,
        "EVENT_NAME": "pull_request",
        "PR_NUMBER": "5",
        "HEAD_REPO": REPO,
        "SHA": "abcdef123",
        "RUN_URL": "https://x/run",
    }
    env.update(kw)
    return env


def test_comment_main_posts_and_writes_summary(tmp_path):
    calls = []
    summary = tmp_path / "summary.md"
    rc = mc.comment_main(
        base_env(GITHUB_STEP_SUMMARY=str(summary)), lambda a: calls.append(a) or ""
    )
    assert rc == 0 and len(calls) == 2
    text = summary.read_text()
    assert "mahjong-demo-open.png" in text and "<!--" not in text


def test_comment_main_fork_skips_comment_but_keeps_summary(tmp_path):
    calls = []
    summary = tmp_path / "summary.md"
    env = base_env(HEAD_REPO="someone/fork", GITHUB_STEP_SUMMARY=str(summary))
    assert mc.comment_main(env, lambda a: calls.append(a) or "") == 0
    assert calls == [] and "mahjong-demo-open.png" in summary.read_text()


def test_comment_main_never_fails_on_api_error(capsys):
    def gh(_args):
        raise subprocess.CalledProcessError(403, "gh")

    assert mc.comment_main(base_env(), gh) == 0
    assert "::warning::" in capsys.readouterr().out


def test_comment_main_no_media_is_a_noop():
    calls = []
    assert mc.comment_main(base_env(MEDIA_NAMES=""), lambda a: calls.append(a)) == 0
    assert calls == []


def test_main_names_writes_github_output(tmp_path, monkeypatch):
    touch(tmp_path, "mahjong-a.png")
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert mc.main(["x", "names", str(tmp_path)]) == 0
    assert out.read_text() == "names=mahjong-a.png\n"
