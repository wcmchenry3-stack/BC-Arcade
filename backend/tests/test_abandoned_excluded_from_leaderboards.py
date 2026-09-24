"""Abandoned games never rank on a leaderboard (#2468).

Every per-game leaderboard filters on ``final_score IS NOT NULL`` and used to
ignore ``outcome`` entirely, while six frontend abandon paths do send a score —
Sudoku sends the *completion* formula, so backing out of a Hard puzzle with no
mistakes posted 300, identical to a perfect solve.

One table-driven test per leaderboard rather than a case bolted onto each
game's own suite, so a new game added to ``LEADERBOARDS`` inherits the
guarantee instead of quietly missing it.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from db.base import get_session_factory, is_configured
from db.models import Game, GameEntitlement, GameType

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set — skipping live API tests",
)

# (game_type, leaderboard path, premium slug needing an entitlement grant)
LEADERBOARDS = [
    ("solitaire", "/solitaire/scores", None),
    ("freecell", "/freecell/leaderboard", None),
    ("mahjong", "/mahjong/scores", None),
    ("yacht", "/yacht/scores", "yacht"),
    ("cascade", "/cascade/scores", "cascade"),
    ("hearts", "/hearts/scores", "hearts"),
    ("sort", "/sort/scores", "sort"),
    ("starswarm", "/starswarm/leaderboard", "starswarm"),
    ("sudoku", "/sudoku/scores/hard", "sudoku"),
]

# The nine boards expose their score under different field names (FreeCell
# ranks by `move_count`, StarSwarm by `score`, the rest by `score`/`player_name`),
# so the assertion below looks for the value anywhere in the entry rather than
# hardcoding a key per game. Both values are far outside the 1..2 rank range
# these two-row fixtures produce, so a rank can never be mistaken for a score.
KEPT_SCORE = 500
ABANDONED_SCORE = 999


@pytest.fixture()
def client() -> Iterator[TestClient]:
    assert is_configured()
    from main import app

    with TestClient(app) as c:
        yield c


async def _seed(game_type: str, session_id: str, *, premium_slug: str | None) -> None:
    """Write one finished and one abandoned game, both carrying a score."""
    factory = get_session_factory()
    async with factory() as db:
        from sqlalchemy import select

        gt = (
            await db.execute(select(GameType).where(GameType.name == game_type))
        ).scalar_one_or_none()
        assert gt is not None, f"{game_type} missing from game_types — run migrations"

        if premium_slug:
            db.add(GameEntitlement(session_id=session_id, game_slug=premium_slug))

        # Sudoku partitions its board by difficulty; the others ignore metadata.
        meta = {"difficulty": "hard", "variant": "classic"}
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        for score, outcome, name in (
            (KEPT_SCORE, "completed", "Kept"),
            (ABANDONED_SCORE, "abandoned", "Quit"),
        ):
            db.add(
                Game(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    game_type_id=gt.id,
                    game_metadata={**meta, "player_name": name},
                    players=[],
                    final_score=score,
                    outcome=outcome,
                    completed_at=now,
                )
            )
        await db.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize(("game_type", "path", "premium_slug"), LEADERBOARDS)
async def test_abandoned_game_does_not_rank(
    client: TestClient, game_type: str, path: str, premium_slug: str | None
) -> None:
    sid = str(uuid.uuid4())
    await _seed(game_type, sid, premium_slug=premium_slug)

    r = client.get(path, headers={"X-Session-ID": sid})
    assert r.status_code == 200, r.text
    entries = r.json()["scores"]

    values = [v for entry in entries for v in entry.values()]
    assert KEPT_SCORE in values, f"{game_type}: the finished game should still rank"
    assert ABANDONED_SCORE not in values, f"{game_type}: an abandoned game must never rank"
