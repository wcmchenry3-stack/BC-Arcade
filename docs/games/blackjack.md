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

## The table (#3580)

Betting, play and the result all happen on **one table screen**: there is no screen swap between hands. The table picker, the victory screen, Stats and the run lifecycle are unchanged.

- **Top:** a slim HUD strip with the table name, chips / goal and the goal progress bar (the critical-bankroll warning or a win streak shows in the same row). **New Game** is in the header's ⋯ menu, behind the menu's confirm dialog (it ends the run and returns to the table picker).
- **Felt:** the dealer at the top, the player's hand(s) low near the dock, the middle kept free for the result.
- **Hands:** cards fan left to right so each card's corner index (rank and suit) shows. Each covered card shows 0.34 of its width (never less than 14 px or 0.3 of the width). The card width is the largest that fits the hand, capped per phone at `min(78, 0.2 × screen width)`; the dealer's cards are 0.86 of that. The hole card is a real card back from the shared `PlayingCard` (the active deck's back), outlined by the table (`textMuted`, at least 3:1 against the felt in both themes; `tableColors.ts`, checked in `theme/__tests__/blackjackTable.test.ts`) because a deck's back can sit close to the felt's colour. The dealer's total reads **?** until the hole card turns, and turns red on a bust.
- **Each hand** has a total pill (accent while it is played, red on a bust, green / red / grey for win / loss / push after the result) and its bet. Split hands already played are dimmed.
- **Splits:** 2 hands are fans side by side, kept low (each covered card shows 0.30 of its width), the active hand outlined. 3–4 hands are rows, one full-width row per hand with the hand number on the left over its total pill and bet (or, after the result, its payout) and the fan (0.42 reveal) on the right; the active row is 1.35× the height of the others (when there is room) and outlined. Every row is tall enough for its label column (`ROW_LABEL_CONTENT_HEIGHT`). With rows, the dealer is drawn as a row too (label on the left). Rows never draw a card narrower than 30 px; the dealer yields to them, and when the result needs the room the dealer's cards give way to its label and total beside the result banner. On a felt too short for rows (320×568: the felt is 216 px high), 3–4 hands are a 2×2 grid of fans, each with its label above.
- **Portrait only on phones:** a portrait window always uses single, fans, rows or the grid. The side-by-side arrangement (dealer, result, then each hand) is a best-effort fallback for a landscape window with a short felt; phones are locked to portrait in #3603. Every arrangement budgets height as well as width: nothing lands above the felt and the result never overlaps a hand.
- **Result:** shown on the felt between the dealer and the hands, never over either: the outcome and payout ("You Win! +25 chips") and one line of why ("Dealer busts with 22", "Bust with 24", "18 against the dealer's 20"). A plain loss shows the same banner in red. After a split the banner shows the round's net and each hand shows its own payout. The result also shows in the `victory` phase, before the victory screen opens (`showsResult` in `layout.ts`, shared by the felt, the screen and the geometry).
- **Dock** (bottom, one control set at a time, one constant height in every phase so the felt and its cards never resize between betting, play and the result; an engine error shows over the felt's foot, not in the dock). Its height is its content: 48 px chips (the touch target), the gap, the 50 px buttons and the padding (`DOCK_HEIGHT` in `layout.ts`, also used by `estimateFeltSize`). The Table Rules toggle and the Run Stats link share one row at the felt's foot.
  - betting: the chip tray (the table's chips; one all-in chip when the stack is below the table minimum), **Clear** and **Deal**. The table limits, the Table Rules toggle and the Run Stats link sit on the felt below the bet spot. Table Rules opens as a scrollable bottom sheet, so every rule and tooltip is reachable on short screens and the bet spot is never covered.
  - playing: **Hit**, **Stand**, **Double**, **Split**.
  - after the result: the chip tray (a chip starts the next bet with it), **Change** (next hand, pick a new bet), **Rebet** (deal again at the last stake, before any double down) and **2×** (deal again at twice it). Rebet and 2× follow the engine's bet rules (min/max, stack, all-in below the minimum) and are disabled when the engine would refuse the bet; everything is disabled once the chips run out (the Out of Chips card takes over).
- **Rebet / 2×** run `newHand` then `placeBet` as one transition (the context's `applySteps`): each step is counted and recorded as if played by hand, so the round counter, the replay round log and the session record see a new hand and an ordinary bet, but only the final state is rendered and saved (no betting frame in between). It runs from the latest state, so a second tap that lands after the first has dealt does nothing; a step that throws applies nothing.
- **Table picker:** shown while the context's `tablePickPending` is set (first launch, New Game, Cash Out, Play Again) until a table is picked. It is explicit state, never inferred from the chips, so a Keep Playing run whose chips return to the opening stack stays at the table.
- **Bet rules:** the engine exports the legal range `placeBet` enforces (`legalBetRange`); the dock's `betRules.ts` reads it.
- **Layout code:** pure helpers in `frontend/src/game/blackjack/layout.ts` (`computeTableGeometry`, `fitCardWidth`, `fanWidth`, `splitModeFor`, `estimateFeltSize`), memoised in the screen on the felt's measured size (inside its border) and the card counts. `estimateFeltSize` uses the same chrome terms the screen lays out (header, HUD strip, dock, tab bar and GameShell's bottom padding), matching the felt measured in the web build at 320×568 and 375×667. Unit-tested at 320×568, 375×667, 390×844 and 430×932 in `tableGeometry.test.ts`; `BlackjackTableScreen.layout.test.tsx` renders the screen at 320×568, 375×667 and 390×844 (a 6-card hand at the result, a 2-hand split while playing, a 4-hand split at the result) and checks that every card, label and the result drawn sit on the felt without overlapping. Bet rules for the dock: `frontend/src/game/blackjack/betRules.ts`. Components: `TableFelt`, `FannedHand`, `TableDock`, `TableRules` in `frontend/src/components/blackjack/`.
- **Cards are keyed by their place in the hand** (`dealer-0`, `hand-1-2` ...), so a card keeps its component from the deal to the result and the hole card is the same component face down and face up: card motion (#3581) can animate them. There is no card motion yet.
- **Sounds:** unchanged. The table screen plays them from the engine's events (`useGameEvents`): a deal sound per `cardDeal` event, and the blackjack, bust, win and push sounds with their flashes and banners.
- **Routes:** `BlackjackTable` is the screen. `BlackjackBetting` renders the same screen (`BlackjackBettingScreen.tsx` re-exports it) because it is the game's entry route: the lobby, the paywall's return (`entryRouteForSlug`) and the victory screen's Keep Playing / Next Table open it. Nothing navigates between the two any more.

## Automated verification (#2788)

- `frontend/src/game/blackjack/__tests__/economy.test.ts`: no Blackjack source imports a purchase/IAP/paywall module or an entitlement check other than the per-level `premiumLevels` lock; no chip buy/refill/restore/redeem/continue identifiers; every table always opens with its configured stack; wagers beyond the stack are rejected; a zero-chip run cannot bet (including a zero wager) and has no engine path forward except a new run; English copy has no buy/continue wording. The source scans are a tripwire, not a security boundary.
- `frontend/src/screens/__tests__/BlackjackReplay.test.tsx`: the out-of-chips card offers only Play Again and Home (no buy/continue copy), Play Again goes straight to the table picker, and each table then starts a fresh full-stack run.
- Existing coverage: run outcome recording (#2628) and Play Again after a bust-out in `BlackjackTableScreen.test.tsx`.
- The one table (#3580): a full hand (bet → deal → play → result → Rebet) with no screen swap, Rebet / Change / 2× and their disabling, the result clear of the hands, and the split layout by hand count in `BlackjackTableScreen.oneTable.test.tsx`; the layout helpers in `tableGeometry.test.ts`; the dock's bet rules against `placeBet` in `betRules.test.ts`.

## Manual device checklist (iOS and Android)

Automated tests do not replace device evidence. On each of an iOS and an Android build, with premium access granted, record pass/fail and screenshots:

1. Start Beginner: chips read 100, goal 250; no purchase or "get chips" control appears anywhere (table picker, betting, table, menu, Stats).
2. Lose every chip: the result card shows "Out of Chips" with only Play Again and Home.
3. Tap Play Again: the table picker appears at once with no purchase sheet, paywall or loading gate; pick Beginner and confirm chips are back to 100.
4. Repeat with airplane mode on: replay still starts (offline).
5. Reach the goal, choose Keep Playing, then bust: the result is still a win and Play Again starts a fresh run.
6. New Game mid-run (⋯ menu): confirm dialog, then the table picker; pick a table for a fresh run.
7. Force-quit mid-hand and relaunch: the run resumes with the same chips; after finishing it, a new run still starts free.
8. Read the store listing, paywall and Premium screens: copy sells access to the game only, never chips, extra chances, lives or continues.
9. The table (#3580), on the smallest phone you have and a large one: bet, deal, play and Rebet with no screen change; every card's corner index reads in a 6-card hand, a 6-card dealer hand (use the dev panel's "6-card 21" and "Dealer draws 4 and busts" presets) and 2-, 3- and 4-hand splits ("Pair → 2/3/4 hands"); the result never covers a hand; Rebet and 2× are disabled when the bet is not allowed; VoiceOver / TalkBack read each hand as "Hand n, Player score x, Bet y chips" and reach the dealer, the result, the hands and the dock in that order.

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
- an earned unlock record should be treated as unfinished reward plumbing, not a finished customization feature;
- the unlocks are still earned and stored, but never announced: `UNLOCK_ANNOUNCED` in `unlocks.ts` holds one flag per unlock id (all `false`), and the story that ships a cosmetic flips its flag (#3427). Flipping a flag announces only unlocks earned afterwards; announcing ones already earned needs a seen marker in the stored payload, to be handled by the cosmetic/announcement story in epic #3429.

## Persistence and resume

The full local engine state is saved in AsyncStorage.

A saved in-progress run can resume after relaunch. The shared game-session layer also attempts to resume the server session left open by the killed process.

The engine keeps enough state to preserve whether a run goal had already been reached, including after Keep Playing.

## Server reporting

Backend module: `backend/blackjack/module.py`.

A server game row represents one Blackjack run/session.

Creation metadata is empty. The run aggregates older builds sent (`best_run_chips`, `total_runs`, `runs_completed`, `current_table`) were read by nothing and were dropped (#3140); the backend still accepts them from older clients but strips them before the game row is stored. Run history stays on the device.

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

## Replay recording

Epic #3273, story #3284. A run is recorded so that any round, including split hands and the dealer's play, can be retraced from its stored events. This only **records**: it changes no bet, payout, balance, unlock or entitlement. Priority order is cost, then performance, then data.

Code: `frontend/src/game/blackjack/replay.ts` (the round log and payload builders), `BlackjackGameContext.tsx` (when they run), `backend/blackjack/events.py` (the schema and `validate_event`), `backend/blackjack/replay.py` and `backend/scripts/replay_game.py` (reading a run back). The shared recorder is described in [GAME-CONTRACT §2.10](../GAME-CONTRACT.md#210-recording-gameplay).

### One row per round

Every stored row costs about 200 B of server overhead, so the cost is in the **rows**, not the bytes. A round is therefore **one** replay row, `round_played`, plus one lifecycle row, `hand_resolved`, per hand (usually one): about 2 rows a round, where the first design (one row per bet, deal, action and dealer) was 4.2 replay rows plus the hands.

A **round** is the recorder's unit (`beginUnit(round)` at the bet, `closeUnit()` when the round settles). While it is played the context only appends to a small in-memory `RoundLog` (a few arrays); nothing is serialised, stored or uploaded, and nothing is touched during the card animations. When the last hand settles the log becomes the single `round_played` event, followed by the `hand_resolved` events, and the unit is saved with **one** `enqueueEvents` call at the next idle moment (`requestIdleCallback`), never in the tap handler. If the app goes to the **background** the context calls the recorder's `flush()`, which saves every settled round still waiting for its idle moment **synchronously** (`inactive`, which Control Center or a call banner also cause on iOS, does not flush; `background` always follows when the app really leaves). A round still being played is in the context's log, not yet in the recorder, so neither the idle save nor a background flush covers it and a kill during it loses that round's earlier actions: see the resume paragraph. A split hand that busts settles on its hit while the round goes on; its `hand_resolved` is held in the log until the round is recorded, so it always follows its round's `round_played` and carries the chips after the whole round. Nothing is uploaded mid-run: `SyncWorker` holds the replay-tier events until the run ends, the app is backgrounded, or 5 minutes pass (#3275). `hand_resolved` is a lifecycle event and keeps its usual upload timing.

**Kill switch and session cap.** Both events go through the recorder, so with `isRecordingEnabled("blackjack")` (the #3279 dial) off, **`hand_resolved` is no longer sent either**: the recorder does no work and the run plays on unchanged. `hand_resolved` also counts against the recorder's per-run byte cap (96 KB), so a run past it stops sending its per-hand rows too; the result (`hands_played`, `final_chips`) still travels in `game_ended` and the completion.

The round number is the engine's `round` field, counted when the bet is placed and **saved with the game**. A run resumed after a kill carries on numbering from it, as GAME-CONTRACT §2.10 requires (`beginUnit(n)`): a hand killed mid-round continues as `beginUnit(round)`, and the next bet is `round + 1`. A save from a build before #3284 that was killed mid-round has no `round`; it is loaded as round 1, so the rest of that round and the next bet do not share a number. The recorder cannot know the rounds the killed process saved, so a resumed round's `round_played` has `r: 1` and no `p`: it carries the bet, the dealer's cards and the actions after the resume, and the hands' cards are all in `hand_resolved`. `t_ms` restarts from 0 after a resume. If the app is killed between a round settling and its save reaching the queue, the resumed game can record the same unit again with `r: 1`; the reader treats a repeated unit with `r: 1` as a resume of that round, not a second round.

### Events

Every event also carries the recorder's envelope: `v` (1), `unit` (the round) and `t_ms`. Cards are `"QS"`: rank `A 2-9 T J Q K` (a ten is `T`) and suit `S H D C`. Booleans are omitted when false.

| Event | Tier | Fields |
| --- | --- | --- |
| `round_played` | replay | `b` `[bet, chips before the bet]`; `p` the player's two cards; `d` the dealer's two as `[hole, up]`; `sh` the shoe's size (decks x 52); `rem` the cards left in it after the deal; `a` the actions in order (omitted if none); `dl` the dealer's play (omitted if it did not play); `r: 1` on a resumed round |
| `hand_resolved` | lifecycle | `i` the hand's index at the end; `o` outcome (`blackjack`, `win`, `lose`, `push`); `p` the payout; `ch` the chips after the round; `c` the hand's full cards |

An action is `[code, hand]` plus a third item: `["h", i, "KS"]` a hit and the card it drew, `["d", i, "9S"]` a double, `["s", i]` a stand, `["p", i, [[A, new], [B, new]]]` a split and the two hands it made (they take hand `i`'s place, in table order). `dl` is `{d: [cards drawn], t: final total, b: 1 if it busted}`. The dealer does **not** play when every player hand busted or the round settled on the deal (a natural), and then there is no `dl`; the hole card is still in `d[0]`. `rem` rising above the previous round's means the shoe was reshuffled before this deal. `hand_resolved.i` is the final table order. A `hand_resolved` belongs to the round with the same `unit`, not to the row before it, so the reader (`backend/blackjack/replay.py`) still groups correctly when a `round_played` row is missing (it shows that round with no deal) or when rows were stored in an older order.

A round with a split, a double on the first hand and a dealer bust (the first round of `backend/tests/fixtures/blackjack_replay_v1.json`), 184 B of JSON:

```
round_played   {"b":[10,100],"p":["8S","8H"],"d":["6C","TD"],"sh":312,"rem":124,
                "a":[["p",0,[["8S","3D"],["8H","KC"]]],["d",0,"9S"],["s",1]],
                "dl":{"d":["TS"],"t":26,"b":1}}
hand_resolved  {"i":0,"o":"win","p":20,"ch":130,"c":["8S","3D","9S"]}
hand_resolved  {"i":1,"o":"win","p":10,"ch":130,"c":["8H","KC"]}
```

Every card that was dealt is in one of these, so a round replays without the shoe. (`d` is the dealer's `[hole, up]` in the engine's order: `dealer_hand[0]` is the face-down card. Builds before #3284 called `dealer_hand[0]` the "up card" in `hand_dealt.dealer_up_card`; it was the hole card.)

### Older builds

Builds from before #3284 send one row per step, in the old shapes (no `v`): `bet_placed` `{amount, chips_remaining}`, `hand_dealt` `{player_hand, dealer_up_card, is_player_blackjack}`, `player_action` `{action, hand_index, hand_value_after}`, and a different `hand_resolved` `{hand_index, outcome, payout_delta, chips_after}`. The backend still accepts and stores them as sent (a lenient legacy model per type, in `events.py`), so no older build is rejected. The first three are legacy-only: new builds never send them, so one with a `v` is dropped. `round_played` and `hand_resolved` with a `v` are checked against the strict v1 model (unknown keys, a bad card, an action that does not fit its code, a bust flag that disagrees with the total all drop the event); a `v` the backend does not know is dropped, so deploy the backend before an app that sends a newer one. The three old types stay in the app's registry (the contract test needs the seeded types registered). Migration `0040_blackjack_round_event` seeds `round_played` only (no schema change); deploy it before the app.

### Sizes and caps (cost)

One cap for every Blackjack event: `BLACKJACK_EVENT_MAX_BYTES` = 1024 (`eventQueueConfig.ts`), the same figure as the backend's `MAX_EVENT_BYTES`; a backend test parses the app constant. A hand can hold **21 cards without busting** (aces and twos from a 6-deck shoe) and one more busts it, so every place a hand's cards appear allows 22. The widest legal events, with the widest envelope and numbers: a `round_played` where one hand is hit 20 times against a dealer drawing 22 cards is 517 B (the widest **single-hand** round); a round split to four hands and hit ten times each is about 870 B, still under the cap; a 22-card `hand_resolved` is 206 B. A normal round is 90-190 B. None is chunkable: an oversized event is dropped and reported once per session (never replaced by a stub). A run is held to `BLACKJACK_SESSION_MAX_BYTES` = 96 KB of JSON (about 440 rounds at 220 B), the ceiling for one game: the recorder keeps a clean prefix once it is reached.

Measured by `replay.bench.test.tsx` (300 seeded rounds with a fixed hit, double and split strategy):

| | First design (a row per step) | Now |
| --- | --- | --- |
| Queue saves (one per round) | 300 | 300 |
| AsyncStorage writes | 900 | 900 |
| Rows (events) | 1,551 | 601 (300 `round_played` + 301 `hand_resolved`) |
| JSON | 102 KB (339 B a round) | 66 KB (220 B a round) |
| Replay-tier rows on the server | 4.17 a round | 1.00 a round |

Compared with before the recorder (one `enqueueEvent` per event, 1,339 events, 2,678 storage writes, 14.3 MB written): 300 saves, 900 writes, 6.9 MB.

On the server a round is two rows of ~200 B overhead plus ~220 B of JSON (jsonb text is a little larger): **about 620 B a round**, 186 KB for a 300-round game and about 37 KB for a typical 60-round run. The per-game replay cap (`BLACKJACK_CAP`, 2,000 events / 560 KB, unchanged) counts the `round_played` rows (~360 B each with overhead): about 1,550 fit. `hand_resolved` counts against the lifecycle cap (1,000 rows, 384 KB): a realistic four-card row is ~114 B of jsonb, so 1,000 of them plus the start and end rows are 381 KB (tested).

### Reading a run back

`python scripts/replay_game.py <game_id>` (from `backend/`) prints the game's events and, for Blackjack, **every round rebuilt from them**: the deal (hole card and up card), each action with the card it drew, a split's hands, the dealer's draws and bust, each hand's result and the chips. That section is not cut by `--max-chars`. For the golden run:

```
round 1  bet 10  shoe 124/312
  deal     you 8S 8H | dealer hole 6C up TD
  split    hand 1 -> 8S 3D | 8H KC
  double   hand 1 draws 9S -> 8S 3D 9S = 20
  stand    hand 2 on 18
  dealer   hole 6C draws TS -> 6C TD TS = 26 BUST
  result   hand 1 8S 3D 9S = 20 WIN +20
  result   hand 2 8H KC = 18 WIN +10
  chips    100 -> 130
```

### Tests

- `game/blackjack/__tests__/replay.test.ts`: the round log (bet and deal, hit, double, split, dealer, resumed), the card encoding, byte sizes of the widest legal events against the cap, the cap boundary, the session cap, the kill switch at the recorder.
- `game/blackjack/__tests__/replay.golden.test.tsx`: a scripted, seeded run (split, double, dealer bust, natural, player bust) plus a re-split, split aces (settled by one action) and a reshuffle, through the real context, engine and recorder, rebuilt **from the saved events alone** (every card, every outcome and payout, the chip count); one save per round, saved at idle and not in the handler; the synchronous save on background and none on inactive; unit numbers after a resume, including a pre-#3284 save with no round count; the kill switch. It also keeps `backend/tests/fixtures/blackjack_replay_v1.json` equal to what the recorder emits (`UPDATE_BLACKJACK_FIXTURE=1` rewrites it).
- `game/blackjack/__tests__/replay.bench.test.tsx`: the table above, as budgets.
- `backend/tests/test_blackjack_events.py`: the fixture validates and is stored whole, malformed and oversized events are dropped without leaking values, 22-card hands are accepted and 23 are not, older builds' shapes are accepted, the replay prints every card, the byte cap equals the app's, migration 0040 up and down. `backend/tests/test_replay_caps.py`: the round and lifecycle arithmetic above.

## Stats

A run's score is its closing balance (#2745).

- The board metric is `final_chips` (from the result block), labelled `chips`. Stats "Best" (`best_value`) is the highest `final_chips` over non-abandoned runs. It is read when Stats is requested, so runs stored before #2745 with no `final_score` count too.
- A finished run (`win` or `loss`) also sends its closing chips as `final_score`. The server rejects (400) a non-abandoned completion that sends a `final_score` without an equal `final_chips`, and any `final_chips` that is negative or above 2³¹−1.
- When a completion has no `final_score` (older builds, offline-queued completions, or the unmount / killed-process `win`), the server fills it in from `final_chips` (`BlackjackModule.derive_final_score`). A run killed after reaching its goal keeps its latest result block on the device with the `win` override, so the launch sweep's `win` carries `final_chips` too. `extras.best_chips` and `extras.current_chips` read `final_score`, so they cover runs completed from #2745 on.
- An abandoned run never counts toward Best and stores no `final_score`.

On-device Blackjack run history is separate and continues to use the locally stored run records.

## Premium entitlement

Blackjack opens no server game session while hidden (`isGameVisible("blackjack")` false): the provider is mounted at the app root and the server would answer `403 not_entitled` on every launch (#3328). Game state and saved-run loading are unchanged.

Blackjack is premium and hidden from the v1.0 store build because its simulated gambling mechanics affect store age-rating/product decisions.

When premium access ships, the purchase grants access to **Blackjack as a game**. It does not sell chips, wagers, retries, or run continuation.

Premium entitlement mechanics are shared platform behavior; see [ARCHITECTURE.md §10](../ARCHITECTURE.md#10-premium-entitlements).

## Dev panel (#3576)

A DEV button (bottom-right) on the table screen opens a panel for choosing the
cards the engine deals next, so layout, motion and sound can be checked against rare hands.

- **Gate:** `__DEV__ || isPreLaunchApiBuild()`, read at render. Store builds never show it.
- **Picker:** the shared `components/dev/DevCardPicker.tsx` (rank then suit adds a card; remove,
  move up/down, Clear, preset chips). "Stack next cards" calls `stackDeck` (`game/blackjack/devDeck.ts`),
  which puts the list on the end of the deck so the first card is dealt first. Deal order is
  player, dealer hole card, player, dealer up card, then hits, doubles, splits and dealer draws.
  Stack before Deal, or mid-hand for the next hit and
  dealer cards. If the stack runs out the engine reshuffles as usual. Stacking mid-hand does not
  remove cards already on the table, so duplicates of those cards are possible. Changing the
  table rules (`newGame`) or a low-deck reshuffle in `newHand` discards a stack.
- **Presets:** Pair → 2 hands, Pair → 3 hands, Pair → 4 hands (one, two and three splits; three is
  the engine maximum), 6-card 21, Player natural, Dealer natural, Dealer draws 4 and busts, Push,
  Soft 17 (needs "Hit soft 17" enabled in the table rules for the dealer to draw), Ace pair (dealer
  draws a 10 and busts). Each is covered through the real engine in `devDeck.test.ts`.
- **Never a player action:** stacking goes through the context's `devSetEngine`, not `apply`. It
  does not count a round, emit game events, or write a replay event; the new deck is only saved
  with the game.

## Engine and key files

- Engine: `frontend/src/game/blackjack/engine.ts`
- Screens: [`frontend/src/screens/BlackjackTableScreen.tsx`](../../frontend/src/screens/BlackjackTableScreen.tsx) (the one table; [`BlackjackBettingScreen.tsx`](../../frontend/src/screens/BlackjackBettingScreen.tsx) re-exports it for the entry route) and [`frontend/src/screens/BlackjackVictoryScreen.tsx`](../../frontend/src/screens/BlackjackVictoryScreen.tsx) (its header lists the screen's concerns; see [GAMEPLAY_STANDARDS §8](../GAMEPLAY_STANDARDS.md#8-screen-layer))
- Run/session provider: `frontend/src/game/blackjack/BlackjackGameContext.tsx`
- Table definitions: `frontend/src/game/blackjack/tables.ts`
- Local run history/storage: `frontend/src/game/blackjack/storage.ts`
- Unlock plumbing: `frontend/src/game/blackjack/unlocks.ts`
- Backend module: `backend/blackjack/module.py`
- Replay recording: `frontend/src/game/blackjack/replay.ts`, `backend/blackjack/events.py`, `backend/blackjack/replay.py`

## Open behavior dependencies

- #2788 — release verification of the arcade economy/free replay contract.
- #1911 — incomplete cosmetic reward system.
- #1127 — future Blackjack difficulty design.
- #175 — late surrender.

These should remain separate implementation/product issues. This file describes current behavior and calls out only dependencies that materially change the documented contract.

## Sound

Registry: `frontend/src/game/blackjack/sounds.ts` (`BLACKJACK_SOUNDS`), played through the shared `useSound` hook, which honours the player's sound setting. The effects are being replaced with original synthesized sounds shared across the card and puzzle games (#3563); the reasoning behind each is in the [arcade sound design log](arcade-sound-design.md). Volume is `useSound`'s default (1.0) unless noted.

Triggers are in `frontend/src/screens/BlackjackTableScreen.tsx`.

| Key | File | Plays when | Volume |
| --- | --- | --- | --- |
| `blackjack.cardDeal` | `blackjack-card-deal.ogg` | each dealt card | 1.0 |
| `blackjack.blackjack` | `hearts-moon-shot.mp3` (shared fanfare) | a natural blackjack, with the celebration | 1.0 |
| `blackjack.win` | `blackjack-win.ogg` | a hand won | 1.0 |
| `blackjack.push` | `blackjack-push.ogg` | a push | 1.0 |
| `blackjack.bust` | `blackjack-bust.ogg` | a bust, with the red flash | 1.0 |

The redesign's sounds are made (#3563) and go live with its motion (#3581): the card deal (`card-deal-1/2/3.ogg`, "dealer's toss"), the chips (`chip-bet-1/2/3`, `chip-payout`, `chip-collect`, `chip-nudge`, "felt thud") and the results (`result-win/push/lose/bust/blackjack`, "soft chimes"; a plain loss gets a sound). On a split, one chime plays for the net outcome, then each hand's chips in turn.

The chip milestone and comeback banners have no sound.
