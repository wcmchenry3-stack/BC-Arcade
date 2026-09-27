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

Equal scores use the shared final tie-break: earlier `completed_at` ranks first.

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

## Engine, AI, and validation

- Rules engine: `frontend/src/game/yacht/engine.ts`
- AI: `frontend/src/game/yacht/ai.ts`
- Oracle runtime/table: `frontend/src/game/yacht/oracle/`
- Oracle design reference: [YACHT_ORACLE.md](../research/YACHT_ORACLE.md)
- AI simulation/calibration: `frontend/src/game/yacht/sim/`
- Shared testing guidance: [TESTING.md](../TESTING.md)

## Documentation status

The Yacht portion of the unified-AI work is now implemented (#2245/#2246 and #2241 are closed). This specification therefore describes the current AI contract rather than a provisional future design.

The broader #2283 epic remains open because Hearts still has pending strong-engine work; that does not make Yacht's shipped architecture provisional.
