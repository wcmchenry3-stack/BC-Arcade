# Testing Guide

See [~/.claude/standards/testing.md](~/.claude/standards/testing.md) for universal conventions (coverage thresholds, what not to test, accessible query priority).

## Project-specific test cases

## Backend

### Setup

```bash
cd backend && python -m pip install -r requirements.txt
```

### Running

```bash
# All tests
python -m pytest tests/ -v

# By file
python -m pytest tests/test_game.py -v       # Yacht game logic
python -m pytest tests/test_api.py -v        # Yacht API endpoints
python -m pytest tests/test_cascade_api.py -v  # Cascade leaderboard API

# With coverage
python -m pytest tests/ -v --cov=. --cov-report=term-missing
```

### Structure

```
backend/tests/
├── __init__.py
├── test_game.py              # YachtGame unit tests — all 13 scoring categories
├── test_api.py               # Yacht FastAPI endpoints via TestClient
└── test_cascade_api.py   # Cascade leaderboard endpoints via TestClient
```

### What's Tested

**test_game.py**

- All 13 scoring categories (hit and miss cases)
- Upper section bonus (triggers at ≥63)
- Roll logic, roll count enforcement (max 3), held dice
- Scoring validation: must roll first, no duplicates, unknown category
- Round advancement, game-over after round 13
- `possible_scores()` only returns unfilled categories

**test_api.py**

- `POST /yacht/new`, `GET /yacht/state`, `POST /yacht/roll`, `POST /yacht/score`, `GET /yacht/possible-scores`

**test_cascade_api.py**

- `POST /cascade/score` — valid submission (201), invalid payloads (422)
- `GET /cascade/scores` — empty initially, sorted descending, capped at 10

### Notes

- API tests use FastAPI's `TestClient` (no running server needed).
- Each test file has an `autouse` fixture that resets in-memory state before/after each test.
- Game logic tests set `game.dice` and `game.rolls_used` directly to avoid randomness.

---

## Frontend

### Setup

```bash
cd frontend && npm install
```

### Running

```bash
npm test
```

### Structure

```
frontend/src/
├── game/cascade/__tests__/
│   ├── scoring.test.ts     # scoreForMerge() pure function
│   └── fruitQueue.test.ts  # FruitQueue peek/consume/bounds
└── theme/__tests__/
    └── fruitSets.test.ts   # All fruit set structural invariants
```

### What's Tested

**scoring.test.ts**

- `scoreForMerge(tier)` returns correct points per tier
- Values double each tier (tiers 0–9)
- Tier 10 (Watermelon) returns the disappear bonus (256)
- Cumulative scoring adds correctly

**fruitQueue.test.ts**

- `peek()` and `peekNext()` return tiers within `[0, MAX_SPAWN_TIER]`
- `consume()` returns the current peek value
- Queue advances correctly after consume
- Never spawns above `MAX_SPAWN_TIER` across 200 samples

**fruitSets.test.ts**

- All 3 sets (fruits, gems, planets) define exactly 11 tiers
- No duplicate tiers within a set; all tiers 0–10 covered
- Every fruit has non-empty name, emoji, and color
- Radii increase monotonically with tier
- Radii are identical across all sets for the same tier (physics skin-agnostic)

### Notes

- Physics engine (Matter.js) is not unit-tested — third-party, no jest DOM available.
- Only pure logic modules are tested (no React components, no canvas).

---

## Manual repros

### Hearts: tab-switch state preservation (#745)

Verifies that `scoreHistory` and full game state survive a top-tab switch
(which unmounts the Lobby HomeStack).

1. Start a Hearts game; play through at least 2 hands so `cumulativeScores`
   are non-zero and the round table has 2+ rows.
2. Mid-game, tap the **Ranks**, **Profile**, or **Settings** bottom-tab.
3. Tap **Lobby** to return; resume Hearts.
4. Open the ⋯ menu → **Scoreboard**. Expected:
   - Round table shows the same number of rows as before the switch.
   - Each row sums to 26 (or `[0,26,26,26]` for moon shots).
   - Totals row equals the sum of every round row, per player.
