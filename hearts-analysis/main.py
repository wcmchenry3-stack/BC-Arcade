from __future__ import annotations

import asyncio
import os
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import analyzer

DATA_DIR = Path(__file__).parent / "data"
REPO_ROOT = Path(__file__).parent.parent

GAMES: list[dict] = []


def _reload_games() -> int:
    global GAMES
    GAMES = analyzer.load_games(str(DATA_DIR))
    return len(GAMES)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _reload_games()
    yield


app = FastAPI(lifespan=lifespan)


# ---------------------------------------------------------------------------
# Static
# ---------------------------------------------------------------------------

@app.get("/")
def index() -> FileResponse:
    return FileResponse(Path(__file__).parent / "static" / "index.html")


# ---------------------------------------------------------------------------
# Analysis endpoints
# ---------------------------------------------------------------------------

@app.get("/api/summary")
def summary() -> dict:
    return analyzer.summary_stats(GAMES)


@app.get("/api/discard-rate")
def discard_rate() -> dict:
    return analyzer.safe_discard_rate(GAMES)


@app.get("/api/qs-timing")
def qs_timing() -> dict:
    return analyzer.qs_dump_timing(GAMES)


@app.get("/api/moon")
def moon() -> dict:
    return analyzer.moon_eligibility(GAMES)


@app.get("/api/pass-direction")
def pass_direction() -> dict:
    return analyzer.pass_direction_breakdown(GAMES)


@app.get("/api/missed-dumps")
def missed_dumps() -> list:
    return analyzer.missed_qs_dumps(GAMES)


@app.get("/api/game-scores")
def game_scores() -> list:
    return [g["finalScores"] for g in GAMES]


# ---------------------------------------------------------------------------
# Reload
# ---------------------------------------------------------------------------

@app.post("/api/reload")
def reload() -> dict:
    n = _reload_games()
    return {"games_loaded": n}


# ---------------------------------------------------------------------------
# Simulate
# ---------------------------------------------------------------------------

AiDifficulty = Literal["easy", "medium", "hard"]


class SimulateRequest(BaseModel):
    count: int = Field(..., ge=1, le=500)
    difficulties: list[AiDifficulty] = Field(default=["medium", "medium", "medium", "medium"])

    def model_post_init(self, __context: object) -> None:
        if len(self.difficulties) != 4:
            raise ValueError("difficulties must have exactly 4 elements")


@app.post("/api/simulate")
async def simulate(req: SimulateRequest) -> dict:
    # Explicitly rebuild safe values so static analysis can verify no injection path
    safe_count = max(1, min(500, int(req.count)))
    safe_diffs = [d for d in req.difficulties if d in {"easy", "medium", "hard"}]
    cmd = [
        "npx", "tsx", "scripts/simulate-hearts.ts",
        "--count", str(safe_count),
        "--difficulties", ",".join(safe_diffs),
    ]
    games_file = DATA_DIR / "games.json"
    # Write stdout directly to file to avoid pipe buffer truncation on large outputs
    with open(games_file, "w", encoding="utf-8") as out_f:
        result = await asyncio.to_thread(
            subprocess.run,
            cmd,
            cwd=str(REPO_ROOT),
            stdout=out_f,
            stderr=subprocess.PIPE,
            text=True,
            timeout=120,
        )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr or "Simulation failed")

    n = _reload_games()
    return {"games_loaded": n}
