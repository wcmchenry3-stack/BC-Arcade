#!/usr/bin/env python3
"""Post a Maestro run's named screenshots and recordings on the PR (#3805).

The media sits in the `maestro-<platform>-media` artifact, a zip GitHub cannot render in a
comment, so the comment lists the file names and links to the artifact (no extra storage, no
images committed anywhere). One comment per platform, found by a hidden marker and edited in
place on each run, as the bundle-size comment in ci.yml does.

Subcommands:
  names PATH...   Print the opted-in media file names found under the files/directories
                  (missing paths ignored) and, if $GITHUB_OUTPUT is set, write `names=a,b,c`.
  comment         Build the comment from env and post/update it. Never exits non-zero: a fork
                  PR, no PR for the dispatched branch, or a failed API call only prints a
                  notice. The body is always written to $GITHUB_STEP_SUMMARY when set.

Opt in a game by adding its screenshot-name prefix to OPT_IN_PREFIXES.
"""

import json
import os
import re
import subprocess
import sys

# Screenshot/recording name prefixes that get listed. One place; add a game's prefix to opt in.
OPT_IN_PREFIXES = ("mahjong-",)
MEDIA_EXTENSIONS = (".png", ".mp4")
# Names go into a markdown table: accept only plain file names.
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+$")


def marker(platform):
    return f"<!-- maestro-media:{platform} -->"


def _walk(paths):
    for path in paths:
        if os.path.isfile(path):
            yield path
        elif os.path.isdir(path):
            for root, _dirs, files in os.walk(path):
                for name in files:
                    yield os.path.join(root, name)


def _wanted(name, prefixes):
    return (
        bool(SAFE_NAME.match(name))
        and name.startswith(tuple(prefixes))
        and name.lower().endswith(MEDIA_EXTENSIONS)
    )


def find_names(paths, prefixes=OPT_IN_PREFIXES):
    """Sorted unique basenames of opted-in, safe-named media files under paths."""
    return sorted({n for n in (os.path.basename(p) for p in _walk(paths)) if _wanted(n, prefixes)})


def parse_names(raw, prefixes=OPT_IN_PREFIXES):
    """Re-applies the opt-in and safety filters to a comma-separated list (a job output)."""
    return sorted({n.strip() for n in (raw or "").split(",") if _wanted(n.strip(), prefixes)})


def build_body(platform, names, artifact_url, run_url, sha, artifact_days=14):
    rows = "\n".join(
        f"| `{n}` | {'recording' if n.lower().endswith('.mp4') else 'screenshot'} |" for n in names
    )
    artifact = f"`maestro-{platform}-media`"
    if artifact_url:
        artifact = f"[{artifact}]({artifact_url})"
    return (
        f"{marker(platform)}\n"
        f"### Maestro {platform} media\n"
        f"Commit `{sha[:7]}`, [run]({run_url}). Download {artifact} (a zip, kept {artifact_days} "
        f"days, needs repo access) to see:\n\n"
        f"| File | Kind |\n|---|---|\n{rows}\n\n"
        f"_GitHub cannot show images from an artifact inline. Updated in place on each run._"
    )


def run_gh(args):
    """Runs `gh`; returns stdout. Raises subprocess.CalledProcessError on failure."""
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def resolve_pr(event, pr_number, branch, repo, is_fork, gh=run_gh):
    """Returns (pr_number or None, reason). Only a same-repo PR run or a dispatch comments."""
    if is_fork:
        return None, "fork PR: the token is read-only"
    if event == "pull_request":
        return (int(pr_number), "") if pr_number else (None, "no PR number in the event")
    if event != "workflow_dispatch":
        return None, f"{event or 'unknown'} run: not attached to a PR"
    owner = repo.split("/")[0]
    try:
        out = gh(["api", f"repos/{repo}/pulls?head={owner}:{branch}&state=open&per_page=100"])
        prs = json.loads(out or "[]")
    except (subprocess.CalledProcessError, ValueError, OSError) as exc:
        return None, f"could not list PRs for {branch}: {exc}"
    if len(prs) == 1:
        return int(prs[0]["number"]), ""
    return None, f"{len(prs)} open PRs for {branch} (need exactly one)"


def upsert_comment(repo, pr, platform, body, gh=run_gh):
    """Edits this platform's marker comment, or adds one. Returns "updated" or "created"."""
    out = gh(
        [
            "api",
            "--paginate",
            f"repos/{repo}/issues/{pr}/comments",
            "--jq",
            (
                '.[] | select(.user.login == "github-actions[bot]") '
                f'| select(.body | startswith("{marker(platform)}")) | .id'
            ),
        ]
    )
    ids = out.split()
    if ids:
        gh(["api", "-X", "PATCH", f"repos/{repo}/issues/comments/{ids[0]}", "-f", f"body={body}"])
        return "updated"
    gh(["api", "-X", "POST", f"repos/{repo}/issues/{pr}/comments", "-f", f"body={body}"])
    return "created"


def comment_main(env=os.environ, gh=run_gh):
    platform = env.get("PLATFORM", "")
    names = parse_names(env.get("MEDIA_NAMES", ""))
    if not names or not platform:
        print("No opted-in media; nothing to post.")
        return 0
    repo = env.get("GITHUB_REPOSITORY", "")
    body = build_body(
        platform,
        names,
        env.get("ARTIFACT_URL", ""),
        env.get("RUN_URL", ""),
        env.get("SHA", "0000000"),
    )
    summary = env.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(body.replace(marker(platform) + "\n", "", 1) + "\n")
    head_repo = env.get("HEAD_REPO", "")
    is_fork = bool(head_repo) and head_repo != repo
    pr, reason = resolve_pr(
        env.get("EVENT_NAME", ""),
        env.get("PR_NUMBER", ""),
        env.get("BRANCH", ""),
        repo,
        is_fork,
        gh,
    )
    if pr is None:
        print(f"Not commenting ({reason}); the media is listed in the job summary.")
        return 0
    try:
        print(f"Comment {upsert_comment(repo, pr, platform, body, gh)} on PR #{pr}.")
    except (subprocess.CalledProcessError, OSError) as exc:
        print(f"::warning::Could not post the media comment on PR #{pr}: {exc}")
    return 0


def main(argv):
    if len(argv) >= 2 and argv[1] == "names":
        names = find_names(argv[2:])
        print("\n".join(names))
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a", encoding="utf-8") as f:
                f.write(f"names={','.join(names)}\n")
        return 0
    if len(argv) == 2 and argv[1] == "comment":
        return comment_main()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