5. Continue play. **Game Over must not fire spuriously** on re-entry —
   it should only trigger when a player legitimately reaches ≥ 100.

### Hearts: Sentry integrity validators (#745)

Verifies the validators emit warnings when state is impossible. Run with
the Sentry dashboard open and filtered to `subsystem:hearts.integrity`.

1. From a dev build, manually corrupt `AsyncStorage["hearts_game"]` so
   `cumulativeScores[1]` exceeds the sum of `scoreHistory[*][1]` (e.g. via
   React Native Debugger). Re-mount the Hearts screen.
2. Confirm a warning event appears in Sentry tagged
   `subsystem=hearts.integrity, check=totals_vs_rounds_mismatch`.
3. Repeat-mount the screen with the same payload. Confirm Sentry receives
   **at most one** event per check per mount (per-mount dedupe).

### Hearts: hearts-broken sound + animation (#774)

Verifies the crack sound and burst animation fire exactly once when hearts break.

1. Start a Hearts game. Pass phase may occur first — complete it.
2. Play non-heart cards until someone is void in the led suit and must discard a heart.
   (Alternatively: reach trick 2+ where hearts can be led if broken, then lead a heart.)
3. The moment the **first** heart is played into any trick:
   - Confirm the crack sound plays once (audible pop/crack).
   - Confirm a red ♥ icon springs up at the trick center, cracks radiate outward, and a red tint flashes on the trick area.
   - Confirm the icon lingers at reduced opacity (~3 s total), then fades out over 0.5 s.
   - Confirm play is **not blocked** — other cards remain tappable while the animation runs.
4. Play a second heart into a subsequent trick. Confirm the animation and sound do **not** fire again.
5. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, repeat steps 2–3.
   Confirm only an instant red tint flash (~0.3 s) occurs, no spring or crack-line motion.

### Hearts: shoot-the-moon sound + animation (#773)

Verifies the fanfare sound and full-screen moon overlay fire exactly once when someone shoots the moon.

1. Start a Hearts game and engineer a moon shot (one player takes all 13 hearts and Q♠). The easiest way in a local dev build is to seed the engine state via the console so that one AI player holds all 26 point cards after trick 13.
2. Once all 13 tricks resolve, confirm:
   - A triumphant fanfare (hearts-moon-shot.mp3) plays once.
   - A dark semi-transparent full-screen overlay appears with a 🌙 moon icon spring-scaling from 0 → 1.
   - Six ★ stars stagger in around the moon (each 120 ms apart).
   - The shooter label appears below the moon (e.g. "You shot the moon!" or "{Name} shot the moon!").
   - The overlay auto-dismisses after ~2.2 s. Play is **not blocked** — the hand-end modal (or game-over modal) appears after the animation.
3. Re-mount the Hearts screen mid-game (e.g. navigate away and back). Confirm the moon shot animation does **not** replay on re-render.
4. **Mute toggle:** Enable the global mute, trigger a moon shot. Confirm the animation still shows but the sound is suppressed.
5. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, trigger a moon shot. Confirm the moon icon and stars appear instantly (no spring motion) and the label is visible immediately; overlay still auto-dismisses after 2.2 s.

### Hearts: Queen of Spades sound + animation (#775)

Verifies the dark sting sound and card animation fire exactly once when the Queen of Spades is taken.

1. Start a Hearts game and play until a trick containing Q♠ is resolved.
2. The moment the trick resolves (four cards played):
   - Confirm a dark ominous sting (hearts-queen-of-spades.mp3) plays once.
   - Confirm a Q♠ card (white card face with "Q" and "♠") springs up at scale 0 → 1.4×.
   - Confirm the card executes 4 left-right shake iterations (translateX ±8 px).
   - Confirm the card fades to opacity 0 after the shakes.
   - Confirm a full-screen red flash overlay (rgba(220,38,38,0.25)) fades in and out over the ~1.0 s duration.
   - Confirm the taker's label is correctly identified (check the player who took the trick).
