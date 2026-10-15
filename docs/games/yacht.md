# Yacht

**Category:** Dice  
**Tier:** Free in the v1.0 store build  
**Status:** In development

BC Arcade Yacht is a 13-round dice-scoring game with solo play and a vs-computer mode. The computer difficulties now share one oracle-backed decision engine and are weakened through bounded foresight/noise rather than separate hand-authored “brains.”

Shared session, offline, result-card, leaderboard and Stats behavior lives in [GAME-CONTRACT.md](../GAME-CONTRACT.md) and [LEADERBOARDS.md](../LEADERBOARDS.md). This file owns Yacht-specific rules, scoring and AI behavior.

## Core play

Each turn:

1. Roll five dice.
2. Hold any subset.
3. Re-roll the unheld dice up to two more times.
4. Score exactly one unused category.

A player may stop rolling and score after the first or second roll. Once a category is filled, it cannot be used again that game.

A game ends when all 13 categories are filled.

## Scoring categories

| Category | Rule | Score |
| --- | --- | ---: |
| Ones–Sixes | Sum dice showing that face | Variable |
| Three of a Kind | At least 3 matching dice | Sum of all dice |
| Four of a Kind | At least 4 matching dice | Sum of all dice |
| Full House | 3 of one face + 2 of another | 25 |
| Small Straight | At least 4 sequential faces | 30 |
| Large Straight | 5 sequential faces | 40 |
| Yacht | All 5 dice match | 50 |
| Chance | Any dice | Sum of all dice |

### Upper bonus

If the completed Ones–Sixes subtotal is at least **63**, add **35 points**.

### Extra Yacht / Joker rules

After the Yacht category has already been filled with 50, a later five-of-a-kind can earn a **100-point Yacht bonus**.

The engine also applies its Joker-category rules to an eligible extra Yacht:

- the matching upper category has priority when it is still open;
- otherwise lower categories use their Joker scores (for example Full House 25, Small Straight 30, Large Straight 40);
- Three/Four of a Kind and Chance use the dice sum.

The current theoretical maximum is **1575**, including the upper bonus and all possible extra-Yacht bonuses.

## Modes

### Solo
One player completes the 13-category scorecard.

### Vs computer
The human and one computer player alternate turns under the same scoring rules. The selected computer difficulty is recorded when the game starts.

The public Yacht leaderboard ranks **the human player's final score only**. Solo and vs games share one board; AI difficulty does not partition it.

## Computer opponent

### One engine, three handicaps

Since #2246, Easy, Medium and Hard all evaluate decisions from the same optimal-play oracle.

For a candidate move, a tier values:

`points banked now + λ × optimal expected points still to come`

The tiers then choose among sufficiently near-best options using a bounded softmax. This gives three controls:

- **Foresight λ:** how much future optimal value the tier understands.
- **Temperature T:** how readily it makes a plausible near-best mistake.
- **Maximum loss Δ:** how far below that tier's best option a mistake may fall.

Current parameters:

| Difficulty | Foresight λ | Temperature T | Max loss Δ | Character |
| --- | ---: | ---: | ---: | --- |
| Easy | 0.0 | 3 | 10 | Greedy/short-sighted; does not plan for future scorecard value |
| Medium | 0.4 | 1 | 5 | Partial future planning with smaller slips |
| Hard | 1.0 | 0.5 | 3 | Near-optimal oracle valuation with very small bounded variation |

This is a **structural** difficulty ladder: even if random variation is removed, the tiers still value future scorecard state differently.

### Hold decisions

After roll 1 or 2, the AI scores every distinct hold using the oracle-derived turn layers.

A hold that cannot beat simply banking the current roll is excluded as dominated. This prevents the “obviously broken bot” class of mistakes such as rerolling a made Yacht or large straight that can already be scored.

Keeping all five dice means “stop rolling and score,” not “hold them and spend another roll.”

### Category decisions

At scoring time, the AI evaluates every legal category, including Joker rules, as:

- immediate score delta;
- plus the tier's foresight-weighted optimal continuation value.

It then applies the same bounded near-best selection model.

### Measured strength

The current calibration gate has measured approximate mean scores in these ranges:

- Easy: **161.6–163.9**
- Medium: **211.8–215.6**
- Hard: **245.2–251.6**
- Pure optimal reference: about **254.5**

