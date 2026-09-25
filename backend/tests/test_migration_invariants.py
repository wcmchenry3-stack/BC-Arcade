"""Static invariant tests: migration + frontend/backend event-type contract (#746).

Does NOT require DATABASE_URL — runs offline against migration source files and
the frontend TypeScript config.

Tests:
  test_every_game_type_has_lifecycle_events — each active game_type_id must
    have game_started + game_ended seeded in event_types across all migrations.

  test_event_queue_config_names_are_seeded_in_backend — every event type name
    declared in frontend/src/game/_shared/eventQueueConfig.ts (LIFECYCLE_EVENTS
    + MID_EVENTS) must exist in at least one game's event_types rows across all
    migrations, so frontend-declared event names can never drift silently from
    the backend schema.

  test_migrations_have_a_single_head — two migrations on the same parent make
    `alembic upgrade head` refuse to run, failing the deploy (#2585).
"""

from __future__ import annotations

import importlib.util
import pathlib
import re
import sys
from unittest.mock import MagicMock, patch

import pytest

VERSIONS_DIR = pathlib.Path(__file__).parent.parent / "alembic" / "versions"

# Matches: sa.Column("colname", sa.Boolean(), ...)
_BOOL_COL_DEF_RE = re.compile(r'sa\.Column\(\s*["\'](\w+)["\'],\s*sa\.Boolean')
# Matches SQL strings passed to op.execute() — plain or f-strings, single/double quoted
_EXECUTE_SQL_RE = re.compile(r'op\.execute\(\s*(?:text\(\s*)?f?["\']([^"\']+)["\']')
# Matches SET <col> = <integer> in SQL
_INT_ASSIGN_RE = re.compile(r"\bSET\s+(\w+)\s*=\s*([01])\b", re.IGNORECASE)
EVENT_CONFIG_TS = (
    pathlib.Path(__file__).parent.parent.parent
    / "frontend"
    / "src"
    / "game"
    / "_shared"
    / "eventQueueConfig.ts"
)
LIFECYCLE_EVENTS = frozenset({"game_started", "game_ended"})


class _OpRecorder:
    """Minimal alembic.op stub that records bulk_insert and execute calls."""

    def __init__(self) -> None:
        self.game_type_ids: set[int] = set()
        self.event_pairs: set[tuple[int, str]] = set()
        self._name_to_id: dict[str, int] = {}

    def bulk_insert(self, table: object, rows: list[dict]) -> None:
        table_name = getattr(table, "name", None)
        for row in rows:
            if table_name == "game_types" and "id" in row:
                gt_id = int(row["id"])
                self.game_type_ids.add(gt_id)
                if "name" in row:
                    self._name_to_id[str(row["name"])] = gt_id
            elif table_name == "event_types" and "game_type_id" in row and "name" in row:
                self.event_pairs.add((int(row["game_type_id"]), str(row["name"])))

    def execute(self, stmt: object) -> None:
        # Track: DELETE FROM game_types WHERE name = 'foo'
        m = re.search(
            r"DELETE\s+FROM\s+game_types\s+WHERE\s+name\s*=\s*'(\w+)'",
            str(stmt),
            re.IGNORECASE,
        )
        if m:
            gt_name = m.group(1)
            if gt_name in self._name_to_id:
                self.game_type_ids.discard(self._name_to_id[gt_name])

    def __getattr__(self, item: str):
        # Return a MagicMock so context-manager ops (batch_alter_table, etc.) also work.
        return MagicMock()


def _run_all_upgrades() -> _OpRecorder:
    recorder = _OpRecorder()
    mock_alembic = MagicMock()
    mock_alembic.op = recorder

    patches: dict[str, object] = {
        "alembic": mock_alembic,
        "alembic.op": recorder,
    }

    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name.startswith("__"):
            continue

        with patch.dict(sys.modules, patches):
            spec = importlib.util.spec_from_file_location(f"_mig_{path.stem}", path)
            assert spec and spec.loader
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[union-attr]

        if hasattr(mod, "upgrade"):
            mod.op = recorder  # ensure upgrade() sees the recorder (belt-and-suspenders)
            mod.upgrade()

    return recorder


def test_every_game_type_has_lifecycle_events() -> None:
    """Each active game_type_id must have game_started + game_ended in event_types.

    Checks the aggregate state of all migrations in version order. A game_type_id
    that is later deleted (e.g. pachisi, id=5) is excluded from the assertion so
    only IDs still present in game_types must be covered.
    """
    recorder = _run_all_upgrades()

    missing: list[str] = []
    for gt_id in sorted(recorder.game_type_ids):
        seeded = {name for gid, name in recorder.event_pairs if gid == gt_id}
        lacking = LIFECYCLE_EVENTS - seeded
        if lacking:
            missing.append(f"  game_type_id={gt_id} missing {sorted(lacking)}")

    assert not missing, (
        "Some game_types lack lifecycle event_types rows:\n"
        + "\n".join(missing)
        + "\n\nFix: add a migration that inserts 'game_started' and 'game_ended' "
        "into event_types for each affected game_type_id."
    )


