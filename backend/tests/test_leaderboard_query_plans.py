"""EXPLAIN gate: no enabled leaderboard plans a full scan of ``games`` (#2965).

Every board reads through ``top_statement`` (``games/leaderboard.py``, "exposed
for EXPLAIN checks"); ``viewer_entry`` and the rank query apply the same
``board_filters``, so they ride the same index. A board whose filters no
partial index's predicate covers scans every game row of every type on each
``GET /games/leaderboard/{game_type}``; before #2965 that was Mahjong
(``duration_ms``) and Sort (``metadata.level_reached``).

Two gates, run per board and per partition value:

- **Postgres** (production): the statement is EXPLAINed exactly as the app runs
  it (bound parameters, asyncpg) over a seeded table (25,000 rows for each game
  type with an enabled board, half the players named, a quarter of the rows
  unfinished) and ``ANALYZE``d. It fails on a ``Seq Scan`` over ``games``, and
  on any other access to ``games`` that does not seek by ``game_type_id`` (a
  full scan of an unrelated index would hide behind "no Seq Scan"). It runs
  only when ``LEADERBOARD_EXPLAIN_PG_URL`` names a scratch server: the test
  creates its own database there, migrates it to head, and drops it at the
  end. The suite's ``DATABASE_URL`` is never used, since it may name a real
  database. Otherwise it skips, naming the variable. CI's ``test-python`` job
  has no Postgres service, so there it skips.
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
import uuid
from collections.abc import Iterator, Mapping
from typing import Any

import pytest
from sqlalchemy import URL, ClauseElement, Executable, Select, make_url, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.ext.compiler import compiles

from db.base import _normalize_url, get_engine
from games.board import DURATION_METRIC, SCORE_METRIC, BoardDefinition
from games.leaderboard import enabled_board, metric_cap, top_statement
from tests._migration_helpers import run_alembic_url
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


def sqlite_searches_index(detail: str, index: str) -> bool:
    """``detail`` (one EXPLAIN QUERY PLAN row) seeks ``games`` by game type
    through ``index``, in either SQLite wording, covering or not."""
    pattern = rf"SEARCH (TABLE )?games USING (COVERING )?INDEX {re.escape(index)} \(game_type_id=\?"
    return re.match(pattern, detail) is not None


def _suite_dialect() -> str:
    return get_engine().dialect.name


@pytest.mark.parametrize(("game", "board", "partition"), BOARD_CASES)
async def test_sqlite_board_query_searches_its_index(
    game: str, board: BoardDefinition, partition: Mapping[str, str | None]
) -> None:
    if _suite_dialect() != "sqlite":
        pytest.skip(f"the suite DB is not SQLite; run the Postgres gate with {PG_URL_ENV}")
    async with get_engine().connect() as conn:
        gt_id = (await _game_type_ids(conn))[game]
        stmt = top_statement(board, gt_id, partition)
        rows = (await conn.execute(_Explain(stmt, "EXPLAIN QUERY PLAN"))).all()
    details = [str(r[-1]) for r in rows]
    plan = "\n".join(details)
    assert not any(_SQLITE_FULL_SCAN.search(d) for d in details), plan
    index = _expected_index(board)
    assert any(
        sqlite_searches_index(d, index) for d in details
    ), f"{game} should search games through {index}:\n{plan}"


# ---------------------------------------------------------------------------
# Postgres (only against an explicitly named scratch server)
# ---------------------------------------------------------------------------


def explicit_pg_url() -> str | None:
    """``LEADERBOARD_EXPLAIN_PG_URL``, stripped; ``None`` when unset or blank.

    The only source of a Postgres URL for this gate. The suite's own
    ``DATABASE_URL`` is never used: conftest lets it name a real, shared
    database (a Render smoke run), which this test must never seed.
    """
    return os.environ.get(PG_URL_ENV, "").strip() or None


def scratch_server_url(raw: str) -> URL:
    """``raw`` as the asyncpg URL the app would use (``db.base._normalize_url``).

    ``postgres://``, ``postgresql://`` and ``postgresql+asyncpg://`` are
    accepted. The result is also what Alembic loads: ``alembic/env.py`` maps
    ``postgresql+asyncpg://`` to the sync ``postgresql://`` driver, whereas a
    bare ``postgres://`` names no SQLAlchemy dialect at all. Anything else is
    rejected with a message naming the variable.
    """
    url = make_url(_normalize_url(raw))
    if url.drivername != "postgresql+asyncpg":
        raise ValueError(
            f"{PG_URL_ENV} must be a postgres:// or postgresql:// URL, not {url.drivername}://"
        )
    return url


def _url_str(url: URL) -> str:
    return url.render_as_string(hide_password=False)


def _metadata_sql(board: BoardDefinition, params: dict[str, Any]) -> str:
    """A ``jsonb`` expression for a seeded row of ``board``'s game.

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
    """25,000 rows for each game type with an enabled board, none for the rest.

    Game types without a board (Blackjack, Daily Word) are never queried, and
    the enabled types alone already make each board's type about a tenth of
    the table, the selectivity that decides between an index and a scan.
    Refuses, failing the test, if ``games`` already holds rows.
    """
    existing = (await conn.execute(text("SELECT count(*) FROM games"))).scalar_one()
    if existing:
        pytest.fail(f"refusing to seed: games already holds {existing} rows (not a scratch DB)")
    await conn.execute(
        text(
            "INSERT INTO players (session_id, display_name) "
            "SELECT :prefix || i, 'P' || i FROM generate_series(1, :named) i"
        ),
        {"prefix": SESSION_PREFIX, "named": NAMED_SESSIONS},
    )
    for game, board in _enabled_boards():
        params: dict[str, Any] = {
            "prefix": SESSION_PREFIX,
            "gt": game_ids[game],
            "rows": ROWS_PER_TYPE,
            "outcome": (board.qualifying_outcomes or ("completed",))[0],
        }
        metadata = _metadata_sql(board, params)
        cap = metric_cap(board, {})
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