The simulation system uses paired/mirrored dice and order-swap controls, and the nightly gate checks both score calibration and per-decision regret against the oracle.

The old documentation describing fixed 25%/10% random-error rates or three independently tuned brains is obsolete.

## Game/session lifecycle

A new session opens on the player's first roll.

### Finished solo game
Records `completed`.

### Finished vs game
Once both players have completed their scorecards:
- human higher score → `win`;
- equal score → `push`;
- human lower score → `loss`.

### Leaving early / New Game
Once play has started, an unfinished game records `abandoned`.

A special edge exists when the human has finished but the computer's final turn is still pending: until the computer finishes, there is no final vs result. Leaving/resetting in that gap can record a completed player score without opponent result rather than fabricating a win/loss.

## Persistence and timing

The local save contains the game state and, for vs mode, AI state/difficulty so an unfinished match can resume.

Yacht does not maintain a separate engine play clock. `useGameSync` supplies active-play duration from foreground time on the game screen; long idle gaps are bounded by the shared play-window rules.

## Leaderboard and reporting

Backend module: `backend/yacht/module.py`.

Public board:
- metric: `final_score`;
- higher is better;
- max value: 1575;
- no partitions;
- no Yacht-specific tie-break.

Equal scores use the shared final tie-break: the entry the server received first (`received_at`) ranks first.

### Saved final scorecard (#2839)

