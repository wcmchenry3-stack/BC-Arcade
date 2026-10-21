"""pytest suite for doc_reminder.py (#3448): glob matching, {name} capture and existence
check, already-touched docs, empty result, and the real checked-in config."""

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import doc_reminder as dr

REPO_ROOT = Path(__file__).resolve().parents[3]


def make_repo(tmp_path, docs):
    for d in docs:
        p = tmp_path / d
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("x")
    return tmp_path


# --- glob matching -----------------------------------------------------------------


@pytest.mark.parametrize(
    "glob,path,expected",
    [
        ("backend/alembic/**", "backend/alembic/versions/0001_x.py", True),
        ("backend/alembic/**", "backend/alembic.ini", False),
        ("render.yaml", "render.yaml", True),
        ("render.yaml", "docs/render.yaml", False),
        ("a/*.ts", "a/b.ts", True),
        ("a/*.ts", "a/b/c.ts", False),
        ("a/**/z.ts", "a/z.ts", True),
        ("a/**/z.ts", "a/b/c/z.ts", True),
        ("**/*.test.*", "frontend/src/x/foo.test.tsx", True),
        ("a/eventStore*.ts", "a/eventStoreChunks.ts", True),
        ("a/b.ts", "a/bxts", False),  # dots are literal
    ],
)
def test_glob_matching(glob, path, expected):
    assert (dr.match(glob, path) is not None) is expected


def test_name_capture_is_one_segment():
    assert dr.match("g/{name}/**", "g/yacht/engine.ts") == {"name": "yacht"}
    assert dr.match("g/{name}/**", "g/engine.ts") is None


# --- suggestions ---------------------------------------------------------------------

CONFIG = {
    "ignore": ["**/__tests__/**"],
    "rules": [
        {"paths": ["backend/alembic/**"], "docs": ["docs/ARCH.md"], "note": "Schema."},
        {"paths": ["frontend/src/game/{name}/**"], "docs": ["docs/games/{name}.md"]},
    ],
}


def test_simple_mapping_and_grouping(tmp_path):
    root = make_repo(tmp_path, ["docs/ARCH.md"])
    out = dr.suggest(["backend/alembic/versions/1.py", "backend/alembic/env.py"], CONFIG, root)
    assert [s.doc for s in out] == ["docs/ARCH.md"]
    assert out[0].triggers == ["backend/alembic/versions/1.py", "backend/alembic/env.py"]
    assert out[0].notes == ["Schema."]


def test_name_capture_substituted_and_existence_checked(tmp_path):
    root = make_repo(tmp_path, ["docs/games/yacht.md"])
    changed = ["frontend/src/game/yacht/engine.ts", "frontend/src/game/_shared/x.ts"]
    out = dr.suggest(changed, CONFIG, root)
    assert [s.doc for s in out] == ["docs/games/yacht.md"]  # _shared has no spec -> skipped


def test_missing_doc_dropped_but_kept_without_repo_root():
    changed = ["frontend/src/game/yacht/engine.ts"]
    assert dr.suggest(changed, CONFIG, Path("/nonexistent-root")) == []
    assert [s.doc for s in dr.suggest(changed, CONFIG, None)] == ["docs/games/yacht.md"]


def test_doc_already_touched_is_ticked(tmp_path):
    root = make_repo(tmp_path, ["docs/ARCH.md"])
    changed = ["backend/alembic/env.py", "docs/ARCH.md"]
    out = dr.suggest(changed, CONFIG, root)
    assert out[0].touched is True
    body = dr.render(out)
    assert "- [x] `docs/ARCH.md`" in body


def test_untouched_doc_is_unticked(tmp_path):
    root = make_repo(tmp_path, ["docs/ARCH.md"])
    body = dr.build_comment(["backend/alembic/env.py"], CONFIG, root)
    assert "- [ ] `docs/ARCH.md`" in body


def test_ignored_paths_do_not_trigger(tmp_path):
    root = make_repo(tmp_path, ["docs/games/yacht.md"])
    assert dr.suggest(["frontend/src/game/yacht/__tests__/e.test.ts"], CONFIG, root) == []


def test_empty_result_renders_marker_and_one_liner(tmp_path):
    body = dr.build_comment(["README.md"], CONFIG, tmp_path)
    assert body == f"{dr.MARKER}\n{dr.NO_SUGGESTIONS}\n"
    assert dr.build_comment([], CONFIG, tmp_path) == body


def test_many_triggers_are_truncated(tmp_path):
    root = make_repo(tmp_path, ["docs/ARCH.md"])
    changed = [f"backend/alembic/versions/{i}.py" for i in range(6)]
    body = dr.build_comment(changed, CONFIG, root)
    assert "and 3 more" in body
    assert body.startswith(dr.MARKER)


# --- CLI -----------------------------------------------------------------------------


def test_cli_bad_config_still_succeeds(tmp_path, capsys):
    changed = tmp_path / "changed.txt"
    changed.write_text("backend/alembic/env.py\n")
    cfg = tmp_path / "bad.yml"
    cfg.write_text("- just\n- a list\n")
    rc = dr.main(["--changed", str(changed), "--config", str(cfg), "--repo-root", str(tmp_path)])
    assert rc == 0
    assert capsys.readouterr().out == f"{dr.MARKER}\n{dr.NO_SUGGESTIONS}\n"


def test_cli_writes_out_file(tmp_path):
    root = make_repo(tmp_path, ["docs/ARCH.md"])
    cfg = root / "cfg.yml"
    cfg.write_text("rules:\n  - paths: ['backend/alembic/**']\n    docs: [docs/ARCH.md]\n")
    changed = root / "changed.txt"
    changed.write_text("backend/alembic/env.py\n\n")
    out = root / "out.md"
    dr.main(
        [
            "--changed",
            str(changed),
            "--config",
            str(cfg),
            "--repo-root",
            str(root),
            "--out",
            str(out),
        ]
    )
    assert out.read_text().startswith(dr.MARKER)
    assert "`docs/ARCH.md`" in out.read_text()


# --- the real checked-in config --------------------------------------------------------


def _tracked_files():
    try:
        res = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "ls-files"], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git ls-files unavailable")
    return res.stdout.splitlines()


def test_real_config_every_glob_matches_a_file_and_every_doc_exists():
    config = dr.load_config(REPO_ROOT / ".github" / "doc-reminder.yml")
    files = _tracked_files()
    for rule in config["rules"]:
        for glob in rule["paths"]:
            assert any(dr.match(glob, f) is not None for f in files), f"dead glob: {glob}"
        for doc in rule["docs"]:
            if "{name}" not in doc:
                assert (REPO_ROOT / doc).is_file(), f"missing doc: {doc}"


def test_real_config_examples():
    config = dr.load_config(REPO_ROOT / ".github" / "doc-reminder.yml")
    changed = [
        "backend/alembic/versions/0099_x.py",
        "frontend/src/game/yacht/engine.ts",
        "frontend/src/game/_shared/session.ts",
        "backend/purchases/apple.py",
        ".github/workflows/ci.yml",
    ]
    docs = {s.doc for s in dr.suggest(changed, config, REPO_ROOT)}
    assert {
        "docs/ARCHITECTURE.md",
        "docs/games/yacht.md",
        "docs/IAP.md",
        "docs/CI-CHECKS.md",
    } <= docs
    assert not any("_shared" in d for d in docs)
