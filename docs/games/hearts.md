# Hearts

**Category:** Card  
**Tier:** Premium / hidden in the v1.0 store build  
**Status:** In development

BC Arcade Hearts is a four-player Hearts game: one human at seat 0 and three computer opponents.

Shared session, offline, result-card, leaderboard and Stats behavior lives in [GAME-CONTRACT.md](../GAME-CONTRACT.md) and [LEADERBOARDS.md](../LEADERBOARDS.md). This file owns Hearts-specific rules, scoring and the current computer-player architecture.

> **AI status:** the current utility-AI system described below is shipped behavior. It is still **provisional architecture** because #2587 / #2283 plan to replace the play engine with a PIMC/lookahead-based strong engine and derive easier opponents from it. Update this section when that implementation lands.

## Objective

Hearts is a penalty-point trick-taking game. The goal is to finish the game with the **lowest cumulative score**.

Per hand:
- each heart taken is 1 point;
- Queen of Spades is 13 points;
- there are 26 penalty points available in an ordinary hand.

## Hand structure and passing

Each player receives 13 cards.

Before play, each player normally selects 3 cards to pass. Pass direction rotates by hand:

1. Left
2. Right
3. Across
4. Keep / no pass

Then the cycle repeats.

The engine records pass memory for each player:
- cards they passed away;
- who received them;
- cards they received;
- who sent them.

That information is available to the AI during play rather than being forgotten after the pass phase.

## Trick rules

The player holding **2♣** leads the first trick and must play it.

Players must follow the led suit when possible. If they cannot follow, they may discard another suit subject to first-trick restrictions.

### First trick restrictions

On the first trick:
- the leader must play 2♣;
- followers who hold clubs must follow clubs;
- a player void in clubs may not discard a heart or Q♠ unless their entire remaining hand consists only of hearts/Q♠.

### Hearts broken

After the first trick:
- hearts cannot be led until hearts have been broken;
- hearts become broken when a heart is played off-suit;
- if a player's hand contains only hearts, they may lead hearts even before the normal break condition.

### Queen of Spades

Q♠ is a 13-point penalty card.

It is **not globally forbidden as a lead** by BC Arcade's engine after the first trick. Normal follow-suit and hearts-leading rules still apply.

## Trick winner

Only cards in the led suit compete for the trick.

The highest rank in that suit wins; Ace is high.

The winner:
- takes all four cards and their penalty points;
- leads the next trick.

The engine also tracks when players demonstrate they are void in a suit by playing off-suit.

## Shooting the Moon

A player shoots the moon by taking:
- all 13 hearts; and
- Q♠

in the same hand.

BC Arcade applies:
- shooter: 0 points for the hand;
- every other player: 26 points.

The engine stores post-moon hand deltas in score history so resumed games and round views preserve the actual applied scoring.

## Game end

After each 13-trick hand, cumulative scores are updated.

The game ends once at least one player has reached **100 or more** cumulative points.

The player with the lowest cumulative score wins.

For the human player's server result:
- sole lowest score → `win`;
- tied for lowest → `push`;
- otherwise → `loss`.

## Current computer-player presets

Players see **one** computer opponent: **Conservative** (the default preset, `conservative`). Store builds show no opponent picker and every CPU seat plays Conservative.