The completion `result` (`endedPayload` → `buildEndedPayload` in `frontend/src/game/yacht/resultPayload.ts`, validated by `YachtResult` in `backend/yacht/models.py`, merged into `games.metadata`) carries the card that explains `final_score`. The owner reads it back from `GET /games/{id}` under `metadata` and sees it on Game Details (Profile → Recent Games → a game; `frontend/src/components/gameDetail/`, #2840): unfilled categories show a dash, and each card is checked on the device against its own score (`final_score` / `opponent_score`) and the bonus rules, with a note under only the card that does not add up; `scorecard_reconciled` is used only when there is no score to check against. Ranking is unchanged: it still uses the player's `final_score` only.

- `scorecard`: the player's `{ categories, upper_bonus, yacht_bonus_count, yacht_bonus_total }`. `categories` maps the 13 keys to scores and omits any category not filled. Every abandon (New Game, and the hook's unmount/navigation abandon through Yacht's progress snapshot) carries the partial card. An abandoned row never ranks and is excluded from progression and the daily challenge, and the snapshot sends no row score.
- `opponent_scorecard`: the computer's card, in the same shape, only when the computer finished a vs game (with `opponent_score` and `vs_result`). A vs game completed while the computer is still playing (backgrounded or unmounted) has neither `opponent_scorecard` nor `opponent_score`. The two cards are never mixed: `scorecard` is always the player's.
- Top-level `final_score`, `upper_bonus` and `yacht_bonus_total` keep their meaning, so builds before #2839 stay valid.

Bonus accounting: `total = sum(filled categories) + upper_bonus + yacht_bonus_total`. An extra Yacht (Joker) writes its Joker-priced points (upper face sum, Full House 25, Small Straight 30, Large Straight 40, dice sum for the sum categories) into an ordinary category, so those points are in the category sum. The extra Yacht's **100** is only in `yacht_bonus_total` (`100 × yacht_bonus_count`, at most 12, and only once Yacht holds 50). `upper_bonus` (35) needs all six upper categories filled with a subtotal of 63 or more, and is never inside `categories`.

Server rules: **the result is never rejected for its card** (a 400 on `/complete` is dead-lettered by the app, losing the score). A card is valid when its category keys are the 13 above, each a strict non-negative integer within its category maximum (Joker scores included), `upper_bonus` 0 to 35 and `yacht_bonus_count` 0 to 12; unknown keys beside `categories` are ignored. An invalid card is **dropped** (not stored), the game completes, `scorecard_reconciled` is `false`, and the drop is logged and sent to Sentry. A valid card that does not add up, or breaks the bonus rules, is stored with `scorecard_reconciled: false`. The flag is server-written (a client's value is discarded); `true` means every card present is valid and reconciles. The top-level fields (`final_score`, `outcome`, ...) are stored exactly as sent, as before. Old results without a card are unchanged. Only the shared 8 KiB result cap can still 400.

Creation metadata:
- `mode`: `solo` or `vs`;
- `difficulty`: Easy/Medium/Hard for vs mode only.

Finished result data can include:
- final score;
- upper bonus;
- Yacht bonus total;
- outcome;
- opponent score and vs result for completed vs matches.

The computer's score is recorded for the match result but never creates its own public leaderboard entry.

## Replay recording

Part of epic #3273 (#3282). Every turn of both players, the computer's included, is recorded so a finished game, solo or vs the computer, can be retraced and the computer's play analysed per difficulty. The recorder, its caps and the kill switch are the shared ones ([GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay)); this section is what Yacht sends.

### Events

| Event            | When                                 | Notes                                                                                           |
| ---------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `game_started`   | the session opens                    | lifecycle. `{ v: 1, mode: "solo" }` or `{ v: 1, mode: "vs", cpu_type: "oracle", difficulty }`  |
| `turn_completed` | a turn is scored, either player      | replay tier; one per player per round (13 solo, 26 vs); the data below                          |
| `game_ended`     | the session completes or is abandoned | lifecycle                                                                                       |
| `roll`, `score`  | **retired** (builds before #3282)    | the human's per-roll / per-score events. Still seeded and stored as sent; the app no longer sends them |

`cpu_type` names the opponent's engine (`oracle`: `ai.ts`); a new computer type adds a value, not a field.

**A `turn_completed` event** is the recorder's envelope (`v` 1, `unit`, `t_ms`, and in a vs game `actor` = `{ seat, kind }`: seat 0 / `human`, seat 1 / `cpu`; a solo turn has no actor) plus the turn, with compact keys and booleans left out when false:

| Key     | Meaning                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `r`     | the round, 1 to 13                                                                                                                   |
| `rolls` | 1 to 3 rolls, each `[dice]` or `[dice, mask]`: the five dice the roll produced, and the hold mask going **into** it (bit i = die i kept; left out when 0, which the first roll always is) |
| `h`     | the human's hold taps between rolls, `[after_roll, die, held 1\|0]`, at most 16 per turn; left out when none. The computer sets its holds directly and has none: its masks are in `rolls` |
| `ro`    | rolls of this turn lost because the app was killed mid-turn (a resumed turn); left out when 0                                      |
| `s`     | the scored choice, `[category, value]`; `category` is the index in `CATEGORIES` (`engine.ts`: ones … sixes, three_of_a_kind, four_of_a_kind, full_house, small_straight, large_straight, yacht, chance) |
| `alt`   | the **other** legal categories, flat `[category, value, ...]` in category order (Joker rules applied); left out when there are none |
| `jk`    | 1 when the Joker rule applied (an extra Yacht with the Yacht box at 50)                                                              |
| `yb`    | 1 when the score earned a Yacht bonus (100)                                                                                          |
| `ub`    | 1 when the score earned the upper bonus (35)                                                                                         |
| `yc`    | the Yacht bonus count after the turn; left out when 0                                                                                |
| `us`    | the upper subtotal after the turn                                                                                                    |
| `tot`   | the total score after the turn                                                                                                       |
| `ev`    | the computer only: `[EV of its choice, EV of the best legal category]` to one decimal                                                |

`jk` and `yb` are separate facts (the old `is_joker` mixed the bonus with the rule). In this engine they coincide, because the Joker rule applies exactly when an extra Yacht earns the bonus, but they are recorded separately so a rule change does not change the data.

**Why this shape.** The scorecard starts empty and every roll is random, so the dice of each roll plus the chosen category are all a replay needs; the engine's own `score` rebuilds everything else (values, Joker forcing, bonuses). The flags, `us`, `tot` and `alt` repeat what a replay computes: they let a reader check a stretch of play and spot a hole in one (a turn lost to an app kill shows as a wrong round, `ro`, or a total that does not follow), and they make analysis a query rather than a re-simulation. The hold mask is on the roll it applies to; the taps (`h`) show hesitation without being needed to rebuild.

**`ev`** is the oracle's expected total still to come, this score included, under optimal play (λ = 1) whatever the computer's tier: `ai.ts` `scoreEvs`, the same `scoreCategories` lookup the decision already makes (at most 13 table reads, no new DP), called once per computer turn. `ev[1] - ev[0]` is what the choice cost against perfect play; at λ < 1 a tier sometimes chooses below the best on purpose.

### How a turn is recorded

- The turn is built in memory while it is played (`createTurnLog`, `replay.ts`): a roll pushes five dice and a mask, a hold tap pushes three numbers. Nothing reaches the recorder, the queue or storage during the dice animation.
- When the turn is scored, `emitTurn` calls `beginUnit(n)`, `record("turn_completed", …)`, `closeUnit()`: one unit, one event, **one storage write**, saved by the recorder at an idle moment, never in the score handler. The computer's turn (`useYachtCpuOpponent`, `onTurn`) records the same way, at the end of its loop.
- **Unit numbers** follow the round and are derived from it, never counted: solo `unit = round`; vs the human's turn is `2r - 1` and the computer's `2r`. A game resumed after a kill therefore continues the numbering with no counter to restore (GAME-CONTRACT §2.10: `beginUnit(n)`).
- **Backgrounding.** When the app leaves the foreground (`background` or `inactive`) the screen calls the recorder's `flush()`, which saves what is waiting **synchronously** instead of leaving it to an idle task that a kill could pre-empt.
- A turn in progress when the process dies is lost. A resumed turn is recorded with the rolls it has seen and `ro` set (its restored dice stand in as the roll if it is scored without another).
- A computer turn that throws is finished by `finishTurnFallback` and **is recorded too**, without `ev` (the oracle did not choose it; the fallback's own roll, if it made one, is in `rolls`), so the computer's card has no hole. The error is already reported.
- Recording never stops play: the player's turn is recorded in its own `try` (a failure there is reported and the CPU's turn and the completion go on), as is the computer's. Failures are reported to Sentry at most once per kind per `sentryThrottle` window, not once per turn.
- **Known gap: the computer's last turn.** If the computer is still on its round-13 turn when the app goes `inactive` or `background`, the player's finished game is completed at once (#2505: a kill from the app switcher runs no cleanup), which ends the recorder's session; the computer's last `turn_completed` (unit 26) is then refused and the game has no opponent result either. `inactive` is kept on purpose: on iOS a swipe-away from the app switcher is only ever `inactive`, and `GameScreen.result.test.tsx` pins that behaviour. The replay script reports the hole as `seat 1: card unfinished (12 of 13 turns)`.
- **Possible duplicate turn.** A crash between a turn's save and the game state's save resumes the game at the old state, and the player or computer plays that round again: the replay then has two turns for one round, and the second is reported as `<category> is already filled` (or a round mismatch). It is a flag, not data loss.
- **Kill switch.** With recording off for Yacht (`isRecordingEnabled("yacht")`, #3279) nothing is built for the replay: the screen collects no rolls or taps, the computer hook gets no listener and the oracle is not asked for EVs; the recorder itself does no work.

### Validation and caps

`backend/yacht/turn_event.py` (`validate_turn`, called by `YachtModule.validate_event`): a versioned pydantic model, `extra="forbid"`, `v == 1`, strict ints in range (dice 1 to 6, hold mask 1 to 31, category 0 to 12, values 0 to 50, round 1 to 13, upper subtotal 0 to 105, total 0 to 1,575, at most 16 taps and 12 alternatives, flags exactly 1), and **640 B** of compact JSON per event (`MAX_TURN_BYTES`, the app's `YACHT_TURN_MAX_BYTES`; a test holds the two equal). A bad event is dropped, not the batch, with a Sentry report by reason and error types, never values, throttled to one per reason per 5 minutes (`observability.report.Throttle`, #3293; every drop is still logged). `roll`, `score` and the lifecycle events are stored as sent.

**Byte arithmetic** (the server stores `jsonb::text`, with a space after `,` and `:`, plus `ROW_OVERHEAD_BYTES` = 200 per row):

- A typical turn is about 215 B as `jsonb` (211 B for the human and 221 B for the computer on average in the fixture game, 307 B at most); the largest the app can build (three rolls, 16 taps, 12 alternatives, a Yacht bonus, `ro`, EVs, the envelope) is **432 B compact, 556 B as `jsonb`**, under the 640 B cap.
- A 13-round vs game is 26 rows: the fixture game is 5,611 B as `jsonb` + 26 × 200 B = **10,811 B**; the worst case is 26 × (556 + 200) = **19,656 B**. Yacht keeps `DEFAULT_CAP` (500 events or 160 KB per game): the worst case is 12% of its bytes and 26 of its 500 events (`backend/tests/test_yacht_turn_event.py`).
- On the device the whole game is about 4.8 KB of recorded JSON against the 64 KB session cap.
- Per day: a player who finishes 20 vs games stores about 216 KB (typical) to 393 KB (worst case); 100 games a day would be about 1.1 MB, of the 250 MB replay budget ([DATA-INVENTORY §2a](../DATA-INVENTORY.md)). The 30-day retention and the storage budget alerts apply as for every game; the server dial (sample rate, kill switch; #3279) turns it down without an app release.

### Measured (`frontend/src/game/yacht/__tests__/replay.bench.test.ts`)

The scripted 13-round game over the real `GameEventClient` → `EventStore` → AsyncStorage mock, with an idle moment between saves (the worst case for the old path: nothing coalesces). "Before" is the human's `roll` per roll and `score` per score, one save each, the computer not recorded; the script rolls 16 times, where a player who always rolls three times would send 39 + 13 = 52 events. "After" is the 26 `turn_completed` events of both players.

|                                                               | Before (human only, `roll` / `score`) | After (both players, `turn_completed`) |
| ------------------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| Queue saves (`EventStore.enqueueEvent` / `enqueueMany` calls) | 29                                    | **26**                                 |
| AsyncStorage writes                                           | 58                                    | **52**                                 |
| Bytes written to storage                                      | 167,912                               | **163,335**                            |
| Events                                                        | 29                                    | 26                                     |
| Recorded JSON (sum of `data`)                                 | 3,513 B                               | **4,761 B** (the computer's 13 turns included) |

Both players cost fewer saves than the human alone did. Zero uploads happen while the game is open: the gameplay events wait for the session's end, the background or `GAMEPLAY_HOLD_MAX_MS` (GAME-CONTRACT §2.10). The shared heavy-day budget test (#3294) is not written yet; its Yacht figures are these.

### Reading a recorded game

`cd backend && python scripts/replay_game.py <game_id>` prints the game's events in order and then **both scorecards rebuilt from the `turn_completed` events alone** (`backend/yacht/replay.py`, a port of the engine's scoring rules), with the player's total checked against `games.final_score` and every place a recorded turn disagrees with the replay (value, flags, subtotal, total, alternatives, a missing round, `ro`). A card that is not finished (an abandoned game, or turns lost as above) is reported as `seat N: card unfinished (k of 13 turns)`. A game from before #3282 prints "no turn_completed events". `backend/tests/fixtures/yacht_turn_events_v1.json` is the scripted vs game as the app records it: the frontend test checks it byte for byte (`UPDATE_GOLDEN=1 npx jest src/game/yacht/__tests__/replay.test.ts` re-records) and the backend validates and rebuilds it. `yacht_turn_events_diff_v1.json` is a seeded differential: 40 random games (half vs) from the app's engine, covering Jokers of all three priorities (matching upper box, open lower, open upper), several Yacht bonuses and a scratched Yacht followed by a Yacht roll; the backend must validate every event and rebuild each game to the engine's totals.

### Deploy order

The seed migration `0038_yacht_turn_events` (the `turn_completed` event type; no schema change) must be deployed **before** the app that sends it, or the server answers `400 unknown_event_type`. Its downgrade deletes the type's stored rows.

## Engine, AI, and validation

- Rules engine: `frontend/src/game/yacht/engine.ts`
- Replay recording: `frontend/src/game/yacht/replay.ts` (the turn log and unit numbering), `backend/yacht/turn_event.py` (validation), `backend/yacht/replay.py` (rebuild)
- Screen: [`frontend/src/screens/GameScreen.tsx`](../../frontend/src/screens/GameScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- AI: `frontend/src/game/yacht/ai.ts`
- Oracle runtime/table: `frontend/src/game/yacht/oracle/`
- Oracle design reference: [YACHT_ORACLE.md](../research/YACHT_ORACLE.md)
- AI simulation/calibration: `frontend/tooling/yacht/` (see docs/TESTING.md → Simulators)
- Shared testing guidance: [TESTING.md](../TESTING.md)

## Documentation status

The Yacht portion of the unified-AI work is now implemented (#2245/#2246 and #2241 are closed). This specification therefore describes the current AI contract rather than a provisional future design.

The broader #2283 epic remains open because Hearts still has pending strong-engine work; that does not make Yacht's shipped architecture provisional.
