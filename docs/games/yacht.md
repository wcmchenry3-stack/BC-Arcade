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

| Category        | Rule                         |           Score |
| --------------- | ---------------------------- | --------------: |
| Ones–Sixes      | Sum dice showing that face   |        Variable |
| Three of a Kind | At least 3 matching dice     | Sum of all dice |
| Four of a Kind  | At least 4 matching dice     | Sum of all dice |
| Full House      | 3 of one face + 2 of another |              25 |
| Small Straight  | At least 4 sequential faces  |              30 |
| Large Straight  | 5 sequential faces           |              40 |
| Yacht           | All 5 dice match             |              50 |
| Chance          | Any dice                     | Sum of all dice |

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

The human always moves first in a round. The `Round N / 13` header shows the round of whoever is playing (capped at 13): while the computer plays, it is the computer's own round counter, not the human's, which is already one ahead after scoring (#3491).

The public Yacht leaderboard ranks **the human player's final score only**. Solo and vs games share one board; AI difficulty does not partition it.

## UI

The screen (`frontend/src/screens/GameScreen.tsx`) is a **thumb tray** (#3748): the scorecard on top, and below it one card with everything a turn needs in thumb reach. Solo and vs share one layout; the Hint exists in solo only.

```
Header      Back · Yacht · Round N / 13 · ⋯
Scorecard   header (Category · You · CPU)
            Ones … Sixes
            ── Upper subtotal band ──
            Three of a Kind … Chance
            Total
Tray        turn hint
            five dice
            [ Roll (N left) ]  Hint  New Game      (the shared GameActionBar)
Tab bar     unchanged
```

### Scorecard (`components/yacht/ScoreTable.tsx`)

- **One table for both modes**: one score column in solo, two (You, CPU) in vs. All 13 rows, the upper subtotal band and the total are visible on a **390 × 844 phone** with no tabs and no scrolling (rows 29 pt). Below the height that needs (a 320 × 568 phone) the table scrolls inside its card, and the row the computer just scored is scrolled into view.
- **Rows are the tap target** (`score-row-<key>`; the whole row, 29 pt tall, not the 44 pt minimum: the owner chose 13 rows on one screen). A row is a button for a screen reader at all times, disabled unless it is open and it is your turn.
- **Potentials look the same in both modes**: the points on the table in the potential (teal) colour, 0s dimmed, the best open row (most points, the first of equals) boxed. A scored row shows its score in bold; a scratched row (0) is dimmed. Before the first roll no row shows a potential.
- **The upper subtotal is a band, not a score row**: its own background (surface high in dark, surface alt in light), a 2 pt top rule, a bold small-caps "Upper subtotal" label, and the bonus line `42 / 63 · +35 bonus` (`63 / 63 ✓ · +35 bonus` once earned) with each player's subtotal in its column and a `+35` under it when earned. It has no `score-row-*` testID, no press handler and no potential style (`yacht-upper-subtotal`).
- **Labels are in full** ("Small Straight (30)", "Large Straight (40)") and may wrap to two lines; a longer label makes its row taller rather than truncating.
- **The Yacht Bonus** is named under the total, with `+100` per player, only once someone has one.
- **The computer's last row**: in vs, the row the computer just scored is tinted purple with a left bar (`yacht-cpu-row-bar`) from its score until you roll or start a new game. A game restored from a save highlights nothing.
- **The Hint's row** is tinted green with a left bar (`yacht-hint-row-bar`) while the hint is up.
- The computer's column and text are `outcomeDraw` (purple that reaches AA on cream), your header is `accentText`.

### Tray (`components/DiceRow.tsx`)

- **Turn hint**: solo, "Press Roll to start your turn" then "Tap dice to hold". Vs, "Your Turn" in front of it. On the computer's turn: "Computer is rolling…" and its roll counter ("Roll 2 / 3"); the dice shown are the computer's, at full opacity.
- **Dice** are sized from the width the dice row measures (`dieSizeFor`: up to 60 pt, down to 36, five dice and four 8 pt gaps always fit), never from the window, so they can't overflow the card.
- **Held** is a teal ring just outside the die (inside the gap) and a 4 pt lift, replacing the 1.12 × scale and the outside `HELD` badge. The ring's width, the lift and the die's label (", held") say it, not colour alone. Held pips are `accentText`.
- **Roll** shows the rolls left; on the computer's turn it reads "Computer's Turn" and is disabled. (It has no "Rolling…" state: the roll is synchronous.)
- **Action bar**: the shared `GameActionBar`, beside Roll: **New Game** (the old row of its own is gone; the ⋯ menu still has it) and, **in solo only**, **Hint**.

### Hint (solo only)

`game/yacht/hint.ts` asks the exact oracle (`ai.ts`, λ = 1: optimal play, no slips) what to do with the dice on the table. Before the last roll it names the dice to keep (a green ring on each; all five dice rolled again if it keeps none). After the third roll, or when the best play is to stop and score, it names the best row (Joker rules included). The message ("Hint: keep the highlighted dice", "Hint: score Large Straight (40)") replaces the turn hint in the tray and is announced to a screen reader.

It behaves like 2048's: up for **2 s** (`useTransientToast`), cleared by a roll, a hold or a score; with nothing to suggest (before the first roll) a 2 s "No hint available" message; **disabled** while the dice are rolling, on the computer's turn and once the game is over. It changes nothing in the game and is not recorded (the replay has no slot for it, and Yacht scores no cost for one). The oracle table (about 400 ms to decode in Jest, more on a phone) is warmed on a timer once the first roll of a solo game is down, so the first Hint is instant; a VS game warms it for the computer, and a player who never rolls never loads it.

### End card

The shared result card. Solo shows the player's Upper / Lower / Bonus stats and a subtitle for the rarest feat: Yacht bonuses, then a Yacht scored in its row, then the upper bonus (`game/yacht/scoreSummary.ts`). Vs drops those player-only stats and shows **both players'** upper and lower subtotals in `YachtFinalScorecard`, which also marks who won each row (green for you, purple for the computer, nothing on a tie; a screen reader gets "Ones: you 4, computer 1, you win the row") and the winner of the total.

### Text, colour and languages

- All words are i18n (`locales/<lang>/yacht.json`), including the `YACHT!` and `JOKER!` celebration words (the game's name stays `YACHT!`; the font shrinks for a long word on a narrow phone). Layout is checked in en, fr-CA and es at 320 and 390 pt (`e2e/tests/yacht-layout.spec.ts`).
- Text that was the accent is `colors.accentText` (a darker teal in light, ≥ 4.5:1 on cream); see [BRANDING.md](../BRANDING.md#accent-as-text-accenttext-3748).

## Motion (#3749)

Every timing is in `frontend/src/game/yacht/motion.ts`; `__tests__/motion.test.ts` holds the ceilings. The owner picked proposal 2, "tumble". Times are from the press (your roll or score) unless the row says otherwise.

| What                                     | Constant(s)                                                                                                                                                                              | When / how long                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tumble (one die)                         | `TUMBLE_MS` 420                                                                                                                                                                          | 0 to 420 ms                                         | turns 0 to 360° (ease-out over the first 85 %, `TUMBLE_SPIN_SHARE`), hops up to 6 pt (`TUMBLE_HOP_PX`, a sine over the first 80 %; with the turning corners it rises about 18 pt, and the dice row keeps that room above the dice, `tumbleRise`, so it never covers the hint line), until its stagger starts it shows its old face, then flicks a random face every 70 ms (`TUMBLE_FACE_MS`); at 80 % (`TUMBLE_LAND_AT`, 336 ms) it shows its final face and lands with a squash to 1.07 (`TUMBLE_SQUASH_SCALE`) |
| Stagger                                  | `TUMBLE_STAGGER_MS` 35                                                                                                                                                                   | each rolled die 35 ms after the one to its left     | only the dice rolled tumble; held dice stay still                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Dice at rest, input unlocks              | `tumbleTotalMs(n)`; safety net `inputLockMaxMs(n)` = + `INPUT_LOCK_FALLBACK_MS` 250                                                                                                      | 420 + 35 × (n − 1): 560 ms for five, 455 ms for two | Roll, the dice, the score rows and Hint are inert until every rolled die reports its landing (its animation's end callback, so the lock covers the tumble as it really ran), or at the latest at the safety net (audit bug 8). They are disabled to a screen reader, though Roll, the dice and the rows keep their look (no grey flash on every roll). The net's timer is cleared on landing, unmount, New Game and Reduce Motion (bug 9). The roll sound settles at about 0.42 s, with the first die            |
| Hold / release                           | `HOLD_MS` 150                                                                                                                                                                            | 0 to 150 ms                                         | the 4 pt lift eases in and out; the ring fades in                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Score pop                                | `SCORE_POP_MS` 260, `SCORE_POP_SCALE` 1.2                                                                                                                                                | 0 to 260 ms, peak at 130 ms                         | the scored cell, yours and the computer's                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Total count-up                           | `TOTAL_COUNT_MS` 300                                                                                                                                                                     | 0 to 300 ms                                         | ease-out; the text's accessibility label is always the final total                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Upper bonus pulse                        | `BONUS_PULSE_MS` 400, `BONUS_PULSE_SCALE` 1.3                                                                                                                                            | 0 to 400 ms                                         | the band's "+35", when it is earned                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| YACHT! / JOKER! celebration              | `JACKPOT_EXIT_AT_MS` 2200, `JACKPOT_DONE_MS` 2800, `JACKPOT_PARTICLE_STAGGER_MS` 45, `JACKPOT_BADGE_FADE_OUT_MS` 500, `JACKPOT_PARTICLE_FADE_OUT_MS` 400, `JACKPOT_REDUCED_DONE_MS` 1500 | done at 2.8 s (1.5 s under Reduce Motion)           | unchanged by this story, so the jackpot sounds keep their timing                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Computer: a roll                         | `cpuRollMs(n)` = `tumbleTotalMs(n)` + `CPU_SETTLE_MS` 150                                                                                                                                | 710 ms for five dice                                | its dice tumble (the roll sound plays as they start), then settle                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Computer: a hold                         | `CPU_HOLD_MS` 500                                                                                                                                                                        | 500 ms                                              | its held dice are shown before it re-rolls                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Computer: the score beat                 | `CPU_SCORE_BEAT_MS` 600                                                                                                                                                                  | 600 ms                                              | then its score lands (pop, count-up, its row highlighted)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Computer: longest turn                   | `cpuTurnMaxMs()`                                                                                                                                                                         | 3.73 s (was 8 s)                                    | a roll and two re-rolls of five, two holds, the score beat                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Computer: its last turn after yours (vs) | `CPU_LAST_TURN_SPEED` 2                                                                                                                                                                  | at most 1.87 s                                      | everything at 2×, tumbles included, still shown step by step (owner)                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Computer: under Reduce Motion            | `CPU_REDUCED_MOTION_SPEED` 2                                                                                                                                                             | at most 1.87 s (its last turn 0.93 s)               | every step halved, no tumbles, still step by step (owner); read at each step                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| End beat                                 | `WIN_BEAT_MS` 1000, `LOSS_BEAT_MS` 600, `TIE_BEAT_MS` 600                                                                                                                                | from the game's last score                          | see below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### End beats and the moments for the end sounds (#3750)

The result card waits for a beat (`components/yacht/useYachtEndBeat.ts`, as 2048's `useTwenty48Beat`, held through `components/yacht/useYachtMotion.ts`). The beat is started in the same handler as the `setState` of the game's last score (solo: yours, in `handleScore`; vs: the computer's, from `useYachtCpuOpponent`'s `onScored`, in one batch), so the card never flashes before it. The outcome: in vs, win, loss or tie from the totals; in solo, **win on a new personal best, otherwise tie** (owner).

| Game ends with                                   | Beat starts (end sound)                                                                                                                       | Card shows                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Solo, your last score                            | with the score (0 s)                                                                                                                          | 1.0 s on a new best, 0.6 s otherwise        |
| Solo, your last score a Yacht or a Joker         | when the celebration ends: 2.8 s                                                                                                              | 3.8 s (new best) or 3.4 s                   |
| Vs, the computer's last score                    | with its score: up to 1.87 s after yours (its last turn at 2×)                                                                                | +1.0 s (you win), +0.6 s (you lose or tie)  |
| Vs, the computer's last score a Yacht or a Joker | after its own 0.7 s sound (`CPU_JACKPOT_SOUND_MS`), so the end sound never stacks on it; the card is held meanwhile, also under Reduce Motion | +1.0 / +0.6 s (at once under Reduce Motion) |
| Vs, your last score a Yacht or a Joker           | when the celebration ends (2.8 s after your score), if it is still showing when the computer scores                                           | +1.0 / +0.6 s                               |
| Reduce Motion                                    | with the last score (after a still celebration, 1.5 s)                                                                                        | at once                                     |
| A game reopened on the computer's last turn      | never: no beat, no end sound                                                                                                                  | at once (that turn is scored on open)       |

For #3750: `useYachtMotion({ onStart })` (passed to `useYachtEndBeat`) calls `onStart(outcome, beatMs)` at the moment the beat starts, once per game and never on a restore; the card shows `beatMs` later (0 under Reduce Motion). `endOutcome` holds the outcome until a New Game. The end sounds (#3750) play from `onStart` in `GameScreen` (see the Sound table), at the beat's start so the chord lands as the card shows; only one sound plays, since a last-score jackpot's beat waits for its celebration. Under Reduce Motion `onStart` still fires, with `beatMs` 0: the sound plays (it is audio, not motion), the card shows at once and the chord lands about 1.0 s (win) or 0.6 s after it.

- **The card never covers a celebration** (audit bug 1): a last score that is a Yacht or a Joker, or a celebration still showing when the computer scores, holds the card with no timer until the celebration's `onDone`; then the beat runs. A safety net (`JACKPOT_WAIT_MAX_MS`, 3.5 s) starts the beat if the celebration never reports that it is done.
- **New Game and leaving** clear the beat, any wait and the tumble.
- **The tray during the beat** (owner): the final dice stay on the table (in vs, the computer's last roll), the hint reads "Game over" (`dice.hintGameOver`) and Roll is disabled ("Roll (0 left)"); it never looks like a fresh turn.
- **Solo best not read yet** (rare: it is read at mount): the card waits for the read, then the beat with the right outcome.
- **A Reduce Motion change mid-celebration** restarts the celebration (`useCelebration`), so the beat's safety net is re-armed and the card still never covers it.
- **The solo best** is local (owner): the shared personal best (#3757, `game/_shared/personalBest.ts`, key `personal_best_v1:yacht`; the old `yacht_best_score_v1` is moved in on the first read), read when the screen mounts so the check at the end is synchronous (`soloEndOutcome` in `game/yacht/bestScore.ts`), and stored only when beaten. The first finished solo game counts as a new best; a score above 1575 (the most a game can score) is never one. Vs games don't record it. It is a record of its own beside the game save, so older saves load unchanged. No server I/O.
- **A game reopened on the computer's last turn** (you had finished; `resumeInstantly`): that turn is played to its score at once, with no steps, no tumble and no sound (its score carries no events), and the card shows.

### Reduce Motion

Read live with `useReduceMotion` ([ACCESSIBILITY.md section 3](../ACCESSIBILITY.md)):

- no tumble (the faces change in place, and input is not locked), no hold ease, no pop, no count-up, no bonus pulse, no end beat (the card shows at once);
- turned on mid-tumble, the dice snap to rest and input unlocks; turned on mid-beat, the timer is cancelled and the card shows; turning it off again replays nothing;
- the computer's turn: its pauses are halved and its dice don't tumble, still step by step.

How it is built: the tumble runs on the UI thread (Reanimated): one shared value per die drives its transform and the pips' opacity (`Die.tsx`); nothing on the JS thread per frame except the total's count-up (one small text, about 18 frames). A rolled die waiting for its stagger keeps showing its old face. Between the press and the tumble's first frame there is one render: `possibleScores` is a `useMemo`, events are not cleared from state (each action's are a new array, fired once; the save leaves them out), a roll is saved once its dice land, the scorecard context is updated only when the card changes, and the pips are memoized. The e2e test checks the first moved frame comes within 4 frames of the press.

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

| Difficulty | Foresight λ | Temperature T | Max loss Δ | Character                                                       |
| ---------- | ----------: | ------------: | ---------: | --------------------------------------------------------------- |
| Easy       |         0.0 |             3 |         10 | Greedy/short-sighted; does not plan for future scorecard value  |
| Medium     |         0.4 |             1 |          5 | Partial future planning with smaller slips                      |
| Hard       |         1.0 |           0.5 |          3 | Near-optimal oracle valuation with very small bounded variation |

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

The local save contains the game state and, for vs mode, AI state/difficulty so an unfinished match can resume. A game reopened with only the computer's last turn left has that turn scored at once and shows its card (#3749). The solo personal best is a separate local record (`personal_best_v1:yacht`, see [Motion](#motion-3749)).

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

| Event            | When                                  | Notes                                                                                                                                                   |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `game_started`   | the session opens                     | lifecycle. `{ v: 1, mode: "solo", engine_version }` or `{ v: 1, mode: "vs", cpu_type: "oracle", difficulty, engine_version }` (`ENGINE_VERSION`, #3909) |
| `turn_completed` | a turn is scored, either player       | replay tier; one per player per round (13 solo, 26 vs); the data below                                                                                  |
| `game_ended`     | the session completes or is abandoned | lifecycle                                                                                                                                               |
| `roll`, `score`  | **retired** (builds before #3282)     | the human's per-roll / per-score events. Still seeded and stored as sent; the app no longer sends them                                                  |

`cpu_type` names the opponent's engine (`oracle`: `ai.ts`); a new computer type adds a value, not a field.

**A `turn_completed` event** is the recorder's envelope (`v` 1, `unit`, `t_ms`, and in a vs game `actor` = `{ seat, kind }`: seat 0 / `human`, seat 1 / `cpu`; a solo turn has no actor) plus the turn, with compact keys and booleans left out when false:

| Key     | Meaning                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `r`     | the round, 1 to 13                                                                                                                                                                                      |
| `rolls` | 1 to 3 rolls, each `[dice]` or `[dice, mask]`: the five dice the roll produced, and the hold mask going **into** it (bit i = die i kept; left out when 0, which the first roll always is)               |
| `h`     | the human's hold taps between rolls, `[after_roll, die, held 1\|0]`, at most 16 per turn; left out when none. The computer sets its holds directly and has none: its masks are in `rolls`               |
| `ro`    | rolls of this turn lost because the app was killed mid-turn (a resumed turn); left out when 0                                                                                                           |
| `s`     | the scored choice, `[category, value]`; `category` is the index in `CATEGORIES` (`engine.ts`: ones … sixes, three_of_a_kind, four_of_a_kind, full_house, small_straight, large_straight, yacht, chance) |
| `alt`   | the **other** legal categories, flat `[category, value, ...]` in category order (Joker rules applied); left out when there are none                                                                     |
| `jk`    | 1 when the Joker rule applied (an extra Yacht with the Yacht box at 50)                                                                                                                                 |
| `yb`    | 1 when the score earned a Yacht bonus (100)                                                                                                                                                             |
| `ub`    | 1 when the score earned the upper bonus (35)                                                                                                                                                            |
| `yc`    | the Yacht bonus count after the turn; left out when 0                                                                                                                                                   |
| `us`    | the upper subtotal after the turn                                                                                                                                                                       |
| `tot`   | the total score after the turn                                                                                                                                                                          |
| `ev`    | the computer only: `[EV of its choice, EV of the best legal category]` to one decimal                                                                                                                   |

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

|                                                               | Before (human only, `roll` / `score`) | After (both players, `turn_completed`)         |
| ------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Queue saves (`EventStore.enqueueEvent` / `enqueueMany` calls) | 29                                    | **26**                                         |
| AsyncStorage writes                                           | 58                                    | **52**                                         |
| Bytes written to storage                                      | 167,912                               | **163,335**                                    |
| Events                                                        | 29                                    | 26                                             |
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

## Sound

Registry: `frontend/src/game/yacht/sounds.ts` (`YACHT_SOUNDS`), played through the shared `useSound` hook, which honours the player's sound setting. The effects are being replaced with original synthesized sounds shared across the puzzle, tile and dice games (#3578); the reasoning behind each is in the [puzzle sound design log](puzzle-sound-design.md). Volume is `useSound`'s default (1.0) unless noted.

Triggers are in `frontend/src/screens/GameScreen.tsx`.

| Key                                                                                                                                           | File                                                                               | Plays when                                                                                                                                                                                                       | Volume |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `yacht.diceRoll`, `yacht.diceRoll2`, `yacht.diceRoll3`                                                                                        | `dice-roll-1.ogg`, `dice-roll-2.ogg`, `dice-roll-3.ogg` (synthesized, #3578)       | you roll the dice, and each time the computer rolls (on its dice starting to tumble, so a restored computer turn doesn't replay one); `useSoundVariants` plays a random variation, never the same twice in a row | 1.0    |
| `yacht.dieHold`, `yacht.dieHold2`, `yacht.dieHold3`                                                                                           | `die-hold-1.ogg`, `die-hold-2.ogg`, `die-hold-3.ogg` (synthesized, #3578)          | you hold a die; `useSoundVariants` (the computer's holds are silent)                                                                                                                                             | 1.0    |
| `yacht.dieRelease`, `yacht.dieRelease2`, `yacht.dieRelease3`                                                                                  | `die-release-1.ogg`, `die-release-2.ogg`, `die-release-3.ogg` (synthesized, #3578) | you release a held die; `useSoundVariants`                                                                                                                                                                       | 1.0    |
| `yacht.scoreCommit`                                                                                                                           | `score-commit.ogg`                                                                 | you score a category with no milestone below                                                                                                                                                                     | 1.0    |
| `yacht.scoreZero`                                                                                                                             | `score-zero.ogg`                                                                   | you score a 0                                                                                                                                                                                                    | 1.0    |
| `yacht.smallStraight`                                                                                                                         | `small-straight.ogg`                                                               | you score a small straight                                                                                                                                                                                       | 1.0    |
| `yacht.largeStraight`                                                                                                                         | `large-straight.ogg`                                                               | you score a large straight                                                                                                                                                                                       | 1.0    |
| `yacht.fullHouse`                                                                                                                             | `full-house.ogg`                                                                   | you score a full house                                                                                                                                                                                           | 1.0    |
| `yacht.upperBonus`                                                                                                                            | `upper-bonus.ogg`                                                                  | you earn the upper bonus                                                                                                                                                                                         | 1.0    |
| `yacht.cpuScoreCommit`, `yacht.cpuScoreZero`, `yacht.cpuSmallStraight`, `yacht.cpuLargeStraight`, `yacht.cpuFullHouse`, `yacht.cpuUpperBonus` | `cpu-*.ogg` (the same six names)                                                   | the computer's scores: its "rival" versions (falling, minor, darker, quieter)                                                                                                                                    | 1.0    |
| `yacht.yacht`                                                                                                                                 | `jackpot-yacht.ogg` (synthesized, #3578)                                           | you score a yacht, with the celebration                                                                                                                                                                          | 1.0    |
| `yacht.joker`                                                                                                                                 | `jackpot-joker.ogg` (synthesized, #3578)                                           | you score a joker yacht, with the celebration                                                                                                                                                                    | 1.0    |
| `yacht.cpuYacht`, `yacht.cpuJoker`                                                                                                            | `cpu-jackpot-yacht.ogg`, `cpu-jackpot-joker.ogg`                                   | the computer scores a yacht or a joker (quick, the opposite tone)                                                                                                                                                | 1.0    |
| `yacht.win`                                                                                                                                   | `yacht-win.ogg` (synthesized, #3750)                                               | the end beat starts and you won (vs: your total beats the computer's; solo: a new personal best); its chord lands as the card shows, 1.0 s later                                                                 | 1.0    |
| `yacht.loss`                                                                                                                                  | `yacht-loss.ogg` (synthesized, #3750)                                              | the end beat starts and you lost (vs); its chord lands as the card shows, 0.6 s later                                                                                                                            | 1.0    |
| `yacht.tie`                                                                                                                                   | `yacht-tie.ogg` (synthesized, #3750)                                               | the end beat starts and it is a tie (vs), or a solo game that is not a new best; its chord lands 0.6 s later                                                                                                     | 1.0    |

Each score plays exactly one scoring sound (`game/yacht/useScoreSound.ts`): its top milestone (yacht or joker, then upper bonus, large straight, full house, small straight), which replaces the commit; else the commit, or the duller zero for a 0. Your yacht or joker plays its fanfare from the event handlers, with the celebration; the computer's from the same picker. Sounds are synthesized (#3578).
