"""EXPLAIN gate: no enabled leaderboard plans a full scan of ``games`` (#2965).

Every board reads through ``top_statement`` (``games/leaderboard.py``, "exposed
for EXPLAIN checks"); ``viewer_entry`` and the rank query apply the same
``board_filters``, so they ride the same index. A board whose filters no
partial index's predicate covers scans every game row of every type on each
``GET /games/leaderboard/{game_type}``; before #2965 that was Mahjong
(``duration_ms``) and Sort (``metadata.level_reached``).

Two gates, run per board and per partition value:

- **Postgres** (production): the statement is EXPLAINed exactly as the app runs
  it (bound parameters, asyncpg) over a seeded table (25,000 rows per game type,
  half the players named, a quarter of the rows unfinished) and ``ANALYZE``d,
  inside a transaction that is rolled back. It fails on a ``Seq Scan`` over
  ``games``, and on any other access to ``games`` that does not seek by
  ``game_type_id`` (a full scan of an unrelated index would hide behind "no
  Seq Scan"). It runs when a Postgres URL is reachable: ``LEADERBOARD_EXPLAIN_PG_URL``
  (a scratch database it migrates to head), or the suite's own ``DATABASE_URL``
  when that is Postgres. Otherwise it skips, naming the variable. CI's
  ``test-python`` job has no Postgres service, so there it skips.
- **SQLite** (the default suite DB, so CI): ``EXPLAIN QUERY PLAN`` must search
  ``games`` through the index the board's metric kind is meant to ride, and
  never ``SCAN games``. SQLite honours the same partial-index predicates, so a
  board whose filters stop implying its index's ``WHERE`` fails here too.

See docs/LEADERBOARDS.md "Indexes" for which board rides which index.
"""

from __future__ import annotations

import itertools
import json
import os
import re
from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from sqlalchemy import ClauseElement, Executable, Select, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.ext.compiler import compiles

from db.base import _normalize_url, get_engine
from games.board import DURATION_METRIC, SCORE_METRIC, BoardDefinition
from games.leaderboard import enabled_board, metric_cap, top_statement
from vocab import GameType

PG_URL_ENV = "LEADERBOARD_EXPLAIN_PG_URL"
ROWS_PER_TYPE = 25_000
SESSIONS = 30_000
NAMED_SESSIONS = 15_000
SESSION_PREFIX = "explain-gate-"

# The index each metric kind rides (docs/LEADERBOARDS.md "Indexes").
EXPECTED_INDEX = {
    SCORE_METRIC: "games_game_type_score_idx",
    DURATION_METRIC: "games_game_type_duration_idx",
}
METADATA_INDEX = "games_game_type_completed_idx"


# ---------------------------------------------------------------------------
# Boards under test
# ---------------------------------------------------------------------------


def _partitions(board: BoardDefinition) -> Iterator[dict[str, str | None]]:
    """Every partition the board can be asked for (one ``{}`` when unpartitioned).

    A key with ``partition_values`` takes each of them; otherwise the values its
    ``partition_max_values`` names (Sudoku's difficulties), else its default.
    """
    choices = []
    for key in board.partitions:
        values = board.allowed_values(key) or tuple(
            dict.fromkeys(v for k, v, _ in board.partition_max_values if k == key)
        )
        choices.append(values or (board.partition_default(key),))
    for combo in itertools.product(*choices):
        yield dict(zip(board.partitions, combo, strict=True))


def _enabled_boards() -> list[tuple[str, BoardDefinition]]:
    return [(gt.value, b) for gt in GameType if (b := enabled_board(gt.value)) is not None]


BOARD_CASES = [
    pytest.param(name, board, part, id=f"{name}-{'-'.join(map(str, part.values())) or 'all'}")
    for name, board in _enabled_boards()
    for part in _partitions(board)
]


def test_the_gate_covers_the_boards_that_scanned() -> None:
    """Guards against a vacuous pass: the boards #2965 fixed are in the cases."""
    names = {case.values[0] for case in BOARD_CASES}
    assert {"mahjong", "sort"} <= names
    assert len(names) == len(_enabled_boards())


def _expected_index(board: BoardDefinition) -> str:
    return EXPECTED_INDEX.get(board.metric, METADATA_INDEX)


# ---------------------------------------------------------------------------
# EXPLAIN of the statement as the app executes it (bound parameters)
# ---------------------------------------------------------------------------


class _Explain(Executable, ClauseElement):
    """``<prefix> <statement>``, compiled by the connection's own dialect, so
    the plan is that of the bound-parameter query ``top_entries`` runs."""

    inherit_cache = False

    def __init__(self, statement: Select, prefix: str) -> None:
        self.statement = statement
        self.prefix = prefix


@compiles(_Explain)
def _compile_explain(element: _Explain, compiler: Any, **kw: Any) -> str:
    return f"{element.prefix} {compiler.process(element.statement, **kw)}"


