# Cascade

**Category:** Arcade
**Tier:** Premium (`PREMIUM_GAMES`; the backend marks it premium)
**Status:** Shipped as a premium game (v2 rework, epic #3033). Like every premium game it is hidden in store builds until the premium games are unhidden (`HIDDEN_GAMES` in `frontend/src/entitlements/gameVisibility.ts`), and shown in dev, test and pre-launch builds. (From #3001 until #3703 it was also held out of store builds and unsold while it was reworked.)

This is the canonical specification of Cascade's gameplay, written against the engine as it stands on `dev` after the v2 rework (epic #3033). It is in two parts; the second is a separate file.

- **Part 1 (sections 1 to 14, Known limitations, and Recording and replay): the specification.** What a player sees and what the rules are, with the exact numbers, each tied to the code that owns it. Everything a player can observe is here.
- **Part 2: [the decision log](cascade-decisions.md).** The module map, the physics tuning, the renderer, the art, the sim harness, the measurements and the owner decisions behind the rules. Words in parentheses there that compare a rule with an earlier design are history, not rules: Part 1 is the contract.

Where this document and the code disagree, the code is right and this document is a bug. Shared rules are linked, not copied: the session and result envelope in [GAME-CONTRACT.md](../GAME-CONTRACT.md), boards in [LEADERBOARDS.md](../LEADERBOARDS.md), screen structure and input in [GAMEPLAY_STANDARDS.md](../GAMEPLAY_STANDARDS.md), screen readers and Reduce Motion in [ACCESSIBILITY.md](../ACCESSIBILITY.md). Research and design records that led here (not canonical): [`CASCADE_PHYSICS_SPIKE.md`](../research/CASCADE_PHYSICS_SPIKE.md), [`CASCADE_FEEL_PROPOSALS.md`](../research/CASCADE_FEEL_PROPOSALS.md), [`CASCADE_PHYSICS.md`](../research/CASCADE_PHYSICS.md) (the earlier physics engine), [`CASCADE_ASSET_SPIKE.md`](../research/CASCADE_ASSET_SPIKE.md), [`CASCADE-THEMING.md`](../research/CASCADE-THEMING.md) (both superseded by [Art](cascade-decisions.md#art-3698)) and the [sound design log](cascade-sound-design.md).

## Part 1: The specification

### 1. Objective, win and game over

Cascade is a physics piece-drop game in the Suika family. Pieces fall into a bin. Two pieces of the same tier that touch merge into one piece of the next tier, and the merge scores points. The game has one winning condition and two losing ones.

- **Win.** Merge two tier-9 pieces (Watermelon / Sun) into the **capstone**, tier 10 (Pumpkin / Milky Way). By any merge path (contact, the 1.5 px merge-gap scan or chain reach). Play ends at that step: no more drops, the score is final, a celebration plays and the "You Win!" card follows. The capstone is never dropped, never merges, and two on the board (only the dev panel or a test restore can put them there) are not a win. See [The win](cascade-decisions.md#the-win-3920) and [The celebration and the win card](cascade-decisions.md#the-celebration-and-the-win-card-3699).
- **Loss: the lid (overflow).** A settled piece whose top edge is above the lid line (y = 80 of the 600-unit world) for 180 consecutive physics steps (3 s) ends the game (`gameOver`, reason `overflow`). A merge in the danger band pauses the count for 1 s. See [section 6](#6-danger-and-the-lid).
- **Loss: the hard stop.** A settled piece whose top edge reaches the top of the board (y <= 0) ends the game at once (reason `hardStop`). The last dropped piece gets a 0.5 s grace.
- **Nothing else ends a game.** There is no move limit, no timer and no lives. Leaving the screen, restarting or switching the piece set ends the _session_ as an abandon, never as a loss (see [section 9](#9-save-resume-and-abandon)).

### 2. The ladder and the merge rules

There are **11 fixed tiers** (0-10) and two piece sets, **Fruits** and **Cosmos**, with the same rules and different art, names and sounds. The player picks the set with the toggle under the score. Switching it mid-game (a piece on the board, not won or over) asks first: a "Switch piece set?" confirm (Keep playing / Switch and start new game) leaves the game untouched until the player confirms, and the confirmed switch abandons the game and starts a new one. On a fresh or finished board it switches at once, and tapping the set already active does nothing (#3970).

| Tier | Fruits        | Cosmos    | Radius | Drawn | Density | Score | Droppable |
| ---- | ------------- | --------- | ------ | ----- | ------- | ----- | --------- |
| 0    | Cherry        | Pluto     | 11.5   | 11.3  | 1.00    | 1     | yes       |
| 1    | Blueberry     | Mercury   | 14.2   | 14.0  | 0.90    | 2     | yes       |
| 2    | Lemon         | Mars      | 17.7   | 17.4  | 0.81    | 4     | yes       |
| 3    | Grape         | Venus     | 21.9   | 21.5  | 0.73    | 8     | yes       |
| 4    | Orange        | Earth     | 27.1   | 26.7  | 0.65    | 16    | yes       |
| 5    | Apple (green) | Neptune   | 33.6   | 33.1  | 0.59    | 32    | yes       |
| 6    | Coconut       | Uranus    | 41.6   | 41.0  | 0.53    | 64    | no        |
| 7    | Dragonfruit   | Saturn    | 51.5   | 50.8  | 0.47    | 128   | no        |
| 8    | Pineapple     | Jupiter   | 63.8   | 62.9  | 0.42    | 256   | no        |
| 9    | Watermelon    | Sun       | 79.1   | 77.9  | 0.38    | 512   | no        |
| 10   | Pumpkin       | Milky Way | 98.0   | 96.5  | 0.34    | 1024  | no        |

Radii are world units (the bin is 400 x 600; its inner width is 360). This table is a copy of `frontend/src/game/cascade/tiers.ts`, the only place a tier's radius, score, density, droppable flag and name keys are defined; `tiers.test.ts` fails if another module defines one. How the radii, densities and drawn radii were chosen: [Piece progression](cascade-decisions.md#piece-progression).

- **Droppable tiers are 0-5.** Tiers 6-10 exist only by merging.
- **Merge rule.** Two same-tier pieces merge (tier n < 10 into n + 1; two tier-9 pieces into the capstone) when a physics contact begins between them, or when their circles are within **1.5 px** (`MERGE_GAP_PX`) at the end of a step (resting pieces sit a fraction of a pixel apart, which looks like touching).
- **The new piece** appears at the midpoint of its parents, clamped so its full circle is inside the walls and above the floor, with their mean velocity (capped at 3 px per step) and a small upward pop (0.4 px per step). It starts at its parents' size and **grows to its own over 16 steps (267 ms)**, easing its neighbours aside; the lid, the merge grace and the drop gate use the full size throughout.
- **Chains.** A merge product that touches a third piece of its own tier merges again without waiting for its grow-in (**chain reach**, 2 px at full size, checked in the step it is made and every step it grows), so a chain runs one link per step. The screen's "chain" is the count of merges since the last drop; see [section 8](#8-motion-and-celebration-states).
- **Pieces never leave the bin.** Merges only remove bodies; nothing is teleported; a safety net puts a piece that somehow escaped back and reports it in dev builds (the sim requires zero).

### 3. Scoring and the time bonus

- **Merge score.** Each merge adds the score of the piece it makes: `2^n` for a merge into tier n (1 for a Cherry up to 1024 for the capstone; the winning merge scores its normal 1024, with no extra, and there is no jackpot). The per-tier values are final (owner, #2823); the time bonus (#3700) was tuned against them.
- **Time bonus (win only).** `time_bonus = round(20000 x max(0, 1 - t / 360000))`, `t` being the game's `duration_ms` (active play time). A loss gets 0. A win under **20 s** (`MIN_WIN_MS`), or with no duration, gets 0 and is stored anyway; it is never rejected.
- **Final score** = merge score + time bonus, **computed by the server**; the app mirrors the formula for display only. Rounding is half up in integer arithmetic on both sides. Rule version `BONUS_RULE` = 1.
- **The play clock** starts at the game's first piece (a drop, or a test or dev placement), so time looking at an empty board costs nothing; it stops while another screen covers the board or the app is in the background, and for good at the win or the lid. It uses the monotonic clock (`monotonicNow()`), so changing the device time cannot change it (#3925). See [Scoring (Persistence)](cascade-decisions.md#scoring-persistence) for why these numbers.

### 4. Spawn, drop and input

- **What drops.** The piece to drop (DROP) and the next one (NEXT) come from a queue. Each draw picks a droppable tier (0-5) by weight: base `2 3 3 3 2 1`; **drought boost** (+3 to any tier absent from the queue's last 10 picks, which include DROP and NEXT); **danger mode** (when the pile is near the lid: tiers 2-4 scaled to 20 % and the top droppable tier, 5, to 35 %, fractional); **streak ban** (a tier that filled the last 4 picks is banned for one draw). Details and rationale: [Piece Queue & Spawn Selection](cascade-decisions.md#piece-queue--spawn-selection-piecequeuets-spawnselectorts).
- **Where it spawns.** At the aim x, with its top edge above the lid (centre at `lid - radius - 5`); x is clamped so the whole piece is between the walls, after a seeded nudge of at most +-0.4 px so a column of same-x drops still topples. A tier-5 piece spawns with its top edge at y = 7.9, on the canvas.
- **When a drop is allowed.** Every gate must pass: the game is not over or won; the engine's `canDrop()` (the last piece has fallen with its top edge at or under the lid, or merged into one that has); the 200 ms drop cooldown; the board is not settling after a restore (60 frames: 1 s at 60 Hz, 0.5 s at 120 Hz); the player is not away (another screen covers the board, or the app is in the background). A refused drop does nothing. While the engine refuses a drop (`canDrop()`: the last piece is still over the lid, or play has ended) the spawner shows a dashed, faded "waiting" ghost; the other gates show nothing.
- **Input: press, drag, release** (`CascadeAimArea`, owner pick #3928 "Dashed line + ghost"). A finger on the board does nothing yet. **Tap** (released within 90 ms and 10 pt): drops at once at the press x, no guide. **Drag** (moving past the slop or holding past 90 ms): the spawner piece glides to the finger and follows it, clamped by its radius; a dashed plumb line and a ghost show where it would first touch (first contact, not where it then rolls); one selection haptic when the finger first moves past the 10 pt slop. **Release** drops at the aim x through the same gates. **Cancel** (leaving the board's rect, a second finger, or the system taking the gesture): the piece glides back and **nothing drops**; coming back onto the board before release aims again. Swipe-back is off on this screen. The full table, the gesture's activation rules and the thread model: [Aiming](cascade-decisions.md#aiming-3928).
- **Screen readers.** The board has a label and hint and an "activate" action; a double-tap drops the next piece in the middle of the bin.
- **Web.** The same gesture works with a mouse and with touch; a non-finite x never drops.
- **Keyboard (web only, #3934).** The board is a tab stop with a visible focus ring (keyboard focus only). **Left / Right** move the aim 16 world px, **Shift + arrow** 64; **Space or Enter** drops at the aim (in the middle with no aim) through the same gates; **Escape** cancels (the piece glides back, nothing drops). The first arrow starts from the spawner's centre; the aim stays between the walls. Keys never move a pointer's aim, losing focus cancels a keyboard aim, keys do nothing at game over, and there is no haptic. iOS and Android have no listeners and no tab stop. Details: [Aiming](cascade-decisions.md#aiming-3928).

### 5. Player-visible physics

Pieces are true circles in a planck.js (Box2D) world: gravity 2,500 px/s^2, restitution 0.2, friction 0.12, light air friction, free rolling (spin clamped), 60 fixed steps a second (up to 3 per frame; slower than 20 fps the game runs slower than the wall clock instead of queueing). What a player sees as a result:

- Pieces roll and settle; heavier (bigger) pieces sink into lighter ones, mass growing as radius^1.5 (the capstone is 24.9 times a Cherry).
- Each game's deepest overlap is gated in the sim at a 3 px median and a 5 px p90 across games, and the mean visible gap must stay above −0.5 px (about +0.8 px measured); each piece is drawn 1.5 % inside its collider so neighbours show a hair of gap.
- Walls are solid, 200 px thick, and reach 600 px above the canvas; nothing tunnels out and there is no teleporting guard rail.
- The same fixed steps run at 60 and 120 Hz, so the rules (lid, merge grace, chain timing) take the same simulated time at either rate.
- The same frame deltas and seed replay the same board, bit for bit, on one JS engine; not across engines. Do not build anything that needs the same board on two engines on it.
- The tuning and why each number is what it is: [Physics](cascade-decisions.md#physics) and [Overlap](cascade-decisions.md#overlap-3904).

### 6. Danger and the lid

The lid is the line at `OVERFLOW_LINE_Y` = 80. All counts are in fixed steps, never frames or wall-clock time.

- A piece **counts** when it is settled (speed at most 8 px per step) and its top edge is above the lid. A dropped piece still falling from the spawner does not count until it first touches a piece or the floor. While at least one piece counts, a counter rises by one a step and a step with none resets it. At **180 steps (3 s)** the game ends (overflow).
- **Merge grace.** A merge involving a piece whose top edge is at or above y = 160 (the danger band, `OVERFLOW_LINE_Y + DANGER_STACK_MARGIN`) resets the counter and pauses it for **60 steps (1 s)**. A merge lower in the bin does nothing. There is no other grace.
- **Hard stop.** Top edge at y <= 0 while settled ends the game at once; the piece just dropped must stay settled there for 30 steps (0.5 s) first.
- **What the player sees.** The lid line reddens as the counter runs; a clock ring around the spawner piece drains clockwise from cyan to red (glow from 70 %); pieces over the lid get a red wash while the counter runs; a danger blink (period 1,000 down to 340 ms as the ratio rises, never more than 3 flashes a second) and, with sound on, one tick on each on-beat. A game over dims the pile, flashes the lid twice and shows the card after 1 s.
- **Danger mode of the spawner** uses the same line, y = 160, but tests piece centres: any piece, falling or not, whose centre is above it puts the spawner in danger mode; it is what lowers the weights of the big droppable tiers (section 4).
- **Restore.** A restored game gets the merge grace once while the pieces settle; the hard stop applies at once; a saved piece over the lid that touches nothing is treated as falling again.
- Every number's reasoning, and the regression gate (the spam bot loses within 120 s, never wins): [Game over: the lid](cascade-decisions.md#game-over-the-lid).

### 7. The next-piece preview

Two chips above the board, left of the score: **DROP** (the piece the spawner holds, drawn 22 pt) and **NEXT** (the one after it, 16 pt), each with the piece's drawn glyph (`NextFruitPreview`, `FruitGlyph`, the same art as the board). After each drop NEXT hops into DROP in an arc and the new NEXT pops in (Reduce Motion: both fade in). The queue is the engine-independent `{ current, next }` pair of `pieceQueue.ts`; the piece after NEXT is drawn at the moment of the drop, so danger mode shapes it two drops ahead. The queue is saved and restored with the game. Both chips are screen-reader elements ("Dropping next: Cherry", "Coming up: Lemon").

### 8. Motion and celebration states

Everything is drawn in code on the board's Skia Picture on the UI thread; nothing per frame goes through React. Every duration, easing, size and count is in `game/cascade/motion.ts` (`MOTION`) and `celebration.ts`.

| State           | What the player sees (with motion)                                                                                        | Reduce Motion                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Aiming          | Piece glides to the finger; dashed guide and ghost                                                                        | At the finger at once; guide shows and hides at once; dashes stand still |
| Drop            | Next piece drops into the spawner (320 ms)                                                                                | Fades in                                                                 |
| Land            | Damped squash (7 % for a Cherry, +1.2 % a tier, 13 % for the largest droppable piece) and 6 dust puffs                    | None (sound and haptic still play)                                       |
| Merge           | Grow-in, `MergeBurst`, white flash, ring to 2x radius, 12 confetti dots                                                   | A short flash in place (200 ms); no burst, ring or confetti              |
| Chain           | "xN" counter from the second link, paced 80 ms a link, pops and sparkles                                                  | Fades in once, then the number swaps                                     |
| Danger          | Ring, red wash, lid line, square-wave blink                                                                               | No blink; a tick sound keeps the warning                                 |
| Game over       | Pile dims, lid flashes twice, card at 1,000 ms                                                                            | Dim fades in 300 ms, steady red lid, card at 1,000 ms                    |
| Win celebration | Capstone grows in, pile dims, capstone rises and turns, glow, ring, rays or swirl, cheering face, twinkles, card at 2.1 s | Dim, glow, ring and face fade in where it lies; card at 1.6 s            |

- **Chain** means merges since the last drop; the first is a plain merge, the second shows x2. A merge while a restored game settles, or in a test fast-forward, does not count.
- **The win celebration** is owner pick "A Spotlight with C's cheering face" (#3699); the timeline table, the clock and why it is stepped are in [The celebration and the win card](cascade-decisions.md#the-celebration-and-the-win-card-3699). **The win card** is the shared `GameResultModal` with outcome `win` ("You Win!", the score, New best, Merge score, Time bonus, Time, Best, View leaderboard, Play Again, Home). A loss card is outcome `ended` ("Game Over": the score, Best, Merges, Time; no bonus line). The card never covers the animation.
- **Haptics** (iOS and Android only, no setting): land Light or Medium by tier; merge Medium, Heavy or double Heavy by tier; chain steps Light, Medium, Heavy; one Warning when the lid count passes 0.5; the win's Success is the card's. Paced and best-effort. Table in [Motion and haptics](cascade-decisions.md#motion-and-haptics-3701).
- The danger blink never exceeds 3 flashes a second (WCAG 2.3.1).

### 9. Save, resume and abandon

- **Autosave.** The board (each piece's tier and position), score, queue, `playedMs` and the replay log's place (`replay`, #3858) are saved to AsyncStorage (`cascade_game_v7`, `SavedState` v7) at most every 2 s after drops and merges, and in full when another screen covers the board or the app goes to the background. Velocities are not saved.
- **Resume.** On open, a saved game with at least one piece is restored at rest, the play clock continues from `playedMs` (the time the app was closed does not count), the session a killed app left open is continued (#2654), and drops are refused for 60 frames (1 s at 60 Hz) while the pile settles; the lid's merge grace applies once. Nothing is saved or restored for a game that has been won or lost: the save is cleared at the win and at the game over, so a relaunch starts a new game.
- **Old saves.** A present but invalid or older-version save is discarded, never migrated and never falls back to an older one; its key is removed. History: [Persistence](cascade-decisions.md#persistence-storagets).
- **New game / abandon.** Restart (the shell's New Game, Play Again) and a confirmed switch of Fruits / Cosmos start a fresh game and clear the save; they end the session as `abandoned` with the score so far. A mid-game switch is confirmed first (#3970): while the dialog is open it is an app overlay, so the play clock and loop pause, and Cancel leaves the board, score, queue, clock, save and selected set unchanged and records nothing; a fresh or finished game switches with no dialog. Leaving the screen records `abandoned` once a piece has been dropped (an unplayed game is discarded without a row). Abandoned rows never rank or count toward Best.
- A game that was never started (no piece dropped) posts nothing; the session row is created at the first drop (`markStarted`).

### 10. Backend session and result contract

Cascade has no endpoints of its own: it uses the generic `/games` routes (the legacy `/cascade/score` and `/cascade/scores` were removed in #2644). Shared rules: [GAME-CONTRACT.md](../GAME-CONTRACT.md) (session lifecycle, `result_model` merge, leaderboard routes).

- **Module.** `backend/cascade/module.py`: `GameType.CASCADE`, `CascadeMetadata` (`player_name`, max 64; current builds send none), result model `CascadeResult` (`backend/cascade/models.py`, `extra="ignore"`), `has_winner = True`, board `final_score` descending, label `score`. `derive_final_score` stores merge score + the server's time bonus, overwriting whatever the app sent (never a 400: a 400 on `/complete` dead-letters the game).
- **Session.** `useGameRecorder("cascade")` (`useGameSync` plus the shared replay recorder): `POST /games` at the first drop, then `PATCH /games/{id}/complete`. The replay events it records (`game_started`, `drop`, `merge`, `game_ended`) are in [Recording and replay](#recording-and-replay-3858); the server validates `drop` and `merge` (`backend/cascade/events.py`) and holds a game to `CASCADE_CAP` in `backend/games/replay_caps.py` (128 events, 80 KB).
- **Outcomes.** `win` (the capstone), `loss` (the lid or hard stop), `abandoned`. Builds before #3699 sent `completed` for both end states, which stays a finish with no winner.
- **Result block** (`cascadeResultBlock`): `merge_score` and `max_tier` (app), `won`, `outcome`, `time_bonus`, `bonus_rule` and `final_score` (server, recomputed), plus `duration_ms`, `theme`, `total_drops`, `total_merges`. Table and rules: [The result block](cascade-decisions.md#the-result-block-3700). About 100 bytes more per game, on the existing row, uploaded once at game end.
- **Daily Challenge.** The result block carries what Cascade goals will read: `won`, `max_tier` and the `duration_ms` column (win-within-time goals get a 20 s floor, `_WON_WITHIN_FLOORS`). Cascade has no goals in any pool yet; they join with the other premium games' goals (#2458, [DAILY-CHALLENGE.md](../DAILY-CHALLENGE.md) §2).
- **Time bonus source of truth:** `backend/cascade/time_bonus.py`, mirrored in `frontend/src/game/cascade/timeBonus.ts`, both checked against `backend/tests/fixtures/cascade_time_bonus.json`.

### 11. Stats and leaderboard

- **Board.** One board, `final_score` descending, no partitions, no declared maximum, no tie-break (equal scores go to the entry the server received first). Only finished, non-abandoned games rank. A player with a display name ranks with no further step; the board shows each named player's best game once. See [LEADERBOARDS.md](../LEADERBOARDS.md).
- **Result card.** Shows the rank (`lookupGameRank`) or asks once for a display name; "View leaderboard" opens the shared Leaderboard screen.
- **Stats** (the ⋯ menu, shared Stats screen): wins, losses, win rate, win streaks (from `has_winner`), Best (highest score, bonus included) and a **Fastest Win** tile (m:ss) from `best_win_ms`: the minimum `duration_ms` over `win` rows, ignoring wins under 20 s; hidden when null. `best_win_ms` is client-reported and private to `/stats/me`; it needs a server-side bound before it is shown to other players or used on a board (#3927).
- **Store builds** hide Cascade, so there it has neither entry point.

### 12. Audio and accessibility

**Audio** (owner picks, #3702). Fruits plays "Juicy pops", Cosmos plays "Starlight glass"; each set has 21 original, in-house synthesized sounds (42 files, about 345 KB; `tools/assets/synth_cascade_sfx.py`, credits in `SOUND_CREDITS.md`, reasoning in the [sound design log](cascade-sound-design.md)).

- Events: drop, land (light or heavy by tier, volume rising with tier), merge (one pre-pitched file per tier, C-major pentatonic, louder up the ladder), chain (steps 1-4 with the link's merge sound, paced like the chain counter), danger (a tick on each on-beat of the blink), win (a run, a fizz and a chord timed to the card), game over (a falling line and a chord timed to the card). Table: [Sound](cascade-decisions.md#sound-3702).
- Mute is the app-wide sound setting; there is no Cascade-only setting. Reduce Motion keeps every sound (the danger tick keeps its own timer). Nothing plays while a restored game settles or for a test fast-forward, except the win and game-over sounds. A covered board or a backgrounded app is silent.

**Accessibility.** Cascade's board is a Skia canvas, outside the native accessibility tree, so the game states are carried by native elements beside it.

- **Score:** `ScoreDisplay` is a native `Text` with a polite live region and the label "Score: N", outside the canvas.
- **Board:** a wrapping `View` with role `image`, the label `a11y.board`, a hint and an "activate" action that drops in the middle (a double-tap). The pieces are not individually exposed.
- **Announcements:** each merge is announced with the new piece's name (`cascade:event.merged`); the result card announces a win or a game over (it is the shared accessible modal).
- **Preview chips and the piece-set toggle** are labelled accessible elements.
- **Reduce Motion** (the shared `useReduceMotion`) selects the calm path listed in section 8; the physics itself still runs (see [section 14](#14-deviations-from-shared-standards)).
- **Flashing:** at most 3 flashes a second.
- **Colour:** all colours are theme tokens (`CASCADE_ART`, `CASCADE_LID_PALETTE`, `CASCADE_BIN_PALETTE`, `CASCADE_CELEBRATION` in `theme/theme.cascade.ts`); pieces that share a hue also differ by marks (open or closed eyes, blush, stripes).
- **Text:** every user-facing string, including labels and announcements, goes through i18next (`cascade` namespace, `a11y.*` keys). The English copies in other locales are still to be translated (`frontend/scripts/i18n-english-copies.json`).
- Shared contract: [ACCESSIBILITY.md](../ACCESSIBILITY.md#4-screen-readers).

### 13. Tests and sim references

| Concern                                | Where                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tier table is the only one             | `frontend/src/game/cascade/__tests__/tiers.test.ts`                                                                                                                                                                                                                                        |
| Engine rules, merges, chains, win      | `engine.test.ts`, `engine.physics.test.ts`, `engine.land.test.ts`, `engine.frame.test.ts`                                                                                                                                                                                                  |
| Lid and danger                         | `engine.lid.test.ts`, `lidVisuals.test.ts`, `engine.sim.test.ts` (spam bot loses within 120 s at 60 and 120 Hz)                                                                                                                                                                            |
| Spawn and queue                        | `spawnSelector.test.ts`, `pieceQueue.test.ts`                                                                                                                                                                                                                                              |
| Aiming                                 | `aim.test.ts`, `components/cascade/__tests__/CascadeAimArea.test.tsx`, `render/__tests__/drawMotion.test.ts`, `components/cascade/__tests__/useAimKeyboard.test.tsx` (web keyboard)                                                                                                        |
| Recording and replay                   | `replay*.test.ts`, `__tests__/replay.fixture.test.ts` (golden game, `backend/tests/fixtures/cascade_replay_v1.json`), `__tests__/recording.failsafes.test.ts`, `__tests__/useCascadeSession.recording.test.tsx`; backend `test_cascade_replay_events.py`, `test_replay_failsafes.py`       |
| Motion, haptics, celebration, win tail | `motion.test.ts`, `motionLog.test.ts`, `haptics.test.ts`, `celebration.test.ts`, `winTail.test.ts`, `render/__tests__/drawCelebration.test.ts`, `components/cascade/__tests__/`                                                                                                            |
| Sound                                  | `sounds.test.ts` (size budget), `soundPacer.test.ts`, `useCascadeSounds*.test.tsx`, `tools/assets/tests/synth_cascade_sfx_test.py`                                                                                                                                                         |
| Renderer                               | `render/__tests__/` (`frame`, `drawFrame`, `worklets`, `canvasKitWeb`, `loadCanvasKit`, `skiaWebImportGraph`), `art/__tests__/art.test.ts`                                                                                                                                                 |
| Save and restore                       | `storage.test.ts`, `screens/__tests__/CascadeScreen*.test.tsx`                                                                                                                                                                                                                             |
| Score, time bonus, result block, clock | `timeBonus.test.ts`, `resultBlock.test.ts`, `useCascadeClock.test.ts`, `scoreStore.test.ts`; backend `backend/tests/test_cascade_result.py` and `backend/tests/fixtures/cascade_time_bonus.json`; stats `backend/tests/test_stats_counts.py`, `screens/__tests__/GameStatsScreen.test.tsx` |
| Sim harness and baseline               | `frontend/src/game/cascade/sim/` (`baseline.json`, `sim/__tests__/sim.test.ts`), `npm run sim:cascade`, `.github/workflows/cascade-sim-gate.yml`; see [Sim harness](cascade-decisions.md#sim-harness-sim-2893) and [TESTING.md](../TESTING.md)                                             |
| End to end                             | Playwright `e2e/tests/cascade-smoke.spec.ts` (project `cascade`); Maestro `e2e/maestro/flows/cascade/` (`smoke`, `demo-open`, `demo-aim`, `demo-drop`, `demo-merge`, `demo-chain`, `demo-danger`, `demo-loss`, `demo-win`); test hooks `__cascade_*` (`testHooks.ts`, test builds only)    |

The sim's headline numbers on `dev` (`sim/baseline.json`, 100 seeds): the skilled bot wins 66 % of games, in a median 215 s; the spam bot loses at the lid in under 120 s (longest 84.9 s) and never wins; no guard rail fires.

### 14. Deviations from shared standards

Cascade departs from the shared gameplay standards in these places. Each is intentional unless marked a known gap.

| Standard                                                                                            | Cascade                                                                                                 | Why                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [GAMEPLAY_STANDARDS.md](../GAMEPLAY_STANDARDS.md) board games are tap-only, prefer a native control | Press, drag and release on an RNGH `Pan` with manual activation, plus a screen-reader "activate" action | The aim is a continuous position (#3928); a tap still drops at once                                             |
| Restore and completion go through `usePersistedGameState` and `useCompletionTransition`             | Own hooks: `useCascadeSave` (throttled saves), the screen's end-of-game path (`useCascadeSession`)      | The board is a physics world saved by position, not a state object; the win delays the card for the celebration |
| [ACCESSIBILITY.md](../ACCESSIBILITY.md): canvas marked `accessible={false}`                         | A wrapping `View` with role `image`, label, hint and action around the canvas                           | Skia's web `Canvas` drops accessibility props, and the board needs an activate action                           |
| ACCESSIBILITY.md: physics under Reduce Motion "must resolve immediately to final state"             | Physics still runs; only decoration (squash, bursts, chain pops, rise, blink) takes the calm path       | The pile is the game: dropping, rolling and merging are its rules, not decoration. Open question to the owner   |
| One result envelope, no per-game board code                                                         | Server-computed score (`derive_final_score`), a result block merged into `games.metadata`               | The time bonus must be a rule, not a client claim                                                               |
| Web uses Canvas 2D for canvas games (Mahjong, Star Swarm)                                           | Skia through CanvasKit (WebAssembly) on web                                                             | One drawing path on every platform (owner, #2960)                                                               |

### Known limitations

- **Device checks pending (owner's Manual QA).** Frame time with a full bin, the step bench (`Step bench` in the dev panel), bitmap build time on open, tablet sharpness, the Picture recorded on the UI thread against the headless comparison, and the celebration's frame readout (#2960, #3924).
- **Replays across engines.** Bit-exact replay holds on one JS engine only (see [Physics](cascade-decisions.md#physics)).
- **`best_win_ms`** is client-reported and private to `/stats/me` until it has a server-side bound (#3927).
- **Translations.** The English copies in other locales await translation (`frontend/scripts/i18n-english-copies.json`).
- **Reduce Motion physics** is a deliberate deviation, in [section 14](#14-deviations-from-shared-standards).
- **App version in recordings.** `game_started` records no app version yet; #3942 adds one for every game.
- **No Daily Challenge goals yet.** See section 10; they arrive with the premium goal pool (#2458).

### Recording and replay (#3858)

Every game is recorded on the shared `GameRecorder` (epic #3273) so it can be read back from a Sentry issue (`game.id`) and tuned from real games. Nothing is recorded per frame and no board is snapshotted. Format, numbers and measurements: [Replay recording](cascade-decisions.md#replay-recording-3858).

- **What is recorded.** `game_started`: the piece set, the queue seed and the engine seed (live play is seeded per game; the draws are uniform, so play is unchanged), the physics tuning id and `engine_version` (1). Then one **unit per 20 drops** (fewer at the end or when the app goes to the background): a `drop` event with each drop as `[step, x in tenths of a world px, tier]` and the danger moments `[start, peak]` (lid episodes of 10 steps or more, at most 32 a game), and a `merge` event with each merge as `[step, tierFrom, chain]`. `game_ended` adds `end_step`, `capstone_step` (a win), `lid_step` and the cap flags to the result block. `step` is the engine's fixed 60 Hz step, never wall time; the screen drops at the recorded tenth-of-a-pixel x.
- **When it is written.** A unit is handed to the recorder on its 20th drop and saved at the next idle moment in one write; going to the background saves at once. Every end (win, loss, New Game, leaving the screen) flushes the running danger moment and the last unit before `game_ended`. Gameplay rows are held on the device during play and uploaded when the session ends, the app goes to the background, or at most every 5 minutes (#3275).
- **Caps.** 1 KB per `drop` event (never split) and per `merge` part (a bigger `merge` is split on `m`), 32 KB a recorder session, 48 units a game (kept in the save, so a relaunch does not reset it), 32 danger moments; past a cap the game records a clean prefix and says so (`rec_cut`, `z_cut`, `x` in the replay summary, one throttled Sentry report). The server caps a game at 128 events and 80 KB and drops a bad event without a 400.
- **Volume and dials.** A typical game stores about 9.5 KB (18 rows), a 10-minute game about 14 KB, the worst case about 67 KB. At sample rate `r` (10 % with no dial), 1,000 games a day store about 285 MB × r at the 30-day retention steady state. The kill switch, the sample rate, the upgrade on error and the 90 % storage trip turn it down without a release. Cascade is premium-only, so the volume tracks paying players.
- **Replays.** The recorded merges and outcome tell the game's story on their own (`backend/scripts/replay_game.py`, `backend/cascade/replay.py`, which checks the merges add up to the merge score). Re-simulating from the seeds and drops (`rebuild.ts`) is best effort on one JS engine and never verifies a score. A change that moves the golden game bumps `ENGINE_VERSION` and keeps the old fixture.

---