def _parse_frontend_event_names() -> set[str]:
    """Extract all string literals from LIFECYCLE_EVENTS and MID_EVENTS in eventQueueConfig.ts."""
    if not EVENT_CONFIG_TS.exists():
        return set()
    text = EVENT_CONFIG_TS.read_text(encoding="utf-8")
    names: set[str] = set()
    for match in re.finditer(
        r"(?:LIFECYCLE_EVENTS|MID_EVENTS)\s*=\s*new Set\(\[([^\]]+)\]\)", text
    ):
        names.update(re.findall(r'"([^"]+)"', match.group(1)))
    return names


_ALEMBIC_VERSION_MAX_LEN = 32  # alembic_version.version_num is VARCHAR(32)


def test_migrations_have_a_single_head() -> None:
    """Two migrations revising the same parent make `alembic upgrade head`
    refuse to run, which fails the deploy's migration step (#2585; first seen
    with #2535 vs 0020_swap_yacht_blackjack). When the suite provisions its own
    DB, conftest stops the run on this before any test; this covers runs
    against an externally provided DATABASE_URL, where conftest does not
    migrate.

    It sees only the tree it runs on: two PRs that each add a migration on the
    same parent both pass here and collide only once both are merged, which
    this repo's post-merge CI on dev catches (see #2616)."""
    from tests._alembic_heads import multiple_heads_message, script_heads

    heads = script_heads()
    assert len(heads) == 1, multiple_heads_message(heads)


def test_revision_ids_fit_in_alembic_version_column() -> None:
    """All migration revision IDs must be ≤ 32 chars to fit in alembic_version VARCHAR(32).

    Regression guard for the bug that blocked deploys via migrations 0003 and 0010:
    alembic writes version_num to the DB after running upgrade(), and Postgres rejects
    values longer than VARCHAR(32) with StringDataRightTruncation, rolling back the
    entire migration transaction and leaving the service undeployable.
    """
    too_long: list[str] = []
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name.startswith("__"):
            continue
        text = path.read_text(encoding="utf-8")
        m = re.search(r'^revision\s*:\s*str\s*=\s*"([^"]+)"', text, re.MULTILINE)
        if m:
            rev_id = m.group(1)
            if len(rev_id) > _ALEMBIC_VERSION_MAX_LEN:
                too_long.append(f"  {path.name}: '{rev_id}' ({len(rev_id)} chars)")

    assert not too_long, (
        "These migration revision IDs exceed VARCHAR(32) and will break 'alembic upgrade head':\n"
        + "\n".join(too_long)
        + "\n\nFix: shorten the revision string to ≤ 32 characters."
    )


def test_event_queue_config_names_are_seeded_in_backend() -> None:
    """Every event type declared in frontend/eventQueueConfig.ts must exist in at
    least one game's event_types rows across all migrations (#746 PR-B).

    This catches frontend/backend drift: if a developer adds a new event name to
    LIFECYCLE_EVENTS or MID_EVENTS without a matching backend migration, CI fails
    immediately rather than silently dead-lettering events in production.
    """
    if not EVENT_CONFIG_TS.exists():
        pytest.skip(f"eventQueueConfig.ts not found at {EVENT_CONFIG_TS}")

    frontend_names = _parse_frontend_event_names()
    assert frontend_names, "Could not parse any event names from eventQueueConfig.ts"

    recorder = _run_all_upgrades()
    all_seeded_names = {name for _, name in recorder.event_pairs}

    unmatched = sorted(frontend_names - all_seeded_names)
    assert not unmatched, (
        "These event types are declared in eventQueueConfig.ts but not seeded in any "
        "backend event_types migration:\n"
        + "\n".join(f"  • {n}" for n in unmatched)
        + "\n\nFix: add the missing event_types rows to the relevant migration(s) "
        "so the backend can accept these event names."
    )


def test_no_integer_literals_in_boolean_updates() -> None:
    """op.execute() SQL must use 'true'/'false' for boolean columns, not 0/1.

    PostgreSQL rejects integer literals for BOOLEAN columns (DatatypeMismatch).
    SQLite silently coerces them, masking the error until the Postgres deploy fails.

    Regression guard for 0014_game_types_premium_cat (#1154).
    """
    # Collect all boolean column names defined across all migrations
    bool_cols: set[str] = set()
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name.startswith("__"):
            continue
        for m in _BOOL_COL_DEF_RE.finditer(path.read_text(encoding="utf-8")):
            bool_cols.add(m.group(1))

    bad: list[str] = []
    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name.startswith("__"):
            continue
        text_src = path.read_text(encoding="utf-8")
        for sql_m in _EXECUTE_SQL_RE.finditer(text_src):
            sql = sql_m.group(1)
            for assign_m in _INT_ASSIGN_RE.finditer(sql):
                col, val = assign_m.group(1), assign_m.group(2)
                if col in bool_cols:
                    suggestion = "true" if val == "1" else "false"
                    bad.append(f"  {path.name}: SET {col} = {val}  →  use '{suggestion}'")

    assert not bad, (
        "Migration execute() statements use integer literals for boolean columns.\n"
        "PostgreSQL rejects this with DatatypeMismatch; use 'true'/'false' instead:\n"
        + "\n".join(bad)
        + "\n\nSee: https://github.com/wcmchenry3-stack/BC-Arcade/issues/1154"
    )
