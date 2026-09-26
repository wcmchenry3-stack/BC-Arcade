"""The legacy per-game leaderboard routes are gone (#2644).

Every game ranks on the generic board (``GET /games/leaderboard/{game_type}``,
#2618) and its result card reads ``GET /games/{id}/rank`` (#2677). The
per-game submit, read and name routes, their routers (all but Sort's, which
keeps ``GET /sort/levels``) and their request/response models were deleted.

A removed path with a live sibling under the same prefix (only Sort has one)
still answers 404, not 405: no route matches the path at all.
"""

from __future__ import annotations

import importlib
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

_GAME_ID = "00000000-0000-4000-8000-000000000000"

# (method, path, body) for every removed route.
REMOVED_ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("patch", f"/cascade/score/{_GAME_ID}", {"player_name": "Old"}),
    ("get", "/cascade/scores", None),
    ("post", "/freecell/score", {"player_id": "Old", "move_count": 88}),
    ("get", "/freecell/leaderboard", None),
    ("post", "/hearts/score", {"player_name": "Old", "score": 54}),
    ("get", "/hearts/scores", None),
    ("post", "/mahjong/score", {"player_name": "Old", "score": 1100}),
    ("get", "/mahjong/scores", None),
    ("post", "/solitaire/score", {"player_name": "Old", "score": 400}),
    ("get", "/solitaire/scores", None),
    ("post", "/sort/score", {"player_name": "Old", "level_reached": 5}),
    ("get", "/sort/scores", None),
    ("post", "/starswarm/score", {"player_id": "Old", "score": 900, "wave_reached": 3}),
    ("get", "/starswarm/leaderboard", None),
    ("patch", f"/sudoku/score/{_GAME_ID}", {"player_name": "Old"}),
    ("get", "/sudoku/scores/easy", None),
    ("post", "/yacht/score", {"player_name": "Old", "score": 200}),
    ("get", "/yacht/scores", None),
]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    REMOVED_ROUTES,
    ids=[f"{method.upper()} {path}" for method, path, _ in REMOVED_ROUTES],
)
def test_removed_route_returns_404(method: str, path: str, body: dict[str, Any] | None) -> None:
    kwargs: dict[str, Any] = {"json": body} if body is not None else {}
    r = client.request(method.upper(), path, headers={"X-Session-ID": str(uuid.uuid4())}, **kwargs)
    assert r.status_code == 404, r.text


def test_no_removed_route_is_registered() -> None:
    # The schema lists every route with its full path (app.routes holds each
    # included router lazily, without its prefix).
    paths = set(app.openapi()["paths"])
    assert "/sort/levels" in paths and "/games/leaderboard/{game_type}" in paths
    removed = {path.replace(_GAME_ID, "{game_id}") for _, path, _ in REMOVED_ROUTES}
    removed |= {"/sudoku/scores/{difficulty}"}
    assert paths.isdisjoint(removed), sorted(paths & removed)


def test_sort_levels_is_unaffected() -> None:
    """Sort's router stays for ``GET /sort/levels`` (Sort is free: no grant needed)."""
    r = client.get("/sort/levels", headers={"X-Session-ID": str(uuid.uuid4())})
    assert r.status_code == 200, r.text
    assert len(r.json()["levels"]) == 23


@pytest.mark.parametrize(
    "game", ["cascade", "freecell", "hearts", "mahjong", "solitaire", "starswarm", "sudoku"]
)
def test_router_module_is_gone(game: str) -> None:
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module(f"{game}.router")


@pytest.mark.parametrize(
    "game", ["cascade", "freecell", "hearts", "mahjong", "solitaire", "sort", "sudoku"]
)
def test_legacy_models_are_gone(game: str) -> None:
    models = importlib.import_module(f"{game}.models")
    for name in ("ScoreSubmitRequest", "SetPlayerNameRequest", "ScoreEntry", "LeaderboardResponse"):
        assert not hasattr(models, name), f"{game}.models.{name}"
