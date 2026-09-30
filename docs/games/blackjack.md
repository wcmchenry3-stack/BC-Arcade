# Blackjack

**Category:** Card  
**Tier:** Premium  
**Status:** In development

BC Arcade Blackjack uses familiar Blackjack rules inside an **arcade run**. The chips are fictional run resources: they cannot be purchased, redeemed, withdrawn, exchanged for money, or used to buy another chance. Premium purchase/entitlement grants access to the game itself, never chips or paid continuation.

If a run ends, an entitled player can start another run without a transaction or payment gate.

Shared session, offline, result-card and Stats behavior lives in [GAME-CONTRACT.md](../GAME-CONTRACT.md). This file owns Blackjack-specific gameplay, run progression and chip semantics.

## Arcade economy

The terms **chips**, **bet**, **payout**, **Blackjack**, and **High Roller** describe the internal game mechanic only.

Current product contract:

- every table starts the player with a fresh configured chip stack;
- the player cannot buy chips;
- there is no real-money wager;
- chips have no cash value and cannot be redeemed;
- there is no cash-out to money;
- "Cash Out" means **finish the successful arcade run and bank its in-game completion/history**;
- losing all chips ends that run, but does not lock the player out of starting another;
- no continue, extra life, refill, or second chance is sold for money.

This is the behavior #2788 verifies for the premium release.

## Run rules at a glance

| Stage       | Rule                                                                                                                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start       | Player picks a table (Beginner is always open). The run starts with that table's fixed starting chips (100 / 250 / 500). No chips carry over from any earlier run.                                                                                                                                   |
| Betting     | Bets stay within the table's min/max and can never exceed the current stack; a stack below the table minimum may only bet all-in. A zero-chip run cannot bet at all (the engine rejects any bet, including 0). Double and split need enough uncommitted chips. There is no way to add chips mid-run. |
| Progression | Chips move only by hand settlement (3:2 natural, 1:1 win, push, loss). Reaching the goal opens the victory phase (Cash Out or Keep Playing).                                                                                                                                                         |
| End         | Goal reached then Cash Out (win), chips reach zero (loss, or win if the goal was already reached), or New Game / quit before the goal (abandoned).                                                                                                                                                   |
| Persisted   | Local engine state (for resume) and a local run record per run with hands played. The server records one game row per run with outcome, hands and starting/final chips. Chips are never restored into a new run: every run opens with the table's fixed stack.                                       |
| Scored      | The backend (`backend/blackjack/module.py`) records the run's final chips as its score and shows best and latest chips in Stats. The leaderboard is disabled, and there is no chip currency.                                                                                                         |
| Replay      | After any end, **Play Again** / **New Game** returns to the table picker and a table pick starts a fresh run immediately. No purchase, paywall or entitlement re-check sits between runs beyond the normal access gating for the game.                                                               |

## Automated verification (#2788)