async def _game_type_ids(conn: AsyncConnection) -> dict[str, int]:
    return dict((await conn.execute(text("SELECT name, id FROM game_types"))).tuples().all())


# ---------------------------------------------------------------------------
# SQLite (default suite DB)
# ---------------------------------------------------------------------------

# "SCAN games" (3.36+) or "SCAN TABLE games" (older); a covering-index scan
# ("SCAN games USING ... INDEX") still reads every row.
_SQLITE_FULL_SCAN = re.compile(r"\bSCAN (TABLE )?games\b")


def _suite_dialect() -> str:
    return get_engine().dialect.name


@pytest.mark.parametrize(("game", "board", "partition"), BOARD_CASES)
async def test_sqlite_board_query_searches_its_index(
    game: str, board: BoardDefinition, partition: Mapping[str, str | None]
) -> None:
    if _suite_dialect() != "sqlite":
        pytest.skip("the suite DB is not SQLite; the Postgres gate below covers it")
    async with get_engine().connect() as conn:
        gt_id = (await _game_type_ids(conn))[game]
        stmt = top_statement(board, gt_id, partition)
        rows = (await conn.execute(_Explain(stmt, "EXPLAIN QUERY PLAN"))).all()
    details = [str(r[-1]) for r in rows]
    plan = "\n".join(details)
    assert not any(_SQLITE_FULL_SCAN.search(d) for d in details), plan
    index = _expected_index(board)
    assert any(
        d.startswith(f"SEARCH games USING INDEX {index} (game_type_id=?") for d in details
    ), f"{game} should search games through {index}:\n{plan}"


# ---------------------------------------------------------------------------
# Postgres
# ---------------------------------------------------------------------------


def _postgres_url() -> str | None:
    explicit = os.environ.get(PG_URL_ENV, "").strip()
    if explicit:
        return explicit
    suite = os.environ.get("DATABASE_URL", "")
    return suite if suite.startswith(("postgres://", "postgresql")) else None


def _metadata_sql(board: BoardDefinition, params: dict[str, Any]) -> str:
    """A ``jsonb_build_object`` for a seeded row of ``board``'s game.

    Partition keys cycle through their values; a metadata metric (Sort's
    ``level_reached``) and a tie-break key get integers in range.
    """
    partitions = list(_partitions(board))
    cases = []
    for n, part in enumerate(partitions):
        params[f"part{n}"] = json.dumps(part)
        cases.append(f"WHEN {n} THEN CAST(:part{n} AS jsonb)")
    partition_sql = f"CASE i % {len(partitions)} {' '.join(cases)} END"
    pairs = []
    if board.metric not in (SCORE_METRIC, DURATION_METRIC):
        params["metric_key"] = board.metric
        pairs.append(f"CAST(:metric_key AS text), 1 + i % {metric_cap(board, {})}")
    if board.tiebreak is not None:
        params["tiebreak_key"] = board.tiebreak[0]
        pairs.append("CAST(:tiebreak_key AS text), 10 + i % 400")
    extra = f"jsonb_build_object({', '.join(pairs)})" if pairs else "'{}'::jsonb"
    return f"({partition_sql} || {extra})"


async def _seed_postgres(conn: AsyncConnection, game_ids: Mapping[str, int]) -> None:
    await conn.execute(
        text(
            "INSERT INTO players (session_id, display_name) "
            "SELECT :prefix || i, 'P' || i FROM generate_series(1, :named) i"
        ),
        {"prefix": SESSION_PREFIX, "named": NAMED_SESSIONS},
    )
    boards = dict(_enabled_boards())
    for game, gt_id in game_ids.items():
        board = boards.get(game)
        params: dict[str, Any] = {"prefix": SESSION_PREFIX, "gt": gt_id, "rows": ROWS_PER_TYPE}
        metadata = _metadata_sql(board, params) if board else "'{}'::jsonb"
        cap = metric_cap(board, {}) if board else 1000
        outcomes = board.qualifying_outcomes if board else None
        params["outcome"] = (outcomes or ("completed",))[0]
        # A quarter unfinished, a tenth abandoned, the rest finished with
        # every metric column set and in range.
        await conn.execute(
            text(
                "INSERT INTO games (id, session_id, game_type_id, started_at, completed_at, "
                "final_score, outcome, duration_ms, metadata) "
                "SELECT gen_random_uuid(), "
                f":prefix || (1 + (i * 7919) % {SESSIONS}), :gt, "
                "now() - make_interval(secs => i), "
                "CASE WHEN i % 4 = 0 THEN NULL "
                "ELSE now() - make_interval(secs => i) + make_interval(mins => 5) END, "
                f"CASE WHEN i % 4 = 0 THEN NULL ELSE i % {min(cap, 1000) + 1} END, "
                "CASE WHEN i % 4 = 0 THEN NULL WHEN i % 10 = 1 THEN 'abandoned' "
                "ELSE CAST(:outcome AS text) END, "
                "CASE WHEN i % 4 = 0 THEN NULL ELSE 40000 + (i * 31) % 900000 END, "
                f"{metadata} "
                "FROM generate_series(1, :rows) i"
            ),
            params,
        )
    await conn.execute(text("ANALYZE games"))
    await conn.execute(text("ANALYZE players"))


