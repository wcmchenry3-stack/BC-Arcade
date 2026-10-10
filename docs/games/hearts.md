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

Until #3159 lands, Conservative is a stand-in: the legacy Cautious weights with no noise (`conservativeStandIn` in `aiWeights.ts`, `NOISE_RATE.conservative = 0`). #3159 replaces it in that one place.

For a non-Mixed preset, all three AI seats use that persona.

Mixed uses a fixed canonical assignment:

| Seat | Position | Persona |
| ---: | --- | --- |
| 1 | left AI | Cautious |
| 2 | top AI | Schemer |
| 3 | right AI | Daring |

The selected preset (`ai_difficulty`: `conservative` in store builds) is recorded in game metadata but does **not** partition the public leaderboard.

## Current AI architecture

The current production AI is a **utility-scoring engine**, not a search/lookahead engine.

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

Equal values use the shared final tie-break: earlier `completed_at` ranks first.

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

## Key files

- Rules engine: `frontend/src/game/hearts/engine.ts`
- Screen: [`frontend/src/screens/HeartsScreen.tsx`](../../frontend/src/screens/HeartsScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Current AI: `frontend/src/game/hearts/ai.ts`
- Utility considerations: `frontend/src/game/hearts/aiConsiderations.ts`
- Persona weights/noise: `frontend/src/game/hearts/aiWeights.ts`
- Information set/pass memory: `frontend/src/game/hearts/aiInfoSet.ts`
- Moon hand quality: `frontend/src/game/hearts/moonHand.ts`
- PIMC research record: [HEARTS_PIMC_SPIKE.md](../research/HEARTS_PIMC_SPIKE.md)
- Conservative CPU spec (planned replacement, epic #3156): [hearts/CONSERVATIVE_AI.md](../hearts/CONSERVATIVE_AI.md)

## Open AI dependency

Current rules and reporting can be considered documented now.

The AI section remains explicitly provisional while:
- #2587 — production PIMC strong engine;
- #2283 — unified one-engine difficulty epic;
- #2233 — remaining Hearts AI robustness work

remain open.

Do not keep a generic "Known Issues: none" section here while that architectural work is still active; GitHub owns the implementation backlog.