- `frontend/src/game/blackjack/__tests__/economy.test.ts`: no Blackjack source imports a purchase/IAP/paywall module or an entitlement check other than the per-level `premiumLevels` lock; no chip buy/refill/restore/redeem/continue identifiers; every table always opens with its configured stack; wagers beyond the stack are rejected; a zero-chip run cannot bet (including a zero wager) and has no engine path forward except a new run; English copy has no buy/continue wording. The source scans are a tripwire, not a security boundary.
- `frontend/src/screens/__tests__/BlackjackReplay.test.tsx`: the out-of-chips card offers only Play Again and Home (no buy/continue copy), Play Again goes straight to the table picker, and each table then starts a fresh full-stack run.
- Existing coverage: run outcome recording (#2628) and Play Again after a bust-out in `BlackjackTableScreen.test.tsx`.

## Manual device checklist (iOS and Android)

Automated tests do not replace device evidence. On each of an iOS and an Android build, with premium access granted, record pass/fail and screenshots:

1. Start Beginner: chips read 100, goal 250; no purchase or "get chips" control appears anywhere (table picker, betting, table, menu, Stats).
2. Lose every chip: the result card shows "Out of Chips" with only Play Again and Home.
3. Tap Play Again: the table picker appears at once with no purchase sheet, paywall or loading gate; pick Beginner and confirm chips are back to 100.
4. Repeat with airplane mode on: replay still starts (offline).
5. Reach the goal, choose Keep Playing, then bust: the result is still a win and Play Again starts a fresh run.
6. New Game mid-run: confirm dialog, then a fresh run at the picked table.
7. Force-quit mid-hand and relaunch: the run resumes with the same chips; after finishing it, a new run still starts free.
8. Read the store listing, paywall and Premium screens: copy sells access to the game only, never chips, extra chances, lives or continues.

## Objective and card values

The player competes against the dealer. Build a hand as close to 21 as possible without going over, and beat the dealer's resolved total.

- 2–10: face value.
- Jack / Queen / King: 10.
- Ace: 11 when possible, otherwise 1 as needed to avoid busting.

A natural Blackjack is a two-card 21.

## Dealer rules

Default table rules use:

- 6 decks;
- dealer stands on soft 17 (`hit_soft_17 = false`);
- configured deck penetration of 0.75;
- automatic reshuffle when the remaining engine deck is low.

The engine supports a rules object, but player-facing difficulty variants are separate future work and should not be inferred from the current table tiers.

## Player actions

### Hit

Take another card.

### Stand

End action for the current hand and allow dealer/settlement logic to continue.

### Double Down

Available on an eligible two-card hand when enough uncommitted chips remain. The wager doubles and exactly one additional card is taken before the hand stands.

### Split

A two-card hand can split when the ranks match **or both cards are ten-valued**. The player must have enough uncommitted chips to fund the additional hand.

The engine caps a run at **3 splits**.

Split-ace restrictions are enforced by the engine; double-down is not available on a split-ace hand.

### Surrender

Not implemented. Late surrender remains separate backlog (#175) and must not be documented as current behavior.

## Hand settlement

For a non-split hand:

- **Natural Blackjack:** +1.5× the bet (3:2 net payout).
- **Win:** +1× the bet.
- **Push:** no chip change.
- **Loss:** −1× the bet.

The engine stores chips as the current bankroll and applies the net delta at settlement.

For split hands, each hand resolves independently against the dealer using its own wager.

## Table progression

BC Arcade currently has three arcade tables:

| Table        | Starting chips | Run goal | Min bet | Max bet | Milestones |
| ------------ | -------------: | -------: | ------: | ------: | ---------- |
| Beginner     |            100 |      250 |       5 |      25 | 175, 220   |
| Intermediate |            250 |      750 |      10 |      50 | 500, 625   |
| High Roller  |            500 |     1500 |      25 |     200 | 1000, 1250 |

The Beginner table is always unlocked.

Completing a table's run goal unlocks the next table. Intermediate therefore depends on completing Beginner; High Roller depends on completing Intermediate.

A table's min/max bet is enforced by the engine. If the player has fewer chips than the nominal minimum, the effective minimum becomes the player's remaining stack, allowing an all-in final wager rather than creating an unusable stranded balance.

## Run lifecycle

A **run** begins when the player selects a table and receives that table's starting chips.

The run continues hand after hand until one of these things happens:

### Goal reached

When chips reach or exceed the table's run goal, the engine enters the victory phase.

The player can then:

- **Cash Out:** end the completed run and return to table selection.
- **Keep Playing:** continue at the same table without another run goal.

Once the run goal has been reached, that run is considered a **win** for server/reporting purposes even if the player chooses Keep Playing and later loses all remaining chips.

### Chips reach zero before the goal

The run ends as a **loss**.

### New Game / leave before the goal

A started run ends as **abandoned**.

A session in which no hand was actually played records no Blackjack result.

## Run history and comeback tracking

Run records are stored locally and include table, opening/final chips, whether the table goal was reached, hands played, biggest win, chip low, outcome and timestamps.

A "comeback" means the run:

1. fell to at most 25% of its starting chips **before** reaching the goal; and
2. later completed the table.

A later bust after Keep Playing does not erase that completed comeback.

## Milestones and cosmetic rewards

The engine/table config can emit milestone events as the chip stack crosses configured amounts.

There is also an existing local unlock model with three named cosmetic rewards:

- Felt Classic — Beginner completion;
- Indigo Card Back — Intermediate completion;
- Gold Chip Set — High Roller completion.

**These are not currently complete usable cosmetics.** #1911 tracks the missing visual assets, application logic and management UI.

Until #1911 is resolved:

- documentation must not imply that the player can equip/use these styles;
- an earned unlock record/notification should be treated as unfinished reward plumbing, not a finished customization feature.

## Persistence and resume

The full local engine state is saved in AsyncStorage.

A saved in-progress run can resume after relaunch. The shared game-session layer also attempts to resume the server session left open by the killed process.

The engine keeps enough state to preserve whether a run goal had already been reached, including after Keep Playing.

## Server reporting

Backend module: `backend/blackjack/module.py`.

A server game row represents one Blackjack run/session.

Creation metadata can include:

- best run chips from local history;
- total runs;
- completed runs;
- current table.

Result data includes:

- hands won;
- hands played;
- starting chips;
- final chips.

Outcomes:

- `win`: run goal was reached;
- `loss`: chips reached zero before the goal;
- `abandoned`: player left a started run before the goal.

There is **no public Blackjack leaderboard**. The backend board definition is disabled because chips are a run balance rather than a competitive score.

## Stats — current limitation

The board definition uses a chips-labelled `final_score` as the generic Stats "Best" metric, but current Blackjack completion code sends closing chips only in `result.final_chips` and leaves `final_score` null.

Therefore current server Stats cannot populate the intended Best/current-chip values.

This is a known implementation mismatch tracked by **#2745**. Do not document Best chips as working until that issue lands.

On-device Blackjack run history is separate and continues to use the locally stored run records.

## Premium entitlement

Blackjack is premium and hidden from the v1.0 store build because its simulated gambling mechanics affect store age-rating/product decisions.

When premium access ships, the purchase grants access to **Blackjack as a game**. It does not sell chips, wagers, retries, or run continuation.

Premium entitlement mechanics are shared platform behavior; see [ARCHITECTURE.md §10](../ARCHITECTURE.md#10-premium-entitlements).

## Engine and key files

- Engine: `frontend/src/game/blackjack/engine.ts`
- Run/session provider: `frontend/src/game/blackjack/BlackjackGameContext.tsx`
- Table definitions: `frontend/src/game/blackjack/tables.ts`
- Local run history/storage: `frontend/src/game/blackjack/storage.ts`
- Unlock plumbing: `frontend/src/game/blackjack/unlocks.ts`
- Backend module: `backend/blackjack/module.py`

## Open behavior dependencies

- #2788 — release verification of the arcade economy/free replay contract.
- #2745 — server Stats Best/current chips mismatch.
- #1911 — incomplete cosmetic reward system.
- #1127 — future Blackjack difficulty design.
- #175 — late surrender.

These should remain separate implementation/product issues. This file describes current behavior and calls out only dependencies that materially change the documented contract.
