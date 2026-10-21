"""Static guards for the CI bots that post sticky PR comments (#3465).

Each bot must find its own comment by a marker. `gh pr comment --edit-last` edits the
token user's latest comment, which can belong to another github-actions bot.
"""

from __future__ import annotations

import pathlib

import yaml

REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
CI_YML = REPO_ROOT / ".github" / "workflows" / "ci.yml"


def _bundle_comment_step() -> dict:
    data = yaml.safe_load(CI_YML.read_text(encoding="utf-8"))
    for step in data["jobs"]["android-bundle-check"]["steps"]:
        if step.get("name") == "Post bundle size comment":
            return step
    raise AssertionError("android-bundle-check has no 'Post bundle size comment' step")


def test_no_workflow_uses_edit_last():
    for wf in sorted((REPO_ROOT / ".github" / "workflows").glob("*.yml")):
        assert "--edit-last" not in wf.read_text(encoding="utf-8"), wf.name


def test_bundle_comment_carries_and_matches_its_marker():
    run = _bundle_comment_step()["run"]
    assert 'COMMENT="<!-- bundle-size -->' in run
    assert 'startswith("<!-- bundle-size -->")' in run
    assert 'select(.user.login == "github-actions[bot]")' in run