async def _board_plan_problems(gate_url: URL) -> tuple[dict[str, list[str]], Any]:
    """Migrate, seed and EXPLAIN every board case on the gate database."""
    run_alembic_url(_url_str(gate_url), "upgrade", "head")
    engine = create_async_engine(gate_url)
    failures: dict[str, list[str]] = {}
    first_bad_plan: Any = None
    try:
        async with engine.begin() as conn:
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
    finally:
        await engine.dispose()
    return failures, first_bad_plan


async def test_postgres_no_board_plans_a_seq_scan_on_games() -> None:
    """Runs only when ``LEADERBOARD_EXPLAIN_PG_URL`` names a scratch server.

    The URL's own database is used only to ``CREATE DATABASE`` a dedicated,
    uniquely named gate database (``TEMPLATE template0``) and to drop it
    afterwards, so nothing is left behind: not the seeded rows, and not the
    statistics ``ANALYZE`` writes (its ``pg_class`` update is not
    transactional, so a rollback would not undo it). The role needs CREATEDB.
    """
    raw = explicit_pg_url()
    if raw is None:
        pytest.skip(
            f"no Postgres for the EXPLAIN gate: set {PG_URL_ENV}=postgresql://user@host/db "
            "(a scratch server; the test creates and drops its own database there). The "
            "suite's DATABASE_URL is never used. The SQLite gate above runs instead"
        )
    server = scratch_server_url(raw)
    gate_db = f"explain_gate_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(server, isolation_level="AUTOCOMMIT")
    try:
        async with admin.connect() as conn:
            await conn.execute(
                text(f"CREATE DATABASE {gate_db} TEMPLATE template0 ENCODING 'UTF8'")
            )
        try:
            failures, first_bad_plan = await _board_plan_problems(server.set(database=gate_db))
        finally:
            async with admin.connect() as conn:
                await conn.execute(text(f"DROP DATABASE IF EXISTS {gate_db} WITH (FORCE)"))
    finally:
        await admin.dispose()
    summary = "\n".join(f"{case}: {'; '.join(p)}" for case, p in failures.items())
    assert not failures, f"{summary}\n\nfirst failing plan:\n{json.dumps(first_bad_plan)[:8000]}"


@pytest.mark.parametrize(
    "raw",
    [
        "postgres://u:p@db.example:5432/scratch",
        "postgresql://u:p@db.example:5432/scratch",
        "postgresql+asyncpg://u:p@db.example:5432/scratch",
    ],
)
def test_scratch_url_is_normalised_for_asyncpg_and_alembic(raw: str) -> None:
    url = scratch_server_url(raw)
    assert _url_str(url) == "postgresql+asyncpg://u:p@db.example:5432/scratch"


@pytest.mark.parametrize("raw", ["sqlite:///x.db", "mysql://u@h/db", "postgresql+psycopg2://h/d"])
def test_scratch_url_rejects_other_databases(raw: str) -> None:
    with pytest.raises(ValueError, match=PG_URL_ENV):
        scratch_server_url(raw)


def test_only_the_explicit_variable_names_the_postgres_server(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://real@prod-host/app")
    monkeypatch.delenv(PG_URL_ENV, raising=False)
    assert explicit_pg_url() is None
    monkeypatch.setenv(PG_URL_ENV, "   ")
    assert explicit_pg_url() is None
    monkeypatch.setenv(PG_URL_ENV, " postgres://u@h/scratch ")
    assert explicit_pg_url() == "postgres://u@h/scratch"


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


@pytest.mark.parametrize(
    ("detail", "expected"),
    [
        ("SEARCH games USING INDEX games_game_type_score_idx (game_type_id=? AND ...)", True),
        ("SEARCH TABLE games USING INDEX games_game_type_score_idx (game_type_id=?)", True),
        ("SEARCH games USING COVERING INDEX games_game_type_score_idx (game_type_id=?)", True),
        ("SEARCH games USING INDEX games_game_type_completed_idx (game_type_id=?)", False),
        ("SEARCH games USING INDEX games_game_type_score_idx (session_id=?)", False),
        ("SCAN games", False),
    ],
    ids=["current", "pre-3.36", "covering", "other-index", "no-type-seek", "scan"],
)
def test_sqlite_index_reader(detail: str, expected: bool) -> None:
    assert sqlite_searches_index(detail, "games_game_type_score_idx") is expected