def _nodes(node: Mapping[str, Any]) -> Iterator[Mapping[str, Any]]:
    yield node
    for child in node.get("Plans", ()):
        yield from _nodes(child)


def postgres_plan_problems(plan: Mapping[str, Any]) -> list[str]:
    """Why a Postgres JSON plan reads ``games`` without seeking by game type.

    Empty when every access to ``games`` is an index or bitmap scan whose
    index condition seeks by ``game_type_id`` (and there is at least one).
    """
    problems: list[str] = []
    scans = [n for n in _nodes(plan) if n.get("Relation Name") == "games"]
    if not scans:
        return ["the plan never reads games"]
    for scan in scans:
        kind = scan["Node Type"]
        if kind in ("Index Scan", "Index Only Scan"):
            conds = [(scan.get("Index Name"), scan.get("Index Cond", ""))]
        elif kind == "Bitmap Heap Scan":
            conds = [
                (n.get("Index Name"), n.get("Index Cond", ""))
                for n in _nodes(scan)
                if n["Node Type"] == "Bitmap Index Scan"
            ]
        else:
            problems.append(f"{kind} on games")
            continue
        for index, cond in conds or [(None, "")]:
            if "game_type_id" not in cond:
                problems.append(f"{kind} on games via {index} without a game_type_id seek")
    return problems


async def test_postgres_no_board_plans_a_seq_scan_on_games() -> None:
    url = _postgres_url()
    if url is None:
        pytest.skip(
            f"no Postgres reachable: set {PG_URL_ENV}=postgresql://user@host/scratch_db "
            "(migrated to head, seeded and rolled back by this test) to run the Postgres "
            "EXPLAIN gate; the SQLite gate above runs instead"
        )
    if os.environ.get(PG_URL_ENV):
        from tests._migration_helpers import run_alembic_url

        run_alembic_url(url, "upgrade", "head")
    engine = create_async_engine(_normalize_url(url))
    failures: dict[str, list[str]] = {}
    first_bad_plan: Any = None
    try:
        async with engine.connect() as conn, conn.begin() as trans:
            game_ids = await _game_type_ids(conn)
            await _seed_postgres(conn, game_ids)
            for case in BOARD_CASES:
                game, board, partition = case.values
                stmt = top_statement(board, game_ids[game], partition)
                plan_json = (await conn.execute(_Explain(stmt, "EXPLAIN (FORMAT JSON)"))).scalar()
                plan = (json.loads(plan_json) if isinstance(plan_json, str) else plan_json)[0]
                if problems := postgres_plan_problems(plan["Plan"]):
                    failures[case.id] = problems
                    first_bad_plan = first_bad_plan or plan["Plan"]
            await trans.rollback()
    finally:
        await engine.dispose()
    summary = "\n".join(f"{case}: {'; '.join(p)}" for case, p in failures.items())
    assert not failures, f"{summary}\n\nfirst failing plan:\n{json.dumps(first_bad_plan)[:8000]}"


# ---------------------------------------------------------------------------
# The plan reader itself (no database needed)
# ---------------------------------------------------------------------------


def _bitmap(index: str, cond: str) -> dict[str, Any]:
    return {
        "Node Type": "Bitmap Heap Scan",
        "Relation Name": "games",
        "Plans": [{"Node Type": "Bitmap Index Scan", "Index Name": index, "Index Cond": cond}],
    }


@pytest.mark.parametrize(
    ("plan", "expected"),
    [
        (_bitmap("games_game_type_duration_idx", "((game_type_id = 9) AND ...)"), []),
        (
            {
                "Node Type": "Index Scan",
                "Relation Name": "games",
                "Index Name": "games_game_type_completed_idx",
                "Index Cond": "(game_type_id = '12'::smallint)",
            },
            [],
        ),
        (
            {"Node Type": "Gather", "Plans": [{"Node Type": "Seq Scan", "Relation Name": "games"}]},
            ["Seq Scan on games"],
        ),
        (
            {
                "Node Type": "Index Scan",
                "Relation Name": "games",
                "Index Name": "games_pkey",
            },
            ["Index Scan on games via games_pkey without a game_type_id seek"],
        ),
        (
            _bitmap("games_session_id_started_at_idx", "(session_id = 'x')"),
            [
                (
                    "Bitmap Heap Scan on games via games_session_id_started_at_idx "
                    "without a game_type_id seek"
                )
            ],
        ),
        ({"Node Type": "Seq Scan", "Relation Name": "players"}, ["the plan never reads games"]),
    ],
    ids=["bitmap-seek", "index-seek", "seq-scan", "full-index-scan", "wrong-index", "no-games"],
)
def test_postgres_plan_reader(plan: dict[str, Any], expected: list[str]) -> None:
    assert postgres_plan_problems(plan) == expected
