# 2048

**Category:** Puzzle  
**Tier:** Free in the v1.0 store build

BC Arcade's 2048 is the standard 4×4 sliding-number puzzle with local save/resume, a score leaderboard, and a run that is considered won when the player first reaches 2048.

Shared session/offline/reporting behavior is defined by [GAME-CONTRACT.md](../GAME-CONTRACT.md). This page owns 2048-specific gameplay, scoring, and run-lifecycle rules.

## How to Play

Swipe the whole 4×4 board up, down, left, or right.

On an effective move:

1. every tile slides as far as it can in that direction;
2. adjacent equal values merge;
3. each tile can participate in at most one merge during that move;
4. one new tile spawns in a random empty cell.

A move that would not change the board is ignored and does not spawn a tile.

## Starting board and tile spawning

A new game begins with **two** randomly placed tiles.

Every spawned tile is:

- **2** with 90% probability;
- **4** with 10% probability.

The game uses a random empty cell for the spawn.

## Merging and score

Two equal tiles merge into their doubled value.

The score increases by the value of each newly created merged tile.

Examples:
- 2 + 2 → 4 and adds 4 points;
- 8 + 8 → 16 and adds 16 points;
- 1024 + 1024 → 2048 and adds 2048 points.

A newly merged tile cannot merge again during the same move.

## Win, Keep Playing, and game over

### Reaching 2048

The first move that creates a **2048** tile is the run's win.

At that moment:
- the game session is completed as `win`;
- the score at that exact moment is the ranked `final_score`;
- the result card appears.

If legal moves remain, the player can choose **Keep Playing**.

### Keep Playing

Keep Playing hides the win card and lets the player continue the local board beyond 2048.

That continuation is deliberately **untracked for the completed session**:

- later points do not replace the ranked score from the 2048 win;
- a later game-over after Keep Playing does not create a second session result/rank submission.

This keeps one game session tied to the first 2048 achievement rather than stretching the same session indefinitely.

### Loss

If no empty cells remain and no horizontally or vertically adjacent equal tiles exist **before 2048 has been reached**, the game ends as `loss`.

The final board score is ranked for that finished run.

## Controls

### Native

Swipe the board in the desired direction.

### Web

Use:
- arrow keys; or
- WASD.

A move is locked briefly during tile animation. One input can be queued during that animation; queued input is dropped when the winning result interrupts play or when the app/screen goes away.

There is no undo feature.

## Scoring and leaderboard

The public board ranks by `final_score`, higher is better.

- One global board; no difficulty/ruleset partitions.
- No natural maximum is declared.
- Equal scores use the shared final tie rule: earlier completion ranks first.

The result block also records:
- `final_score`;
- highest tile;
- move count;
- active-play duration;
- outcome.

Daily Challenge can read score/highest-tile measures from this result data.

## Timer

The active-play clock starts on the first effective move.

It pauses when:
- the app backgrounds; or
- another screen covers the game.

The saved clock banks elapsed active time before a pause/relaunch, so time spent with the app closed does not count.

## Save / resume

The board is saved locally after moves and when play is paused.

A saved in-progress board restores after relaunch, including its accumulated active-play clock.

The local save is cleared when the game is over so the next launch starts fresh.

A board that already reached 2048 can also be restored for Keep Playing, but its original session was already completed at the win.

## Session outcomes

- **win** — first reaches 2048; ranked score freezes at that moment.
- **loss** — game over without having reached 2048; final score ranks.
- **abandoned** — the player starts a new game or leaves while a pre-2048 run is in progress; progress can remain in the result envelope for product features such as Daily Challenge, but the row has no ranked `final_score`.

Older builds used legacy `completed` / `kept_playing` outcomes. Backend compatibility logic preserves those historical rows; new builds use the current win/loss contract.

For generic syncing, ranking, display-name, Stats, and result-card behavior, see [GAME-CONTRACT.md](../GAME-CONTRACT.md).

## Local "Best" vs server history

The screen retains a local best score only to support immediate result-card/UI presentation such as a "New best" badge.

Historical Stats and public ranking come from the shared server reporting model, not legacy local counters.

## Implementation

- Engine: `frontend/src/game/twenty48/engine.ts`
- Screen: [`frontend/src/screens/Twenty48Screen.tsx`](../../frontend/src/screens/Twenty48Screen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Storage: `frontend/src/game/twenty48/storage.ts`
- Types: `frontend/src/game/twenty48/types.ts`
- Backend descriptor: `backend/twenty48/module.py`