The legacy personas (**Cautious**, **Schemer**, **Daring**) and the **Mixed** table stay in the code, unchanged, behind the `HEARTS_LEGACY_PERSONAS` flag (#3158, epic #3156) so comparison runs can still use them. The flag is `areLegacyHeartsPersonasEnabled()` in `frontend/src/game/_shared/envFlags.ts`: on only for dev bundles (`__DEV__`) and pre-launch builds (`isPreLaunchApiBuild()`). With it on, the picker shows Conservative first and the four legacy presets. A legacy preset saved by an earlier build loads as Conservative when the flag is off, and is kept when it is on. The sim tooling (`tools/sim/`, `frontend/tooling/hearts/`) always runs the legacy personas, whatever the flag.

Conservative is a principle-based CPU (#3159), not a set of utility weights: it plays plain, careful Hearts from the short list of principles in [hearts/CONSERVATIVE_AI.md](../hearts/CONSERVATIVE_AI.md) (code: `frontend/src/game/hearts/conservative/`). It never uses randomness, so the same position always gets the same card, and each decision carries the principle that chose it. `selectCardToPlay` / `selectCardsToPass` in `ai.ts` send the `conservative` persona there; the legacy personas use the utility AI below, unchanged.

For a non-Mixed preset, all three AI seats use that persona.

Mixed uses a fixed canonical assignment:

| Seat | Position | Persona |
| ---: | --- | --- |
| 1 | left AI | Cautious |
| 2 | top AI | Schemer |
| 3 | right AI | Daring |

The selected preset (`ai_difficulty`: `conservative` in store builds) is recorded in game metadata but does **not** partition the public leaderboard.

## Legacy persona AI architecture

The legacy personas (Cautious, Schemer, Daring; behind the flag) use a **utility-scoring engine**, not a search/lookahead engine. The Conservative CPU does not use any of this section; see [hearts/CONSERVATIVE_AI.md](../hearts/CONSERVATIVE_AI.md).

For each legal action, the AI scores considerations and chooses among them using persona-specific weights. Current play considerations include:

- minimizing immediate penalty-point risk;
- Q♠ risk;
- moon-threat defense;
- Daring moon-attempt progress;
- tactical play such as ducking with the highest safe card, winning high when a win is forced/useful, and spade flushing.

Pass selection uses:
- danger/passing quality;
- suit-voiding utility;
- Daring-specific moon-control logic when a hand qualifies.

### Information available to the current AI

The AI's read-only information set includes:

- its current hand;
- current trick and led suit;
- cards already seen;
- known suit voids from completed tricks;
- live void observations from the current trick;
- points taken by each player this hand;
- cumulative scores;
- tricks remaining;
- pass direction;
- hearts-broken state;
- first-trick state;
- cards this player passed away and the known recipient;
- cards this player received and the sender.

The AI does not inspect hidden opponents' exact hands.

## Persona behavior

### Cautious

Primary character:
- strongest emphasis on minimizing immediate points;
- strong Q♠ avoidance;
- relatively little pass-phase suit-voiding pressure;
- never initiates a moon attempt.

Current play weights:
- minimize points: 3.0
- Q♠ risk: 2.0
- moon threat: 1.0
- tactics: 1.0

Pass weighting:
- passing quality: 1.0
- suit voiding: 0.2

Current mistake/noise rate: **55%**.

Despite the high frequency, mistakes are no longer uniform-random cards; see Plausible mistakes below.

### Schemer

Primary character:
- more balanced self-protection and moon defense;
- stronger suit-void creation during passing than Cautious;
- does not intentionally shoot the moon.

Current play weights:
- minimize points: 2.0
- Q♠ risk: 1.5
- moon threat: 1.5
- tactics: 1.0

Pass weighting:
- passing quality: 1.0
- suit voiding: 0.8

Current mistake/noise rate: **19%**.

### Daring

Primary character:
- zero ordinary decision noise;
- strongest Q♠ manipulation;
- strongest suit-void pressure in passing;
- can deliberately attempt a moon when the hand is strong enough;
- has special endgame/adversarial weighting modes.

Standard play weights:
- minimize points: 1.5
- Q♠ risk: 3.0
- moon threat: 1.0
- tactics: 1.0

Pass weighting:
- passing quality: 1.0
- suit voiding: 2.5

Current mistake/noise rate: **0%**.

## Plausible mistakes

Cautious and Schemer are weakened through a noise gate, but a noise hit does **not** choose uniformly from every legal card.

Instead, alternatives are weighted toward near-best utility scores using `MISTAKE_SPREAD = 0.1`.

The goal is to create believable small misjudgments rather than obviously broken moves. Daring currently has no normal noise.

This replaced the older uniform-random-error model.

## Moon-attempt behavior

Moon viability is now based on hand quality rather than simply counting hearts.

The core assessment considers:

- at least **4 top hearts** (10/J/Q/K/A hearts, held or already captured);
- spade control through Q♠ or A♠+K♠;
- an Ace-led side suit of at least 3 cards;
- no more than 1 structurally weak side suit.

Daring is currently the only persona that acts on this moon assessment.

During the pass phase, a viable Daring hand tries to retain:
- hearts;
- Q♠ / relevant spade control;
- Aces;
- K♠ when paired with A♠;
- its strong side suit.

When passing directly to the human, Daring keeps Q♠ for a moon only when the hand meets the stronger pass threshold (at least 5 top hearts).

### Moon commitment

Once Daring has captured all penalty points taken so far and at least **13 points**, it can stay committed to the moon attempt even as the remaining hand shape changes.

There is no late-hand “too few cards left” cutoff.

### Moon-mode weighting

When Daring enters moon-attempt mode, `moonProgress` has weight **100.0** while normal tactical/self-protection weights are largely suppressed.

That is intentionally a dominant mode once the separate hand-quality gate has decided the attempt is viable; it should not be described as a balanced blend of ordinary considerations.

## Moon defense

Moon defense is no longer only a late reaction.

The current heuristic system includes proactive shooter-aware behavior and stopper/tactical logic from #2235/#2236, alongside the information-set knowledge above.

The exact strength of that defense remains part of the current utility model and is one reason the eventual PIMC engine is still being pursued.

## Endgame / adversarial modes

Daring has special non-moon modes for situations such as:
- late-game score pressure;
- opportunities to dump Q♠ or high hearts onto the human/score leader.

These are still utility-weight modes, not a full game-tree search.

## Current strength ladder

The current utility-AI ladder was retuned after #2555 found that the old persona strength ordering could invert.

The calibration target is expressed as the win rate of a competent reference player (Schemer stand-in) against each table:

- Cautious table: roughly **40%**
- Schemer table: roughly **25%**
- Daring table: roughly **16%**

These are calibration targets for the current heuristic system, not claims about human skill levels.

The simulation framework now includes paired-deal replay, stronger calibration metrics and per-decision regret analysis (#2238/#2239).

## Planned strong-engine replacement

The current AI remains intentionally provisional.

#2587 / #2283 plan a shared PIMC-style engine that:

- samples plausible hidden-card deals from the information set;
- looks ahead before selecting a card;
- uses that stronger engine at full strength for the hardest table;
- derives easier levels through plausible degradation rather than independent hand-tuned brains;
- preserves named persona flavor, including Daring's moon personality, on top of the shared decision foundation.

The research spike is complete and recommended proceeding, but the production PIMC implementation remains open.

Until #2587 lands, this document's **Current AI architecture** sections describe the shipped behavior. When it lands, those sections should be replaced rather than leaving both architectures as competing sources of truth.

## Persistence and timing

Hearts state persists locally, including:
- cumulative scores;
- hand/score history;
- pass direction/state;
- AI preset;
- known voids/pass memory;
- active game state.

Hearts uses its own active-play clock.

The clock pauses when:
- another screen covers Hearts;
- the app is backgrounded/inactive.

Saved elapsed play time survives a relaunch.

## Leaderboard and reporting

Backend module: `backend/hearts/module.py`.

Public board:
- `final_score = max(0, 100 - human penalty points)`;
- higher is better;
- max value 100;
- no partitions;
- no game-specific tie-break.

Equal values use the shared final tie-break: the entry the server received first (`received_at`) ranks first.

All completed `win`, `loss` and `push` results can rank. Abandoned games do not.

A started game abandoned through New Game, difficulty change or leaving records progress such as hands completed (`hands_played`) but no ranking score.

### Completed result: per-hand scores (#2838)

A finished game's `result` block carries, next to `final_score` and `vs_result`, the round-by-round path to it (`HeartsResult` in `backend/hearts/models.py`, merged into `games.metadata` and returned to the owner by `GET /games/{id}`):

- `hand_scores`: one row per resolved hand, four applied penalty deltas in seat order, from the engine's `scoreHistory`. They are post moon adjustment: a moon hand is `0` for the shooter and `26` for each opponent.
- `final_scores`: the four cumulative totals.
- `human_seat`: the human's index (always `0` today). Seats are positional, so no computer-player names or other personal data are stored.

The server keeps the breakdown only if it reconciles: 1-60 rows of four integers in 0-26, each row summing to 26 or being the moon pattern (`0, 26, 26, 26`, sum 78; the engine has no other scoring variants), four non-negative totals, each seat's deltas summing to its total, and, when the result block sends `final_score`, an integer equal to the request body's `final_score` (which becomes `games.final_score`) and to `max(0, 100 - final_scores[human_seat])` (a float, bool or string does not reconcile). Anything else drops the three keys and keeps the rest of the result, so a bad breakdown never returns a 400 that would dead-letter the game; the drop is logged and sent to Sentry as a warning with the failed check (no ids or scores). Builds without the fields, and abandons (`hands_played` only), validate as before; the leaderboard value stays `final_score`.

The owner sees it on Game Details (Profile → Recent Games → a game; `frontend/src/components/gameDetail/`, #2840) as a hands × seats table, the human first as "You" and the others as numbered opponents, with moon hands marked ★ and a totals row. A game without the breakdown (older builds, abandons, dropped) shows its total and a "no breakdown saved" note, never zeroed hands.

## Premium / visibility

Hearts is one of the games hidden from the v1.0 store build. It remains visible in development, internal/test and pre-launch-API builds under the shared visibility rules.

Premium entitlement behavior is a platform concern; see [ARCHITECTURE.md §10](../ARCHITECTURE.md#10-premium-entitlements).

## Debug panel: why the CPU played a card

In development and pre-launch (internal test) builds only — recording and display use the same condition as the panel, `__DEV__ || isPreLaunchApiBuild()`; store builds record and show nothing. This in-memory hand log (with each CPU play's position and one-sentence reason) is separate from the [replay events](#replay-recording), which every build records: those carry the cards, plays, winners, scores and each CPU decision's principle number, not the position or the reason. The Hearts debugger shows the principle behind each conservative-CPU decision (#3163):

- **CPU principles** in each logged hand, and in the hand in progress: the last trick's plays with each play's principle ID (`P2-FREE-TRICK`, ...; a forced CPU play shows `forced`, and the human play has no tag), and a scrollable log of every CPU play with its one-sentence reason. CPU pass cards show their principle in Pass Selections.
- **Copy** (web) exports each CPU play and pass as a `yaml` block in the [rulebook format](../hearts/CONSERVATIVE_AI.md#5-rulebook) (hand, trick, trick number, hearts broken, Q♠ played, points so far, expected card, principle, reason), the export includes the hand in progress under "Hand N — in progress". A game resumed mid-hand has no earlier tricks logged, so its plays keep the principle but say "position incomplete (resumed mid-hand)" instead of a yaml block. Each complete block can be pasted into an issue or the rulebook. Ids are `DBG-h<hand>-t<trick>-s<seat>`.
- Legacy personas have no principles; their plays show nothing extra. Logs are in memory only (not persisted), and older entries without the fields render as before.

Data: `frontend/src/game/hearts/debugLog.ts` (`DebugPlay`, `DebugPassCard`, `HandDebugLog.passDecisions`); dev / pre-launch only. The production form of the same facts is `frontend/src/game/hearts/replay.ts`. The screen gets decisions from `explainCardToPlay` / `explainCardsToPass` in `ai.ts`, which return the same card as `selectCardToPlay` / `selectCardsToPass` plus the principle and reason.

## Replay recording

_(#3283, epic #3273; the shared recorder is [GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay).)_

Every build records what decides a game's score, for all four seats, so a stored game can be retraced hand by hand and the computer players analysed. It is the production form of the dev-only hand log (`debugLog.ts`, [below](#debug-panel-why-the-cpu-played-a-card)), without `DebugPosition` (large, and rebuildable from the deal and the plays).

**`game_started`** (lifecycle, sent when the first card opens the session) carries `initial_score: 0` as before, and `preset` (`conservative`, or `mixed` and the legacy presets in dev / pre-launch builds), `target` (100) and `seats`: `["human", persona, persona, persona]`, the persona being each computer seat's (`conservative`, or `cautious` / `schemer` / `daring` on the mixed table).

**Two replay events a hand** (`gameEventRegistry.hearts`, replay tier; wire form and validation in `backend/hearts/events.py`), each with the recorder's envelope (`v` 1, `unit`, `t_ms`) and `h`, the hand number:

| Event         | Data                                                                                                                                                                                                                                                  | When                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `hand_opened` | `d` pass direction (0 left, 1 right, 2 across, 3 none; `(h - 1) % 4`), `c` the four starting hands, 13 cards each, in seat order; `p` the three cards each seat passed (not on a hold hand); `r` the CPU's principle digit per passed card, 3 a seat    | the pass is committed (the deal, on a hold hand)      |
| `hand_played` | `l` lead seat of the first trick, `c` the plays of the tricks in order, 8 characters a trick (all 13: 104); `n` the first trick of the row (left out for 1); `r` one principle digit per play (left out when all 0); on the row that ends the hand `s` the four applied deltas (after the moon), `t` the four totals, `m` the shooter on a moon hand | the hand ends, or the app is backgrounded (a part)    |

**Why two, not sixteen.** A first design recorded a deal, a pass, thirteen tricks and a score as separate events: 16 rows a hand, 174 rows and about 55 KB stored for an 11-hand game, most of it the 200 B each stored row costs on the server. A hand is now two rows: about 22 rows and 10 KB for the same game (below).

**Encoding.** A card is two ASCII characters, rank then suit (`2`-`9`, `T`, `J`, `Q`, `K`, `A`; `C`, `D`, `H`, `S`), and a card list is its codes joined with no separator: `"QSAH2C"`. The four hands of a deal are 112 characters. Only the lead of the first trick is recorded: the winner of a trick leads the next and the winner is the highest card of the led suit (ace high), so the seat of every play, each trick's winner and points, hearts broken and who took the queen all follow from the cards and are not recorded. A seat receives the cards the seat `d` away passed (left: from the seat before it). A principle is the number `n` of the CPU's `P<n>-...` principle ([CONSERVATIVE_AI.md §2.2](../hearts/CONSERVATIVE_AI.md)), 1-9, one digit; `0` is none (the human, a legacy persona, a forced play). The principles come from the decision the AI already returned (`explainCardToPlay`, `explainCardsToPass`): no AI work is added.

**Rebuilding a game** (`rebuildGame` in `game/hearts/__tests__/helpers/replayGame.ts` does exactly this): take the hands from `hand_opened` and apply its pass; walk each `hand_played` trick by trick from the lead `l`: each card is taken from the hand of its seat (a card the seat does not hold means a hole in the recording), the winner leads the next trick and takes the points; when a row carries `s` the hand is over: its deltas are the points by seat, or `[0, 26, 26, 26]` for the seat that took all 26 (the shooter `m`), the totals their running sum, and `s` and `t` are what to check them against. A hand in parts is the rows with the same `h` in `event_index` order, each `n` the trick after the last row's. The golden test plays seeded games through the real engine, AI and recorder and rebuilds all four seats' scores from the saved events alone, for a hand with the queen passed, a hand with a moon shot, and a hand in parts.

### Units, parts, and when they are saved

A hand is two recorder units. Unit numbers follow from the hand and trick, not from a counter: `hand_opened` is `15 (h - 1) + 1` and a `hand_played` row `15 (h - 1) + 2 + n`, `n` the first trick it holds (`openedUnit`, `playedUnit`), unique and increasing within a game, parts included. A game resumed after a kill carries on from its restored state (the screen passes every unit to `beginUnit(n)`, GAME-CONTRACT §2.10) and never repeats a number it saved before.

- Events are built in memory (`HeartsReplay`, `game/hearts/replay.ts`): a few string joins over 4-13 cards, nothing serialised or stored. The recorder measures and queues at an idle moment, never inside a tap or animation callback. The tricks of a hand stay in memory as they are played and become one `hand_played` when the hand ends, so nothing at all reaches the recorder mid-hand and no trick's animation is ever in the way.
- **"One storage write per trick" is a ceiling.** The epic's rule is one write per unit, a unit being a hand, a trick or a chunk (epic #3273, Performance rule 1). Hearts' unit is the hand: two writes a hand, 22 for an 11-hand game, against 174 for a write per trick.
- `hand_opened` is made when the pass is committed (at the deal, on a hold hand): the starting hands are still the player's hands then, so nothing is held between the deal and the pass.
- **Hand 1's opening waits for the game session**, which the first card opens. It is kept in AsyncStorage while it waits (`hearts.replay_pending_v1`, `pendingReplay.ts`; about 250 B). The write is put off to after the interactions (`InteractionManager.runAfterInteractions`), never inside the Confirm tap, and a flush does it at once; nothing is written when no unit waits (a flag), so New Game costs no storage call in the common case. A kill before the first card (the app backgrounded and swiped away) does not lose the deal: the restored game hands it over when its session opens. A restore into a game that **adopted the killed process's session** (`syncResume()` succeeded) drops the kept unit and its stored copy instead: it was handed over before the kill, and handing it over again would repeat it. A restore that lands after the first card opened a **fresh** session (the load was still pending) hands the unit to that session at once, so a new session always starts with its `hand_opened`. A kept unit of another hand is dropped as stale, and a load that lands after New Game is ignored (the screen's game generation). When the unit is handed over the recorder is flushed to the queue **before** the kept copy is cleared (`closeUnit` only schedules an idle save), so no kill window loses it; the AsyncStorage write that follows is still asynchronous (the gap tracked in epic #3367).
- **On background (and blur, and unmount, and leaving the game) the tricks so far go to the recorder as a part of `hand_played` and everything it holds is handed to the queue now, synchronously** (`useGameRecorder().flush()`). The queue's own AsyncStorage write is still asynchronous. The rest of the hand follows as the next part (`n` the first trick of it). A kill without a background loses at most the tricks of the hand in progress (12 at the most); the gap shows in `n` / `h`.
- **Parts are bounded**, because each row costs about 200 B stored and a player can background the app, or open the scorecard (a blur), after every trick. A blur makes a part only for at least 3 tricks (`BLUR_MIN_TRICKS`); a hand has at most 3 parts before its last row (`MAX_PARTS_PER_HAND`), however often the app is backgrounded. Past the cap a flush still hands the recorder's other units to the queue, but the hand's tricks stay in memory (a kill loses them) until the hand ends; leaving the game (unmount, New Game) is exempt and always hands the tricks over. So a hand is at most 5 rows, not 14.
- A game resumed mid-hand continues its session. If its session cannot be resumed (it was abandoned), the new session has no `hand_opened` for the hand in progress (the original deal is not saved) and its first `hand_played` starts at the trick it restored. The principles of plays made before the kill are not known (0).
- `t_ms` is the time the unit was handed to the recorder (a hand's `hand_played` is stamped when the hand ends).
- **Kill switch.** The recorder is the switch: whether it records is decided once per session by the dial (`isRecordingEnabled`, #3279's per-game kill switch and sample rate), and when off `record()` keeps nothing, so nothing is measured, saved, written or reported (test: no serialisation, no queue save, no storage write). `HeartsReplay` itself only builds a few strings.

### Size against the caps

Compact JSON, envelope included (the app's cap is the same figure, `HEARTS_*_MAX_BYTES` in `eventQueueConfig.ts`; the backend's `MAX_*_BYTES` is held equal by a test):

| Event         | Typical (11 hands) | Worst honest (hand 60, 10-digit `t_ms`) | Cap |
| ------------- | ------------------ | --------------------------------------- | --- |
| `hand_opened` | 230 B              | 232 B                                   | 384 |
| `hand_played` | 230 B              | 264 B                                   | 384 |

The 100-point rule ends a game within 16 hands (four players at 99 total 396, and 16 x 26 = 416), so the longest game is 32 rows. Real conservative-CPU games run 6 to 15 hands.

- **Device** (queue, 5,000 rows / 5 MB; session cap 64 KB): an 11-hand game records 22 events and 5,050 B; the longest possible 16 hands about 7.5 KB, under 12% of the session cap.
- **Server** (`DEFAULT_CAP`, 500 events / 160 KB with 200 B row overhead; stored as `jsonb` text, which adds a space after each `,` and `:`): an 11-hand game is 22 rows and 9,922 B (the epic plans 40 KB a game); a six-hand game 12 rows and 5,392 B; the longest game at the widest digits 32 rows and 15,054 B (6% of the events, 9% of the bytes, 37% of the plan). **The costliest game the app can make** (16 hands, backgrounded after every trick, widest digits, the last hand left instead of finished) is 80 rows and **28,494 B** (70% of the plan); without the cap on parts the same game would be 224 rows and 69,481 B, which is why there is one. A real 15-hand game backgrounded and blurred after every trick is 75 rows and 26,023 B (bench). Hearts has no cap of its own. The replay is uploaded for the server-controlled sample of sessions (and those with errors), so the dial (#3279, #3292) bounds it.
- **Per day.** A heavy player's five 11-hand games a day are about 25 KB on the device and at most 50 KB on the server at a 100% sample; the sample rate multiplies the second figure.
- **Validation** (`validate_event`): a pydantic model per type, `extra="forbid"`, strict ints, cards by pattern. A deal is 52 distinct cards and its direction follows the hand number; a pass is 12 distinct cards, each from the seat's own hand, and a hold hand has none; a `hand_played` row is whole tricks of distinct cards, carries a score only if it ends the hand (its last trick the 13th), and a score is a scoring the engine can make with the shooter matching it. That each play is from the seat's hand is a check across rows (the reader's). A bad event is dropped with a 2xx and one Sentry report by reason, and cuts the game's stored replay there (the stored replay is a prefix by `event_index`).

### Measured (`game/hearts/__tests__/replay.bench.test.ts`)

A seeded 11-hand game (the real engine and conservative AI) over the real GameEventClient → EventStore → AsyncStorage mock, against saving one event per card played:

|                                        | One event per card | As built (two rows a hand) |
| -------------------------------------- | ------------------ | -------------------------- |
| Queue saves (`EventStore` calls)       | 583                | **22**                     |
| AsyncStorage writes                    | 1,166              | **44**                     |
| Bytes written to storage               | 6.0 MB             | **127 KB**                 |
| Events                                 | 583                | 22                         |
| Recorded JSON (sum of `data`)          | 35.1 KB            | **5.1 KB**                 |
| Stored on the server (`jsonb` + 200 B) | about 160 KB       | **9.9 KB**                 |

The 44 writes are two per save: the queue's chunk and the pending-games counter. The bench also asserts the absolute stored bytes: under a third of the 40 KB plan for this game, and under half of it for the longest possible game (15,054 B, equal to the figure the backend test computes) and for a 15-hand real game. No gameplay event is uploaded while the game is open (SyncWorker holds them until the game ends or the app is backgrounded, #3275); there was no per-event Hearts send before, so nothing was retired in the app. The older `game_started` shape (`{initial_score: 0}`) is still valid: it is stored as sent.

### Deploy order

The seed migration `0039_hearts_hand_events` (seed only, no schema change) must be deployed before the app that sends the types, or the server answers `400 unknown_event_type` and the queue holds the batch for 24 h. It sits on `0045_replay_sample_rate_full`.

## Key files

- Rules engine: `frontend/src/game/hearts/engine.ts`
- Screen: [`frontend/src/screens/HeartsScreen.tsx`](../../frontend/src/screens/HeartsScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- AI entry points: `frontend/src/game/hearts/ai.ts`
- Replay recording: `frontend/src/game/hearts/replay.ts` (events, units), `frontend/src/game/hearts/pendingReplay.ts` (hand 1's opening across a kill), `backend/hearts/events.py` (validation), `backend/alembic/versions/0039_hearts_hand_events.py` (seed)
- Conservative CPU: `frontend/src/game/hearts/conservative/` (spec: [hearts/CONSERVATIVE_AI.md](../hearts/CONSERVATIVE_AI.md))
- Utility considerations: `frontend/src/game/hearts/aiConsiderations.ts`
- Persona weights/noise: `frontend/src/game/hearts/aiWeights.ts`
- Information set/pass memory: `frontend/src/game/hearts/aiInfoSet.ts`
- Moon hand quality: `frontend/src/game/hearts/moonHand.ts`
- PIMC research record: [HEARTS_PIMC_SPIKE.md](../research/HEARTS_PIMC_SPIKE.md)

## Open AI dependency

Current rules and reporting can be considered documented now.

The AI section remains explicitly provisional while:
- #2587 — production PIMC strong engine;
- #2283 — unified one-engine difficulty epic;
- #2233 — remaining Hearts AI robustness work

remain open.

Do not keep a generic "Known Issues: none" section here while that architectural work is still active; GitHub owns the implementation backlog.