3. Confirm play is **not blocked** — the animation runs in parallel with normal game flow.
4. **Reduced-motion fallback:** Enable Reduce Motion in device accessibility settings, trigger a Q♠ trick. Confirm only a red flash (~0.8 s) occurs, no zoom or shake.

### Star Swarm: ship hidden on Game Over freeze frame (#2334)

Verifies the player ship (and any shield/lightning overlay) disappears the instant the
game freezes on death, instead of the frozen frame looking like the ship is still flying
and firing. `engine.ts` clears `playerBullets` on the GameOver transition (unit-tested);
this repro covers the render-only half in `GameCanvas.tsx`, which this repo does not unit
test (see "What's Tested" note above — no React/canvas coverage).

1. Start a Star Swarm run and take the last hit while enemy bullets or diving enemies are
   still on screen (any wave). Bonus: collect Lightning first so bullets are in flight at
   the moment of death, matching the original report.
2. The instant "GAME OVER" appears:
   - Confirm the player ship sprite is **not** visible anywhere on the frozen frame.
   - Confirm no stray player bullet is rendered floating near where the ship was.
   - Confirm the shield ring / lightning tint overlay (if a power-up was active) also
     disappears along with the ship.
   - The rest of the frame (enemies, enemy bullets, starfield) still freezes as expected —
     only the player's own ship/bullets should be gone.

---

## E2E Test Conventions

Guidelines for writing Playwright specs in `e2e/tests/`. These rules exist because each item below caused a real flaky-run incident.

### 1. Storage key versioning

When a game's `localStorage` key changes (e.g. `blackjack_game_v1` → `v2`), search `e2e/` for the old key and update **all** references atomically in the same PR. Partial updates leave some specs clearing the wrong key, leaking state between tests.

```bash
grep -r "blackjack_game_v" e2e/
```

### 2. `data-testid` for i18n-coupled labels

Any element whose accessible label comes from a translation string must also carry a `testID` prop so specs can target it without coupling to translated copy. Elements that currently need this:

- Deal button (`/deal cards with/i`)
- Clear Bet button
- 2048 overlay New Game button
- Cascade Play Again button

### 3. No branching on `isVisible()` without a prior settled wait

Never call `isVisible()` in an `if` branch unless the immediately preceding `await` is `expect(...).toBeVisible()` or `locator.waitFor()` on the **same** locator with no intervening awaits. The snapshot can go stale between the wait and the branch check.

```typescript
// Bad — race window between toBeVisible() and isVisible()
await expect(page.getByText("Hit").or(page.getByText("Next Hand"))).toBeVisible();
const hitVisible = await page.getByText("Hit").isVisible(); // stale snapshot

// Good — isVisible() is inside the same await chain
const hitOrResult = page.getByText("Hit").or(page.getByText("Next Hand"));
await expect(hitOrResult).toBeVisible({ timeout: 5000 });
if (await page.getByText("Hit").isVisible()) { ... }
```

### 4. No `waitForTimeout`

Replace all hard sleeps with assertion-driven waits. Hard sleeps add wall time on fast runners and silently under-budget on slow ones.

```typescript
// Bad
await page.waitForTimeout(2000);
await expect(page.getByText("Score")).toBeVisible();

// Good
await expect(page.getByText("Score")).toBeVisible({ timeout: 8000 });
```

### 5. Non-deterministic outcomes

Tests that exercise live RNG must use the `.or()` pattern for assertions rather than asserting a specific outcome. Tests that need deterministic assertions must use `injectEngineState()` to pre-seed the engine state.

```typescript
// Live RNG — assert either outcome
await expect(
  page.getByText("Hit").or(page.getByText("Next Hand")),
).toBeVisible();

// Deterministic — inject known state
await injectEngineState(page, playerPhaseState());
await expect(page.getByText("Hit")).toBeVisible();
```
