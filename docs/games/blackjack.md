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

- **Top:** a slim HUD strip with the table name, chips / goal and the goal progress bar (the critical-bankroll warning or a win streak shows in the same row). After Keep Playing there is no goal, so the strip keeps the table name and the chip total (labelled "Chips: N") and drops the "/ goal" text and the bar, leaving an empty bar-height gap so the strip, and so the felt, keeps its height (#3617). **New Game** is in the header's ⋯ menu, behind the menu's confirm dialog (it ends the run and returns to the table picker).
- **Felt:** the dealer at the top, the player's hand(s) low near the dock, the middle kept free for the result.
- **Hands:** cards fan left to right so each card's corner index (rank and suit) shows. Each covered card shows 0.34 of its width (never less than 14 px or 0.3 of the width). The card width is the largest that fits the hand, capped per phone at `min(78, 0.2 × screen width)`; the dealer's cards are 0.86 of that. The hole card is a real card back from the shared `PlayingCard` (the active deck's back). The table draws no outline round it (the `holeCardOutline` / `textMuted` outline of #3580 was dropped in #3740): the back holds 3:1 against the felt in both themes by itself (`theme/__tests__/cardBackContrast.test.ts`; see BRANDING.md, The card back). The flip's back face is the same back. The dealer's total reads **?** until the hole card turns, and turns red on a bust.
- **Each hand** has a total pill (accent while it is played, red on a bust, green / red / grey for win / loss / push after the result) and its bet. Split hands already played are dimmed.
- **Splits:** 2 hands are fans side by side, kept low (each covered card shows 0.30 of its width), the active hand outlined. 3–4 hands are rows, one full-width row per hand with the hand number on the left over its total pill and bet (or, after the result, its payout) and the fan (0.42 reveal) on the right; the active row is 1.35× the height of the others (when there is room) and outlined. Every row is tall enough for its label column (`ROW_LABEL_CONTENT_HEIGHT`). With rows, the dealer is drawn as a row too (label on the left). Rows never draw a card narrower than 30 px; the dealer yields to them, and when the result needs the room the dealer's cards give way to its label and total beside the result banner. After any split (2–4 hands) the result banner shows the **net payout alone** ("+25 chips", "No change"; `netOnly` on `ResultBanner`, set by `TableFelt` for every split), at every size and in every locale (owner decisions, #3781 for 3–4 hands, #3784 for 2): each hand's fan, row or cell shows its own tag and payout, and the split summary and the payout do not fit the band together (beside a collapsed dealer at 320×568 the band is 170 px; at 375×667, 329 px still cuts de, es, fr-CA, nl, pt and ru). Its accessibility label still reads the whole result ("You Win!. Won: 2 · Lost: 1 · Push: 1. Payout: 25 chips"). The widest net, pt "Sem mudança", measures 104 px in the web build, inside the 148 px of the narrowest pill. A 2-hand split shows the net alone too, at every size (owner decision, #3784; `netOnly` is set for every split): its summary beside the payout ("Won: 1 · Push: 1 +25 chips", up to 335 px in fr-CA) was wider than the 274 px band at 320×568 in de, es, fr-CA, he, ja, nl, pt and ru (past the felt itself in de, es, fr-CA, nl, pt and ru), its detail line fell below the 52 px band in ja, ko and zh (that banner is 55 px tall there), and a high-stakes line (either hand doubled at the top table, up to 377 px, ru "Победы: 1 · Проигрыши: 1 +200 фишек") was still wider than the band at 375 and 390; each hand's label already shows its own tag and payout (#3779). The net-only banner is at most 139 px wide (pt "Sem mudança") and, with its detail line, 49 px tall (ja, ko, zh), inside every split's band at every phone size; no card changes size. The widths are measured in the web build and pinned in `tableGeometry.test.ts`, which fails when a payout string changes until it is measured again. A single hand keeps the outcome beside the payout. On a felt too short for rows (320×568: the felt is 302×255, `estimateFeltSize`; 4 hands need 268 px for rows, 3 hands fit), 4 hands are a 2×2 grid of fans, each with its label above.
- **Portrait only on phones:** a portrait window always uses single, fans, rows or the grid. The side-by-side arrangement (dealer, result, then each hand) is a best-effort fallback for a landscape window with a short felt; phones are locked to portrait in #3603. Every arrangement budgets height as well as width: nothing lands above the felt and the result never overlaps a hand.
- **Result:** shown on the felt between the dealer and the hands, never over either: the outcome and payout ("You Win! +25 chips") and one line of why ("Dealer busts with 22", "Bust with 24", "18 against the dealer's 20"; "Dealer Blackjack" for a loss to the dealer's natural and "Both Blackjack" for natural against natural, `blackjack:result.dealerBlackjack` and `result.bothBlackjack`, #3741). A plain loss shows the same banner in red. After a split the banner shows the round's net and each hand shows its own payout. A split hand's label at the result (`splitResultLabel` in `layout.ts`, #3771): in a row it is two lines, the hand number and total over the WIN / PUSH / LOSE tag and the payout as a signed number ("+25") (#3782: the total, tag and a 3-digit payout on one line are 116 px in English against the row's 100 px column); on a one-line label (2-hand fans, the 2×2 grid, the wide arrangement) the total, tag and payout take the hand number's place, which never fit beside them on a phone (it was cut to "HA…"). No hand is outlined at the result (only the hand being played is), so each hand is known by its place: its label sits over its own cards, left to right in hand order. Every split hand's payout is a signed number ("+25", "-400", "0"), never in words, at every width (owner decision, #3779: the worded Russian line on a doubled high-roller hand, "-400 фишек", is 196 px, wider than the widest fan label, 195 at 430×932). Every locale's line fits with a 3-digit payout ("-400", a doubled 200 bet) and a soft total ("21*"), measured in the app's fonts and pinned in `tableGeometry.test.ts` (#3782): one line up to 139 px (Russian) against the 320-wide phone's 140 px labels, a row's lines up to 92 and 93 px. Russian's LOSE tag is "Минус" for it ("Проигрыш" made the line 158 px); a translated tag or hand name must be measured again: the test lists the strings it measured and fails when one changes, but the widths are pinned by hand, so a new width needs a new measurement. The label keeps its height, so no card shrinks, and its accessibility label still says it in full: "Hand 1, Player score 21, Bet 25 chips, Win, +25 chips". Known gap: in the wide arrangement (a landscape fallback; phones are locked to portrait, #3603) 3–4 hands get labels of about 96 / 76 px (568×320) and 120 / 94 px (667×375), so the one-line result (105 px in English with a 2-digit payout, 116 with a 3-digit one, up to 139 in other locales) can still be cut there with 3–4 hands at 568×320 and 4 hands at 667×375. The result also shows in the `victory` phase, before the victory screen opens (`showsResult` in `layout.ts`, shared by the felt, the screen and the geometry).
- **Dock** (bottom, one control set at a time, one constant height in every phase so the felt and its cards never resize between betting, play and the result; an engine error shows over the felt's foot, not in the dock). Its height is its content: 48 px chips (the touch target), the gap, the 50 px buttons and the padding (`DOCK_HEIGHT` in `layout.ts`, also used by `estimateFeltSize`). The Table Rules toggle and the Run Stats link share one row at the felt's foot.
  - betting: the chip tray (the table's chips; one all-in chip when the stack is below the table minimum), **Clear** and **Deal**. The table limits, the Table Rules toggle and the Run Stats link sit on the felt below the bet spot. Table Rules opens as a scrollable bottom sheet, so every rule and tooltip is reachable on short screens and the bet spot is never covered.
  - playing: **Hit**, **Stand**, **Double**, **Split**.
  - after the result: the chip tray (a chip starts the next bet with it), **Change** (next hand, pick a new bet), **Rebet** (deal again at the last stake, before any double down) and **2×** (deal again at twice it). Rebet and 2× follow the engine's bet rules (min/max, stack, all-in below the minimum) and are disabled when the engine would refuse the bet; everything is disabled once the chips run out (the Out of Chips card takes over).
- **Rebet / 2×** run `newHand` then `placeBet` as one transition (the context's `applySteps`): each step is counted and recorded as if played by hand, so the round counter, the replay round log and the session record see a new hand and an ordinary bet, but only the final state is rendered and saved (no betting frame in between). It runs from the latest state, so a second tap that lands after the first has dealt does nothing; a step that throws applies nothing.
- **Table picker:** shown while the context's `tablePickPending` is set (first launch, New Game, Cash Out, Play Again) until a table is picked. It is explicit state, never inferred from the chips, so a Keep Playing run whose chips return to the opening stack stays at the table.
- **Bet rules:** the engine exports the legal range `placeBet` enforces (`legalBetRange`); the dock's `betRules.ts` reads it.
- **Layout code:** pure helpers in `frontend/src/game/blackjack/layout.ts` (`computeTableGeometry`, `fitCardWidth`, `fanWidth`, `splitModeFor`, `estimateFeltSize`), memoised in the screen on the felt's measured size (inside its border) and the card counts. `estimateFeltSize` uses the same chrome terms the screen lays out (header, HUD strip, dock, the tab bar and the screen's 8 px gap above it, `TABLE_BOTTOM_GAP`), matching the felt measured in the web build at 320×568 and 375×667 (255 and 354 px inside the border since #3624). The tab bar term is `TAB_BAR_BASE` (60) plus the bottom inset or 8, not react-navigation's tab bar height, which is its own guess because our custom bar does not report one. Unit-tested at 320×568, 375×667, 390×844 and 430×932 in `tableGeometry.test.ts`; `BlackjackTableScreen.layout.test.tsx` renders the screen at 320×568, 375×667 and 390×844 (a 6-card hand at the result, a 2-hand split while playing, a 4-hand split at the result) and checks that every card, label and the result drawn sit on the felt without overlapping. Bet rules for the dock: `frontend/src/game/blackjack/betRules.ts`. Components: `TableFelt`, `FeltCards`, `FeltChips`, `TableDock`, `TableRules` in `frontend/src/components/blackjack/`.
- **Cards keep their view** from the deal to the result: the felt draws every card in one list keyed by the card's id (`CardIds`, `blackjackMotion.ts`), and the hole card is the same view face down and face up. A split's second card keeps its id, so it slides to the new hand. Each card's testID is still its place (`dealer-card-0`, `hand-1-card-2`).
- **Motion and sounds:** see [Motion and sound timing](#motion-and-sound-timing-3581).
- **Routes:** `BlackjackTable` is the screen. `BlackjackBetting` renders the same screen (`BlackjackBettingScreen.tsx` re-exports it) because it is the game's entry route: the lobby, the paywall's return (`entryRouteForSlug`) and the victory screen's Keep Playing / Next Table open it. Nothing navigates between the two any more.

## Motion and sound timing (#3581)

Owner-approved from an animated mockup over the table above (the decisions are in #3575: cards come from just off the felt's top-right, input stays live, the dealer plays at about 600 ms a card). Planner: `frontend/src/components/blackjack/blackjackMotion.ts` (the timings are its constants); screen hook: `useBlackjackMotion.ts`; cards: `FeltCards.tsx`; chips and the pop-ins: `FeltChips.tsx`; sounds: `useBlackjackCues.ts`.

**The engine stays instant.** An action commits the settled round at once (a Stand plays the dealer's whole turn and settles it, the chips included), so the engine, the economy, the replay recording and the run's records are unchanged. The felt then **replays the change from the settled state** as a timeline of stages: each stage says how much of the settled round shows (the cards in each hand, whether the hole card is still down, whether the result, each split hand's own result and the settled chip count show), and the felt draws the settled round cut to it. JS runs once at each stage (a handful per action), never per frame: each card's and chip's motion is one linear Reanimated timing on the UI thread, eased in its worklet.

| Moment                                                                           | Motion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Sound (at)                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A chip from the tray                                                             | slides into the betting circle, 100 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `chip-bet` at its launch                                                                                                                                                                |
| Opening deal                                                                     | player, dealer hole (face down), player, dealer up, launched 180 ms apart; each flies 240 ms from just off the felt's top-right, −18° → 0°, `cubic-bezier(.15,.75,.25,1)`; the hand re-fans (slides over) in 240 ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `card-deal` at each launch (it lands at 240 ms)                                                                                                                                         |
| Hit, Double                                                                      | the same flight for the card; a hit to 21 runs on into the dealer's turn (#3764)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `card-deal` at its launch                                                                                                                                                               |
| Split                                                                            | the pair slides apart (300 ms); at 300 ms a second stake chip slides from the tray to the new hand (160 ms); at ~720 ms **only the hand to play** is dealt its second card. Each other hand shows its one card until it becomes the hand to play: it is outlined, and its second card is dealt ~350 ms later with the normal flight and sound (owner decision, #3720; the engine already holds the card, the felt holds it back). Split aces, played out at once, are each dealt their card in hand order. A 3rd or 4th hand, or the next hand to play, re-lays the rows in 300 ms. The hand being played is outlined; played hands are dimmed                                       | `chip-bet` at 300 ms, `card-deal` at each card                                                                                                                                          |
| Dealer's turn (after Stand, a Double, a bust, a natural, or the last split hand) | starts when the player's last card lands (on a deal that settles at once, a natural or the dealer's natural found by the peek, #3741, as the up card lands, 780 ms): the hole card turns over (320 ms, Y axis 180° → 0°, lifting to 1.08 at the midpoint), each draw ~600 ms after the last, every hand dimmed                                                                                                                                                                                                                                                                                                                                                                       | `card-flip` at the flip's start, `card-deal` at each draw                                                                                                                               |
| Result                                                                           | ~300 ms after the last card lands (or the flip ends; on the player's natural, as the flip ends, with no wait): the banner pops in (260 ms, fade, scale 0.9 → 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | the chime: `result-win`, `result-lose`, `result-bust` or `result-push` (a natural's `result-blackjack` has already played, as its second card landed: [The natural](#the-natural-3621)) |
| Chips                                                                            | ~420 ms after the result: a payout chip slides onto the stake (360 ms), the stake is swept off to the top-right (380 ms), or nudged toward the player and back (300 ms); the chip count and goal bar update when it lands                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `chip-payout`, `chip-collect` or `chip-nudge` at its start                                                                                                                              |
| Split result                                                                     | one chime: the **mixed** chime when at least one hand won and one lost, whatever the net (#3770), else the **net** outcome's (win, lose or push; a push counts as neither), with a **summary strip** under the dealer that shows the net payout alone ("+25 chips", "No change"; owner decisions #3781, #3784), its accessibility label reading the net outcome, the summary ("Won: 1 · Lost: 2", `blackjack:result.splitWon/Lost/Push`, a label and a number, so no plural forms) and the payout; then each hand in turn, 300 ms apart: a **WIN / LOSE / PUSH tag** pops on the hand (`blackjack:tag.*`) with its payout and its chips. The strip never changes as the hands reveal | the chime, then each hand's chip sound                                                                                                                                                  |

- **The flashes** go with the result: the win flash with a win's chime, the bust flash with a bust's (a split hand's own bust at its card's landing). A natural's moment is on the felt ([The natural](#the-natural-3621)); the old "BLACKJACK!" overlay is gone (#3621: its backdrop took touches for ~2 s). The run's milestone and comeback toasts show once the round settles, each with its cue (one a round, [Sound](#sound)); the all-in badge at the deal, with its cue. A mixed split's chime has no flash (#3770). The out-of-chips result and the victory screen wait for the round to settle.
- **The dock follows the felt** (owner decision, #3720). While a result is still playing out (the dealer's turn, a natural, a natural against the dealer's, the dealer's natural found by the peek), the dock shows **Hit and Stand greyed and off**; the result's dock (Rebet, 2×, Change, its chips) replaces them only when the result banner shows. So the dock never tells the result before the felt does.
- **Input stays live.** A tap on the felt mid-motion (its tap target is hidden from TalkBack, the D-pad and tab focus; its children stay reachable) lands everything still moving at once (every card at its place), and so does any action (a Hit during the deal). Sounds still due are dropped.
- **A skip shows how the hand ended** (owner decision, #3720). A tap that cuts short a motion that ends in a result (on the felt, or the result's dock once the banner shows) lands the rest of the dealer's cards, shows the banner with its chime (once: a chime already played is not played again; never a chime without its banner), lands the chips (payout, sweep or nudge) and updates the chip count, then **holds `SKIP_HOLD_MS` (400 ms)** before the action that cut it short runs (Rebet's deal, say). The beat is only for a result not yet shown: once the banner shows, a Rebet lands the chips and the count and deals at once (#3720 round 2). One more action tapped during the beat waits for it; any more are dropped. Leaving (another screen, the background, the ⋯ menu), New Game or unmount during the beat drops the waiting action. A skipped result's flash does not play.
- **Reduce Motion:** nothing moves, but each of the action's sounds still plays once, in its timeline order, **100 ms apart** (`REDUCE_MOTION_SOUND_GAP_MS`, owner decision, #3751; the first at the instant): a natural is deal, sting (100), flip (200), payout (300); a dealer turn is flip, deal, result chime, chips. They are cues like any other: cancelled on leaving, New Game and unmount; a tap on the felt (on while sounds are due) or the next action drops the ones not yet played, but a result chime still due plays once, at once, with no effect, as for a skipped motion (#3720). Nothing replays on restore. The round is settled at once, so the milestone and comeback toasts, the victory screen and the out-of-chips card do **not** wait for the spaced sounds (at most 300 ms of sound after the card shows). Turned on mid-motion, everything lands at once (as for a tap): only the result chime still due plays, at once, and the other sounds still due are dropped, so there is nothing to space.
- **Nothing replays.** Only the player's actions move (the screen marks each with `expect()` before applying it). The game at mount (a restore), resume, a return from another screen, New Game, a new hand's betting and the dev panel are drawn at once, silently, even a restored state that still carries its engine events.
- **Leaving cancels.** The player away (another screen, the app in the background, the ⋯ menu; `usePauseWhileAway`) lands everything at once, silently. New Game and unmount cancel every cue still due.
- **Backstops.** A card's motion that the system cuts short (its timing never ends) is landed by a JS backstop `FLIGHT_BACKSTOP_MS` (250 ms) after its end, as in Solitaire and FreeCell; so are the hole card's turn and the result's pop-in. A chip is removed by its stage, whatever its timing did.
- **Settled** (what the out-of-chips card, the victory screen and the run's toasts wait for) is worked out in render: nothing moving, and the felt drawing the game as it is now. So in the render that applies an action, before the motion has planned it, the round is already not settled, and nothing keyed to it shows (or fires its haptic and announcement) for one frame (#3720 review).
- **Totals and the net banner.** A card counts in its hand's total as it **lands** (240 ms after its launch), not as it is dealt; the dealer's total reads "?" until the hole card's turn has ended, then counts each draw as it lands. A split round's banner shows the **net** from the moment it appears (matching the net chime) and never changes as each hand's tag and chips follow (#3720 review).
- **First frame.** Each card motion (a deal, a slide, the flip) is a view mounted for it with its start pose already set, so the first frame drawn is off the felt, where the card was, or showing its back: a dealt card never shows at its place before it flies in (#3720 review).
- **The stake is a chip** (#3720, as the mockup): each hand's label shows a small chip (the tray's chip face, `ChipFace` in `ChipButton.tsx`, in the table's chip colour; decorative, hidden from screen readers) beside the bet amount, which shrinks to fit the row. The chips moving on the felt use the same face. Chip styles (#3429's "Gold Chip Set" unlock) are not drawn yet, so this is the default face.
- **No layout shift at the result.** While the dealer plays (every hand played, the result still to show) the result's band is already kept free (`tableGeometryForTurn`), so the banner or a split round's summary strip appears without moving a hand (#3720: the 3–4-hand rows jumped 46 px as the strip mounted). The hands re-lay once, sliding, as the dealer's turn starts. On the smallest phone (320×568), where keeping the band would collapse the dealer beside the result, it is not kept: the dealer's draws must show. A split hand's tag fits its label in every locale (#3782); it shrinks only as a backstop for a translation not yet measured.
- **Drawing order.** The felt's cards are one list (dealer, then each hand), so a card being dealt, and the hole card while it turns, are lifted (`zIndex`) above the later hands' cards: a card flying to hand 1 passes over hand 2. Each drops back as it lands or its turn ends, so the hole card never covers the dealer's up card at rest (#3720 round 2). A landing (a tap, Reduce Motion, leaving) also shows a banner or a split tag still popping in. Reduce Motion turned on while a split hand holds its second card back draws it.
- **Off the table (#3656).** The `cards.offTable` check reads the geometry of the stage shown, never a card in flight, so a flight never trips it.
- **Shared code.** The cue clock (`useCueClock`, cancellable by group), `FLIGHT_BACKSTOP_MS` and the bezier easing (`cubicBezier`, `cardMotion.ts`) are the card games' shared stack. Blackjack's flights differ from Solitaire's and FreeCell's (an origin off the felt, the deal's turn, the Y-axis flip, chips, and a whole timeline per action instead of one flight per moved card), so the planner, the card views and the chips are Blackjack's own, on the same patterns.
- **Tests:** `components/blackjack/__tests__/blackjackMotion.test.ts` (each timeline, what the felt draws at a stage, the cards' ids, a seeded fuzz over random rounds with splits and resplits: every timeline ends on the settled round, never hides a card, deals each new card once with one sound, flips before any draw and sounds one result after the last landing); `FeltCards.test.tsx` (the deal, a slide, the flip, landing at once, the backstops, the pop-in); `screens/__tests__/BlackjackTableScreen.motion.test.tsx` (every moment and sound on the fake clock: the deal order, the flip before the draws, the dealer's pace, the result after the last card, the chips and the chip count after the result, a split's order, input mid-motion, Reduce Motion and toggling it mid-flight, no replay on restore, leaving, unmount and New Game); `BlackjackTableScreen.motionFuzz.test.tsx` (random play with taps mid-motion: every card at its place, nothing left moving, no sound more often than it may play).

### The natural (#3621)

Owner decisions in #3739 (direction B, "glint + sweep", chosen from a recorded audition of three; the sting S0). Planned with the rest of the deal (`planMotion`: `NATURAL_*` constants, `naturalEdges`); drawn by `NaturalMoment.tsx` (inside each card's view in `FeltCards.tsx`, and the sweep in `TableFelt.tsx`); colours are tokens (`BLACKJACK_NATURAL_*`, `theme.constants.ts`), per theme (`naturalColors`, `tableColors.ts`). The dark theme keeps the audition's (gold `#f5c542`, silver `#b9c6d6`, a cream sweep); on the light theme's cream felt those fell to 1.48:1 and 1.58:1 and the sweep vanished, so the light theme uses a deeper gold (`#b07a00`, 3.4:1), a slate silver (`#66788e`, 4.1:1) and a brown sweep (`#8a6100`) at the same 0.14 peak. Both edges are at least 3:1 against the felt in both themes (`theme/__tests__/blackjackTable.test.ts`).

- **The banner** reads "Blackjack! 3:2" and is spoken "Blackjack, pays 3 to 2" (`blackjack:outcome.blackjackNaturalLabel`), not "3 colon 2".
- **Only a player's first two cards** (the cards that can be a natural's) get the lift's shared value and animated style; every other card is a plain view (`CardPlace`). A card keeps that for its life: a split moves a hand's second card to the new hand's first place.
- **A natural** is a settled one-hand round's two-card 21, the engine's own test (`isNaturalBlackjack`); the moment's start is the deal's own landing time for the player's second card (`planDeal`), so the two cannot drift.

| Case                                                             | From the deal's tap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Sound                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **The player's natural** (3:2)                                   | At **600 ms**, as the second card lands: the two cards **lift 7 px** (up 160 ms ease-out, hold 520 ms, down 240 ms) and get a **2 px gold edge with an 8 px glow** (fading in over 120 ms; it stays until the next deal); a **sheen band** crosses each card once (380 ms, from +60 ms); one **diagonal light sweep** (18°) crosses the felt (560 ms, from +60 ms, peak opacity ~0.14). The hole card turns at 780 ms and the result shows **as the turn ends (1100 ms)**, with no +300 ms: the banner reads **"Blackjack! 3:2"** (`blackjack:outcome.blackjackNatural`). The payout chip (1520 ms) is **1.4× size with a gold rim**. The moment is over by ~1.5 s (the lift's end) | `result-blackjack` **at 600 ms**, with the card; it is the round's chime, so none plays at the result |
| **The dealer's natural** that beat the player (who had not bust) | found by the peek (#3741), it ends the hand at the deal: the hole card turns as the up card lands (780 ms), a **static cool-silver edge** on the dealer's two cards as the turn ends (1100 ms), then the normal loss, "You Lose" with the detail "Dealer Blackjack" (1400 ms; the stake swept at 1820 ms). The silver edge shows because the dealer's natural decided the round (#3739)                                                                                                                                                                                                                                                                                             | the normal `result-lose`; no new sound                                                                |
| **Natural against natural**                                      | at 600 ms the player's cards get **only the gold edge** (no lift, glint, sweep or sting); the dealer's get the silver edge as the hole card's turn ends (1100 ms), and the Push banner shows then, with the detail "Both Blackjack"                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `result-push`, then the nudge                                                                         |

- **Once per natural, only from the deal.** Only a deal that makes a one-hand natural plans the moment (`Timeline.momentAt`) and the sting. A split hand's ace and ten are 21, not a natural (it pays 1:1): no edge, no moment, no sting. With the peek (#3741) a dealer natural always settles at the deal, so it always decides the round and is always marked (a save from before #3741 that was mid-hand against one is settled on load with its two dealt cards, so it too is marked). `naturalEdges` still leaves a dealer natural unmarked against a bust, a case no round reaches now.
- **The sting is the result's chime** (`Timeline.chimeAt`, not matched by name): it plays exactly once. A tap before 600 ms lands the moment and plays it then, once (with the result and its 400 ms beat, as for any result cut short); a tap after it does not play it again.
- **A tap completes it.** Any tap or action lands the moment at once to the static gold edge (no lift, sheen or sweep), as it lands the cards. **Input is never locked**: every part of it is `pointerEvents="none"` and hidden from screen readers (the banner says it), and a Rebet during it deals at once.
- **Reduce Motion:** no lift, glint or sweep: the static gold edge, the banner and the chips show at once and the sting plays once, 100 ms after the deal's sound (#3751). Turned on mid-moment, it lands to the static edge.
- **No replay.** A restored natural (relaunch, resume) shows only the static edges, with no motion or sound. The player away lands it silently (a sting still due never plays); New Game and unmount cancel it.
- **First frame.** The moment is timed from when it started (a JS-clock time handed to the views), not from when a view mounts: the edge mounts at opacity 0 and the cards at rest, and a view mounted mid-moment picks it up where it is. It runs on the UI thread (one linear timing, each part worked out in a worklet), with a JS backstop like the cards'.
- **Tests:** `blackjackMotion.test.ts` ("the natural": each case's cues and edges, a split natural not counting; the fuzz checks the sting only on a 3:2 deal, once, at 600 ms, edges never un-marked, none on a split round, the larger chip only with the sting); `NaturalMoment.test.tsx` (the timings, the first frame, the edges, the sweep's peak, the banner and its spoken label in every locale, the light theme's colours, and the lift, with `withTiming` held at its start so a lift that never shows or never comes down fails); the edges' and sweep's contrast in `theme/__tests__/blackjackTable.test.ts`; `screens/__tests__/BlackjackTableScreen.natural.test.tsx` (on the screen: each case on the fake clock, a tap before and after the sting, Rebet during the moment, Reduce Motion before and mid-moment, restore, away, New Game, unmount, the edge until the next deal); the screen fuzz checks no moment is left running and the edges match the settled round.

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
10. Motion and sound (#3581), with sound on, on a mid-tier Android phone and an iPhone: deal a few hands and watch for dropped frames. Cards come from just off the felt's top-right, turned, and land square, each deal sound landing with its card; the hole card turns before the dealer draws, the dealer's cards come about 600 ms apart, the banner pops in after the last card and the chips after it, and the chip count changes only when the chips land. Split to 2, 3 and 4 hands (dev panel presets): the pair slides apart, a second chip follows, one chime then each hand's chips 300 ms apart. Tap Hit during the opening deal and Rebet during the dealer's turn: each lands at once and the tap acts. With Reduce Motion on, nothing moves and an action's sounds play in order, 100 ms apart (a natural's deal, sting, flip, payout; a dealer turn's flip, deal, chime, chips), none stacked. Leave the screen (Stats, the ⋯ menu, the home button) mid-motion: nothing plays while away, and coming back replays nothing; nor does force-quitting and relaunching. On Android, check that a card in flight draws above the other hands and the labels.
11. The natural (#3621), in both themes, with sound on (dev panel: "Player natural", "Dealer natural"): the sting lands with the second card; the two cards lift and settle, the gold edge's glow shows (iOS and Android both draw the `boxShadow`), a sheen crosses each card once and one faint diagonal sweep crosses the felt; the banner reads "Blackjack! 3:2" at the hole card's turn and the payout chip is larger with a gold rim. Tap Rebet as the banner shows: it deals at once. The gold edge stays until the next deal. "Dealer natural": the hand ends at the deal (the peek, #3741): Hit and Stand stay greyed, the hole card turns as the up card lands, a silver edge shows on the dealer's two cards as it turns, then "You Lose" and only the bet is swept; with Reduce Motion on, only the static edge.
12. 21 stands on its own (#3764), with sound on, and again with Reduce Motion on: on a single hand, hit to exactly 21 (e.g. 7 4, then a ten; or a soft hand such as A 5 then a 5): the card lands, then the hole card turns, the dealer draws and the result shows with no tap, the dock's actions (Hit, Stand, Double, Split) greyed throughout and never enabled while the hand shows 21. Split a pair and hit the first hand to 21: play moves to the second hand at once (its second card is dealt as it is outlined). Split tens and get an Ace on a hand: that hand is passed over at once, and the dock stays greyed until the next hand is outlined. Split any pair and Double (or hit to a bust) on the first hand: the dock is greyed for the ~240 ms until that card lands and the next hand is outlined, then live. With Reduce Motion on the result is instant and the sounds play in order, 100 ms apart. Record a short gameplay video of a single-hand hit to 21 and a split hand reaching 21 for the owner.

## Objective and card values

The player competes against the dealer. Build a hand as close to 21 as possible without going over, and beat the dealer's resolved total.

- 2–10: face value.
- Jack / Queen / King: 10.
- Ace: 11 when possible, otherwise 1 as needed to avoid busting.

A natural Blackjack is a two-card 21. A split hand's ace and ten make 21, not a natural (it pays 1:1).

## Standard rules: the peek, and a natural beats 21 (#3741)

Owner decision on #3741 (option B, standard rules; insurance out of scope):

- **The dealer peeks.** When the dealer's up card (`dealer_hand[1]`) is an Ace or a ten-value card, the dealer checks for a natural before the player acts (`placeBet`, `dealerPeeks`). Every dealer natural shows one of these, so every one is found at the deal.
- **A dealer natural ends the hand at once.** The round settles in `placeBet`, from `betting` straight to `result` (or `victory`): the player loses only the original bet, since no double or split could be taken. Natural against natural is a push. Events: `cardDeal` ×2 and `loss` (or `push`).
- **A natural beats any 21 that is not one** (`compareHands`). A player's 3-card 21 (or a split hand's 21) loses to the dealer's natural; before #3741 it pushed (`pv === dv`). A player's natural settles at the deal and wins 3:2, so it beats a dealer who would have made 21 in three cards. With the peek, the player never acts against a dealer natural; the rule is kept as a guard.
- **A save from before the peek** (a game saved mid-hand by an older build against a dealer natural) is settled on load as the peek would have settled it (`settleUnpeekedDealerNatural`, in the game context's load path, `BlackjackGameContext.tsx`): the hand goes back to its two dealt cards (`player_hand`, which a split never changes), with no split or double, and loses the original bet only (the push for a player natural is a guard: older builds settled that at the deal too). The round is then played out as one just dealt: the session the killed process left open resumes, the hand is counted (session stats, `hand_resolved`) and the round recorded as a peeked natural (its deal, no actions, no dealer play), and an all-in loss ends the run as a loss, saves it to Stats and clears the save. The settled game is saved, so a relaunch does not settle it again. A save from before #3284 (no round count) is round 1. Every other save loads unchanged.
- **No insurance.** Not offered; a later option if wanted.
- The rules sheet (`TableRules`) states these under **Standard rules** (`blackjack:rules.standardTitle`, `blackjack:rules.standard`).

Expected value per hand (a paired simulation of the old and new engines, 3,000,000 hands, 6 decks, S17, basic strategy with doubles and splits, no surrender, bet 100 so the 3:2 rounding does not matter): **−0.34%** of the bet under the old rules, **−0.50% ± 0.07%** under the standard rules; the change on the same deals is **−0.158% ± 0.004%**. The peek helps the player (no doubled or split money lost to a dealer natural), but losing the pushes a 3-card 21 used to get against a dealer natural costs more. Hands whose result changes: ~0.56%. Goal rates per table (12,000 runs each, flat bets) moved by −1.2 to −1.7 points at the minimum bet and within the noise (±0.6) at the maximum; the economy constants (tables, goals, milestones) are unchanged.

## Dealer rules

Default table rules use:

- 6 decks;
- dealer stands on soft 17 (`hit_soft_17 = false`);
- configured deck penetration of 0.75;
- automatic reshuffle when the remaining engine deck is low, and a reshuffle when the shoe runs dry mid-round (every in-round draw goes through `dealFrom(state)` in `engine.ts`, so the new shoe is always the table's `deck_count` decks, never one, #3769).

The engine supports a rules object, but player-facing difficulty variants are separate future work and should not be inferred from the current table tiers.

## Player actions

### Hit

Take another card.

### Stand

End action for the current hand and allow dealer/settlement logic to continue.

### 21 stands on its own (#3764)

Owner decision on #3764: a hand that reaches 21 stands automatically, as most blackjack games do (any further card busts it). The dock's actions (Hit, Stand, Double, Split) are never offered on a hand showing 21.

- **A single hand hit to 21** goes straight on to the dealer's turn and settles, exactly as a Stand would (`hit` calls `stand`). Hard 21 and soft 21 alike. Events: `cardDeal`, then the Stand's (the outcome, any milestone or comeback).
- **A split hand hit to 21** is done, and play moves to the next hand; after the last hand the dealer plays (`advanceHand`).
- **A split hand dealt 21** (a split ten that draws an Ace, say) is passed over at once: by the split itself when it is the hand to play, or when play reaches it (`passTwentyOnes`, in `advanceHand` and at the end of `split`). If every hand is done, the dealer plays and the round settles from the split, with its outcome event.
- **Split settlement events:** every action that settles a split round (a Stand, a hit that busts or reaches 21, a Double, a split that deals 21s, split aces) emits the same events through one path (`splitRoundEvents`): the action's own (`cardDeal`, `bust`), then the outcome, and any milestone or comeback, in `result` and `victory` alike. Before #3764 a Stand or Double reaching victory, a bust ending the round, and split aces left the outcome out (split aces emitted nothing). Nothing on the screen plays the outcome event (the result's sound is the motion's; stats and `hand_resolved` come from the settled hands), so this changes no sound or count. A single hand that busts still emits `cardDeal` and `bust` with no outcome event: nothing reads one, so it was left as it is.
- **Unchanged:** split aces still take one card each and cannot hit (they are passed at the split; no stand is recorded for them). A double that reaches 21 already settled; a two-card natural already settles at the deal (#3741).
- **Replay:** the automatic stand is recorded as `["s", i]`, the entry a tapped Stand makes, right after the action that reached 21 (`autoStands` in `replay.ts`). So the replay reads "stand hand N on 21" and needs no new field; the server checks shape only and never plays a round again, so no rules version either. A round of 20 hits and the stand on 21 is 525 B, under the cap.
- **A save from before #3764** made mid-hand with the hand to play on 21 (it then waited for a Stand) **finishes on load**: `standOnTwentyOne`, in the game context's load path after `settleUnpeekedDealerNatural`. The session the killed process left open resumes, the stand is recorded as the resumed round's action (`["s", i]`, `r: 1`), and a single hand settles there (counted, recorded with the dealer's play, saved settled so a relaunch does not stand it again); a split hand moves play on to the next hand. Every other save loads unchanged.
- **Motion:** a hit to 21 plays as one timeline, as a Double does: the card lands, then the dealer's turn (the flip, the draws, the result, the chips), with no tap between and the dock's actions greyed. A split hand passed over on 21 that still holds its second card back is outlined and dealt it in turn (`moveOn`): on the way to the next hand, or before the dealer's turn when play ends there, so no card is skipped and none is dealt with an earlier hand outlined. When play ends at a hand that takes a card (a Hit or a Double) with such a hand after it, the card lands (a bust sounds `result-bust` as it lands, as on any split hand that busts with play going on), the outline moves to the held hand, its card is dealt ~350 ms later, and the flip follows its landing. A split that deals the hand to play 21 moves the outline to the next hand as the 21 lands (at 960 ms); that hand's card follows on its own turn, ~350 ms later (owner recording, case 5). Under Reduce Motion it is instant and the sounds play in order, each once, 100 ms apart (#3751).
- **The dock while play moves on** (#3764 review): the dock's actions (Hit, Stand, Double, Split) are greyed whenever the felt outlines a hand other than the one the engine plays (`actionsOff`, `BlackjackTableScreen.tsx`). A hand that stands on its own on 21 moves the engine on at once, while the felt still outlines it, or a hand passed over on the way, until its cards land; a tap then would act on a hand the player has not seen outlined. So after a split that deals the hand to play 21 the dock is greyed until the outline reaches the next hand (960 ms), after a Stand that passes a held hand dealt 21 until that hand's card lands (590 ms), and and after any split-hand action that moves play on as its card lands — a hit to 21, a hit that busts, or a Double — until that card lands (240 ms). The last case is not about 21: a Double or a bust on a split hand moves the engine on too, so since #3764 the dock is greyed for those 240 ms where before a tap landed the motion and acted on the next hand (#3575). A Stand onto an ordinary next hand outlines it at once, so it is never greyed by this, nor is anything under Reduce Motion (the felt shows the settled state). A hand outlined with its held card still to come (#3720) is the engine's hand, so the dock is live, as on every split.
- **Tests:** `engine.autoStand.test.ts` (hard and soft 21, a split hand hit to 21, a split hand dealt 21, the last hand to the dealer, split aces, old saves), `replay.test.ts` and `backend/tests/test_blackjack_events.py` (the stand's entry, a split hand dealt 21, a resumed round), `BlackjackGameContext.autoStand.test.tsx` (the load path and its recording), `blackjackMotion.test.ts` (the timeline; the fuzz checks no hand to play ever shows 21), `BlackjackTableScreen.autoStand.test.tsx` (the screen on the fake clock, the dock sampled every 10 ms on all four actions: no tap, no action enabled on a hand showing 21, `actionsOff` greying the dock while the felt outlines another hand — case 5 and a re-split Stand passing a held 21, where a Hit tapped in that window does not act — and Reduce Motion).

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

A dealer natural (found by the peek) settles at the deal for the original bet: **Loss**, or **Push** against the player's natural. A natural beats any other 21 ([Standard rules](#standard-rules-the-peek-and-a-natural-beats-21-3741)).

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

A saved in-progress run can resume after relaunch (a save from before #3741 that was mid-hand against a dealer natural is settled on load: [Standard rules](#standard-rules-the-peek-and-a-natural-beats-21-3741); one from before #3764 with the hand to play on 21 is stood on load: [21 stands on its own](#21-stands-on-its-own-3764)). The shared game-session layer also attempts to resume the server session left open by the killed process.

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

| Event           | Tier      | Fields                                                                                                                                                                                                                                                                                                        |
| --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `round_played`  | replay    | `b` `[bet, chips before the bet]`; `p` the player's two cards; `d` the dealer's two as `[hole, up]`; `sh` the shoe's size (decks x 52); `rem` the cards left in it after the deal; `a` the actions in order (omitted if none); `dl` the dealer's play (omitted if it did not play); `r: 1` on a resumed round |
| `hand_resolved` | lifecycle | `i` the hand's index at the end; `o` outcome (`blackjack`, `win`, `lose`, `push`); `p` the payout; `ch` the chips after the round; `c` the hand's full cards                                                                                                                                                  |

An action is `[code, hand]` plus a third item: `["h", i, "KS"]` a hit and the card it drew, `["d", i, "9S"]` a double, `["s", i]` a stand (also the automatic stand of a hand that reached 21, right after the action that reached it, #3764), `["p", i, [[A, new], [B, new]]]` a split and the two hands it made (they take hand `i`'s place, in table order). `dl` is `{d: [cards drawn], t: final total, b: 1 if it busted}`. The dealer does **not** play when every player hand busted or the round settled on the deal (a natural), and then there is no `dl`; the hole card is still in `d[0]`. `rem` rising above the previous round's means the shoe was reshuffled before this deal. `hand_resolved.i` is the final table order. A `hand_resolved` belongs to the round with the same `unit`, not to the row before it, so the reader (`backend/blackjack/replay.py`) still groups correctly when a `round_played` row is missing (it shows that round with no deal) or when rows were stored in an older order.

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

One cap for every Blackjack event: `BLACKJACK_EVENT_MAX_BYTES` = 1024 (`eventQueueConfig.ts`), the same figure as the backend's `MAX_EVENT_BYTES`; a backend test parses the app constant. A hand can hold **21 cards without busting** (aces and twos from a 6-deck shoe) and one more busts it, so every place a hand's cards appear allows 22. The widest legal events, with the widest envelope and numbers: a `round_played` where one hand is hit 20 times against a dealer drawing 22 cards is 517 B (the widest **single-hand** round; 525 B with the stand a hit to 21 adds, #3764); a round split to four hands and hit ten times each is about 870 B, still under the cap; a 22-card `hand_resolved` is 206 B. A normal round is 90-190 B. None is chunkable: an oversized event is dropped and reported once per session (never replaced by a stub). A run is held to `BLACKJACK_SESSION_MAX_BYTES` = 96 KB of JSON (about 440 rounds at 220 B), the ceiling for one game: the recorder keeps a clean prefix once it is reached.

Measured by `replay.bench.test.tsx` (300 seeded rounds with a fixed hit, double and split strategy):

|                                | First design (a row per step) | Now                                            |
| ------------------------------ | ----------------------------- | ---------------------------------------------- |
| Queue saves (one per round)    | 300                           | 300                                            |
| AsyncStorage writes            | 900                           | 900                                            |
| Rows (events)                  | 1,551                         | 601 (300 `round_played` + 301 `hand_resolved`) |
| JSON                           | 102 KB (339 B a round)        | 66 KB (220 B a round)                          |
| Replay-tier rows on the server | 4.17 a round                  | 1.00 a round                                   |

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

### Rules changes and old records (#3741)

The server never works an outcome out again: `events.py` checks each event's shape and stores it as sent, and `replay.py` prints the outcome the app recorded. So the standard rules (the peek, a natural over any 21) needed no change to the event schema and no rules version in the events, and rounds recorded before #3741 still validate and read exactly as they were played: a 3-card 21 that pushed a dealer natural then still shows `PUSH`. A round from after it is told apart by its shape: a dealer natural ends it at the deal, so its `round_played` has no `a` and no `dl`. The reader then prints the dealer's natural on its own line:

```
round 1  bet 10  shoe 308/312
  deal     you TS 8H | dealer hole KC up AD
  dealer   hole KC -> KC AD = 21 BLACKJACK
  result   hand 1 TS 8H = 18 LOSE -10
  chips    100 -> 90
```

(A build before #3741 also wrote such a round for natural against natural, a push at the deal under either rules; the line reads true for both.) If the server ever re-simulates rounds, it must apply the rules of the build that recorded them (before #3741: no peek, and equal totals a push). Nothing in a stored round names its rules, and old builds keep playing after a release, so that work would first add a rules version to `round_played` (a new `v`, backend first: docs/GAME-CONTRACT.md "Adding an event type").

### Tests

- `game/blackjack/__tests__/replay.test.ts`: the round log (bet and deal, hit, double, split, dealer, resumed, a dealer natural found by the peek), the card encoding, byte sizes of the widest legal events against the cap, the cap boundary, the session cap, the kill switch at the recorder.
- `game/blackjack/__tests__/replay.golden.test.tsx`: a scripted, seeded run (split, double, dealer bust, natural, player bust) plus a re-split, split aces (settled by one action) and a reshuffle, through the real context, engine and recorder, rebuilt **from the saved events alone** (every card, every outcome and payout, the chip count); one save per round, saved at idle and not in the handler; the synchronous save on background and none on inactive; unit numbers after a resume, including a pre-#3284 save with no round count; the kill switch. It also keeps `backend/tests/fixtures/blackjack_replay_v1.json` equal to what the recorder emits (`UPDATE_BLACKJACK_FIXTURE=1` rewrites it).
- `game/blackjack/__tests__/replay.bench.test.tsx`: the table above, as budgets.
- `backend/tests/test_blackjack_events.py`: the fixture validates and is stored whole, malformed and oversized events are dropped without leaking values, 22-card hands are accepted and 23 are not, older builds' shapes are accepted, the replay prints every card, rounds under the rules before and after #3741 validate and replay as recorded (a peeked dealer natural reads "dealer hole KC -> KC AD = 21 BLACKJACK"), the byte cap equals the app's, migration 0040 up and down. `backend/tests/test_replay_caps.py`: the round and lifecycle arithmetic above.

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

> **Reduce Motion (#3751):** the sounds below play in the same order but 100 ms apart, the first at the instant, instead of at their motion times; each distinct sound once per action.

Registry: `frontend/src/game/blackjack/sounds.ts` (`BLACKJACK_SOUNDS`), played through the shared `useSound` hook (three variations through `useSoundVariants`, never the same one twice in a row), which honours the player's sound setting. Every file is an original synthesized sound shared across the card games (#3563); the reasoning behind each is in the [arcade sound design log](arcade-sound-design.md). Volume is `useSound`'s default (1.0).

Each plays at its moment of the motion ([Motion and sound timing](#motion-and-sound-timing-3581); `useBlackjackCues.ts`), wired in #3581.

| Key                           | File                                         | Plays when                                                                                                               |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `blackjack.cardDeal` (+2, +3) | `card-deal-1/2/3.ogg` ("dealer's toss")      | a card is launched (it lands at 240 ms)                                                                                  |
| `blackjack.cardFlip` (+2, +3) | `card-flip-1/2/3.ogg` (the shared card flip) | the hole card starts to turn                                                                                             |
| `blackjack.chipBet` (+2, +3)  | `chip-bet-1/2/3.ogg` ("felt thud")           | a chip leaves the tray for the circle, or a split's second stake                                                         |
| `blackjack.win`               | `result-win.ogg`                             | a win, with the banner and the green flash (a split round: its net, unless mixed)                                        |
| `blackjack.lose`              | `result-lose.ogg`                            | a plain loss, with the banner (a split round: its net, unless mixed)                                                     |
| `blackjack.bust`              | `result-bust.ogg`                            | a bust, with the banner and the red flash (a split hand's own bust: as its card lands)                                   |
| `blackjack.push`              | `result-push.ogg`                            | a push, with the banner (a split round: every hand pushed)                                                               |
| `blackjack.mixed`             | `result-mixed.ogg` ("up and back", 0.77 s)   | a split round with at least one winning and one losing hand, whatever the net, with the banner; no flash (#3770)         |
| `blackjack.blackjack`         | `result-blackjack.ogg` (1.08 s)              | the player's natural (3:2), as its second card lands, with the gold edge and the lift; it is the round's chime (#3621)   |
| `blackjack.chipPayout`        | `chip-payout.ogg`                            | ~420 ms after a win's chime, the payout chip's slide (each winning split hand in turn)                                   |
| `blackjack.chipCollect`       | `chip-collect.ogg`                           | ~420 ms after a loss's chime, the stake swept (each losing split hand in turn)                                           |
| `blackjack.chipNudge`         | `chip-nudge.ogg`                             | ~420 ms after a push's chime, the stake's nudge (each push hand in turn)                                                 |
| `blackjack.milestone`         | `run-milestone.ogg` ("tick up", 0.32 s)      | a milestone crossed, with its toast once the round's chips have landed; one cue a round (#3582)                          |
| `blackjack.comeback`          | `run-comeback.ogg` ("turnaround", 1.05 s)    | a comeback, with its banner once the round's chips have landed; takes the place of a milestone in the same round (#3582) |
| `blackjack.allIn`             | `bet-all-in.ogg` ("held breath", 0.70 s)     | the whole stack bet: at the deal, with the first card, under the tosses (#3582)                                          |

The old `blackjack-card-deal.ogg`, `blackjack-win.ogg`, `blackjack-push.ogg` and `blackjack-bust.ogg` were deleted with #3581, and Blackjack no longer plays `hearts-moon-shot.mp3` (other games still do, until #3578).

**The run's cues and the all-in (#3582, owner decisions after the audition of 2026-11-13).** The milestone and comeback cues play with their toast: as the round settles, after every hand's chips (~0.8 s after the chime on one hand, ~1.4 s on a 3-hand split), never at a fixed offset (`useBlackjackMotion`, handed in with the toast: `whenSettled(toast, { cue })`). **One cue a round:** a comeback over a milestone, and two milestones crossed together give one tick. Under Reduce Motion the cue joins the spaced sounds, 100 ms after the last chip sound (the toast shows at once). **A round cut short drops its cue** (a tap on the felt, Rebet or any next action, leaving, New Game, Reduce Motion turned on mid-motion): a tap before the result plays the chime at once and the next action runs 400 ms later, and a Rebet once the banner shows deals at once, so the cue's slot after the chips is gone, and played then it would sit on the chime or on the next deal; the toast still shows. **The round that wins the run plays none** (its engine phase reaches `victory`, with or without Reduce Motion; owner decision): `BlackjackTableScreen` replaces the table with the victory screen as the motion settles, which would cut the cue off, so neither a milestone nor a comeback cue is played, though the toast still shows. A restored round plays none. The all-in cue is on the deal's timeline at 0, so the cue clock owns it (under Reduce Motion, spaced after the deal's sound). The reasoning is in the [design log](arcade-sound-design.md#blackjack-a-mixed-split-the-runs-cues-and-the-all-in-3770-3582).
