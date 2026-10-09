# BC Arcade — Gameplay Standards

This document defines how every interactive game in BC Arcade must be structured. It covers the five architectural layers, per-layer conventions, the shared drag-and-drop system, and the screen that composes them. It is a companion to [`ARCHITECTURE.md`](ARCHITECTURE.md) (server/client split) and [`GAME-CONTRACT.md`](GAME-CONTRACT.md) (backend protocol and new-game checklist).

---

## Table of Contents

1. [The Five-Layer Model](#1-the-five-layer-model)
2. [Layer 1 — Game Logic](#2-layer-1--game-logic)
3. [Layer 2 — Board Layout](#3-layer-2--board-layout)
4. [Layer 3 — Gesture / Input](#4-layer-3--gesture--input)
5. [Layer 4 — Animation](#5-layer-4--animation)
6. [Layer 5 — Rendering](#6-layer-5--rendering)
7. [Shared Drag System](#7-shared-drag-system)
8. [Screen Layer](#8-screen-layer)
9. [New-Game Gameplay Checklist](#9-new-game-gameplay-checklist)

---

## 1. The Five-Layer Model

Every game in BC Arcade is built from five discrete layers. **Layers must not reach into each other in the wrong direction.** The common failure mode is blending Logic with Animation or Layout with Rendering — this is what causes "every fix breaks something else."

```
┌──────────────────────────────┐
│  Layer 1 · Game Logic        │  Pure TS/engine.ts — no React, no animation
├──────────────────────────────┤
│  Layer 2 · Board Layout      │  Responsive calculation — no hardcoded px
├──────────────────────────────┤
│  Layer 3 · Gesture / Input   │  RNGH or tap — never state per frame
├──────────────────────────────┤
│  Layer 4 · Animation         │  Reanimated shared values, worklets
├──────────────────────────────┤
│  Layer 5 · Rendering         │  React Native views or Skia canvas
└──────────────────────────────┘
```

The flow is **top-down**: Logic feeds Layout, Gesture triggers Logic or Animation, Animation drives Rendering. Never call up the stack (Rendering should not mutate game state; Animation should not read React state per frame).

---

## 2. Layer 1 — Game Logic

### Rule

The rule engine lives in `frontend/src/game/<name>/engine.ts` and is fully headless — no React, no AsyncStorage, no animation, no platform imports. It is pure apart from module-level singletons: eight engines keep an RNG slot (`setRng`) or an id counter (Twenty48's `_nextTileId`, Star Swarm's seed and ids) outside their game state. Those follow the determinism rules in [`ARCHITECTURE.md §3.2`](ARCHITECTURE.md#32-determinism-rng-and-counters-2985-2999): the engine replays from `(seed, inputs)`, a restored game restores its counters, tests reseed, and `Math.random` is for cosmetics only. See [`ARCHITECTURE.md §3`](ARCHITECTURE.md#3-the-rule-engine--written-once). All React UI for a game lives in `frontend/src/components/<name>/` and `screens/`, never in `game/<name>/` (see [§3.1](ARCHITECTURE.md#31-where-game-code-lives)).

### Conventions

- Export pure functions: `validateMove(state, move) → boolean`, `applyMove(state, move) → GameState`.
- Randomness that affects play goes through the engine's seed or `setRng` slot (`_shared/seededRng`), never `Math.random` directly. An id counter kept at module level gets a reseed function that the storage module's load calls.
- Never call `setState`, `useSharedValue`, or any animation API from inside the engine.
- Side effects (audio, haptics, score submission) happen one layer up in the screen or a hook that consumes the engine.
- Game state is persisted to AsyncStorage **after** the engine returns a new state — never inside the engine.

### Reference implementations

| Game        | Engine                                  | Notes                                                    |
| ----------- | --------------------------------------- | -------------------------------------------------------- |
| Solitaire   | `frontend/src/game/solitaire/engine.ts` | `validateMove` + `applyMove` pure functions              |
| FreeCell    | `frontend/src/game/freecell/engine.ts`  | Same pattern; auto-move candidates computed separately   |
| Mahjong     | `frontend/src/game/mahjong/engine.ts`   | Tile matching, shuffle, deadlock detection all headless  |
| Bottle Sort | `frontend/src/game/sort/engine.ts`      | `validatePour` + `applyPour` pure; no animation coupling |

---

## 3. Layer 2 — Board Layout

### Rule

**No hardcoded pixel sizes in pile or tile components.** Every game must have a layout calculation function that derives all dimensions from screen size, safe area insets, and board geometry. Compute once at the screen level; pass results down via context or props.

### Pattern

```ts
// frontend/src/game/<name>/layout.ts
interface <Name>LayoutInput {
  screenWidth: number;
  screenHeight: number;
  safeAreaTop: number;
  safeAreaBottom: number;
  // game-specific geometry (rows, cols, pile count, etc.)
}

interface <Name>Layout {
  // all dimensions this game needs — no constants in child components
}

function calculate<Name>Layout(input: <Name>LayoutInput): <Name>Layout { ... }
```

### Conventions

- Call `useWindowDimensions()` + `useSafeAreaInsets()` at the screen level; pass the result into the layout function.
- Clamp all sizes to a readable minimum. For cards: `cardWidth ≥ 36px` (`MIN_CARD_W` in `CardSizeContext.tsx`). For tiles: `tileWidth ≥ 28px`.
- The visible stripe of a covered face-up card never drops below 24px (Solitaire's `MIN_FACE_UP_STRIPE`), so its rank and suit stay readable and tappable. FreeCell instead compresses a tall column to fit the screen (`computeCardOffset`, 12px floor at natural size).
- If the board overflows the screen even at the minimum size, wrap in a `ScrollView` rather than squishing further.
- Offsets between stacked items (tableau FACE_UP_OFFSET, Mahjong LAYER_DX/DY) must be derived proportionally from the computed tile/card size — never fixed.

### Reference implementations

| Game        | Layout Function                                                     | Notes                                                        |
| ----------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| Solitaire   | `useResponsiveCardSize()` in `CardSizeContext`                      | `scale = min(1, effectiveWidth / naturalBoardWidth)`         |
| FreeCell    | Same `CardSizeContext`                                              | Smaller default card (40×57) for 8-column fit                |
| Bottle Sort | Inline in `SortBoard.tsx`                                           | `bottleH = min(defaultH, maxBottleH)` from `availableHeight` |
| Mahjong     | `calculateMahjongLayout()` in `frontend/src/game/mahjong/layout.ts` | Responsive layout with tested fit/clamp behavior             |

---

## 4. Layer 3 — Gesture / Input

### Rule

Choose the simplest input primitive that preserves both gesture correctness and accessibility.

- Use the shared RNGH/Reanimated gesture infrastructure when a control needs drag, pan, gesture composition, or UI-thread per-frame updates.
- `Pressable` / `TouchableOpacity` are acceptable for simple tap-only game controls when there is no measured RNGH composition conflict. Their native activation path is often the most direct screen-reader surface.
- Any custom `GestureDetector`-driven primary control must expose an equivalent assistive-technology activation path (for example `accessibilityActions` / `onAccessibilityAction` and iOS `onAccessibilityTap`).
- Never use raw `onTouchStart`, browser drag events, or `PanResponder` for game input.
- Never update React state on every frame of a gesture — that belongs in Layer 4 (shared values on the UI thread).

### Card games (drag required)

Use the shared drag system (see [§7](#7-shared-drag-system)).

- Wrap draggable cards in `<DraggableCard>`.
- Register drop targets with `<DropTarget>`.
- Wrap the board in `<DragContainer>` with `<DragProvider>`.
- Tap fallback (select + tap-to-place) must work independently of drag — iOS testers use this fallback when gesture conflicts occur.

### Board games (tap only)

For a simple tap-only board with no competing gesture recognizers, prefer an accessible native control such as `Pressable` / `TouchableOpacity`. Keep the element's role, label, disabled state, and activation behavior available to VoiceOver/TalkBack.

Use `Gesture.Tap()` inside `<GestureDetector>` when the game genuinely needs RNGH composition or coordination with another gesture. In that case, the gesture surface must provide an explicit accessibility activation path that reaches the same validated action as the touch gesture.

Current examples:

- Bottle Sort intentionally keeps `TouchableOpacity` in `BottleView`; its bottles are accessible buttons and there is no competing RNGH gesture on that surface.
- Blackjack and Sudoku likewise may keep their existing accessible tap controls unless a real gesture-contention problem justifies migration.
- Canvas-based games (Mahjong on native uses Skia, on web uses Canvas2D) implement hit-testing at the canvas/root surface because there are no individual React elements per tile; the game must provide separate accessible state/actions where required.

### Conventions

- Do not copy a global `activeOffsetX/Y` threshold into every gesture. Tune activation for the interaction and target size, and cover it with regression tests. The shared card drag system currently uses `minDistance(5)`; the former `activeOffsetX/Y([-12, 12])` setting was intentionally removed because it made narrow-card drags feel unresponsive.
- Do not use `simultaneousHandlers` unless you have measured a specific conflict. It is rarely needed and introduces ordering bugs.
- `GestureHandlerRootView` must wrap the entire app root — never nested, never missing. Its absence causes silent gesture failures on iOS.
- Test gesture interactions on a **physical iOS device**, not just the simulator. The simulator does not faithfully reproduce iOS UIGestureRecognizer priority resolution.

### Reference implementations

| Game        | Pattern                                        | File                                                 |
| ----------- | ---------------------------------------------- | ---------------------------------------------------- |
| Solitaire   | `DraggableCard` (Pan + Tap via shared system)  | `frontend/src/game/_shared/drag/DraggableCard.tsx`   |
| FreeCell    | Same shared system + double-tap (300ms window) | `frontend/src/components/freecell/FreeCellBoard.tsx` |
| Bottle Sort | Accessible `TouchableOpacity` per bottle       | `frontend/src/components/sort/BottleView.tsx`        |
| Mahjong     | `onPress` → canvas hit-test                    | `frontend/src/components/mahjong/GameCanvas.tsx`     |

---

## 5. Layer 4 — Animation

### Rule

All per-frame animation uses `react-native-reanimated` shared values and worklets. **Never drive per-frame updates through React `setState`.** Use `useSharedValue`, `useAnimatedStyle`, and `withSpring`/`withTiming`/`withSequence` from Reanimated.

### Conventions

- Commit game state **after** the animation finishes — not before. Pass a completion callback to `withSpring`/`withTiming` and call `runOnJS(updateGameState)()` at the end.
- Provide a `useReduceMotion()` path for every animation. Skip intermediate steps (ghost, lift, travel) but still call the completion callback so game state advances.
- Animation state (ghost position, tilt angle, burst particles) is local to the animation component or hook. It must not be stored in game engine state.
- Sequences that involve multiple steps (lift → travel → tilt → commit) use `withSequence` + `withDelay`. Never chain `setTimeout` calls.

### Animation types by purpose

| Purpose                   | Tool                                         | Notes                                 |
| ------------------------- | -------------------------------------------- | ------------------------------------- |
| Drag ghost position       | `useSharedValue` + `useAnimatedStyle`        | UI-thread only; no setState per frame |
| Card selection lift/glow  | `withSpring`                                 | Short spring, ~200ms                  |
| Invalid move shake        | `withSequence` of `withTiming` translations  | X-axis only                           |
| Pour/tilt sequence        | `withSequence` + `withDelay`                 | Completion commits game state         |
| Win/match burst particles | `FlyingPair` or equivalent overlay component | Separate from game state              |
| Snap-back on failed drop  | `withSpring` to `originX/Y`                  | In `snapBackAndClear` in DragContext  |

### Reference implementations

| Game        | Animation                                      | File                                                            |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------- |
| Solitaire   | Win cascade, card lift/glow, shake             | `frontend/src/components/solitaire/SolitaireWinCascade.tsx`     |
| FreeCell    | Foundation complete, game win, auto-complete   | `frontend/src/components/freecell/FreeCellGameWinAnimation.tsx` |
| Bottle Sort | Pour choreography (lift, travel, tilt, stream) | `frontend/src/components/sort/SortBoard.tsx`                    |
| Mahjong     | Match burst (FlyingPair)                       | `frontend/src/components/mahjong/FlyingPair.tsx`                |
| Mahjong     | Shuffle pulse, deadlock shake                  | `frontend/src/components/mahjong/useMahjongFeedback.ts`         |

---

## 6. Layer 5 — Rendering

### Rule

Rendering is the output of the layers above it. Components in this layer are pure presentational: they receive layout, animation style, and game state as props/context and render — they do not validate moves, measure themselves for drop detection, or trigger API calls.

### Patterns

**React Native views** — default for all games. Cards, piles, bottles are standard RN components styled by the layout layer and animated by Reanimated `useAnimatedStyle`.

**Skia Canvas** — used by Mahjong on native (iOS/Android) via `@shopify/react-native-skia`. Required when the number of individual elements would create thousands of React views (Mahjong has 144 tiles across 4 layers). If you use Skia, you must:

- Maintain a parallel web implementation (`GameCanvas.web.tsx`) using Canvas2D.
- Keep the same hit-test coordinate math in both files.
- Drive both from the same layout calculation function.

**Skia Picture for per-frame scenes** — Star Swarm (`frontend/src/components/starswarm/GameCanvas.tsx`, #2562). When the whole scene changes every frame, don't rebuild a declarative Skia tree through React state. Build a plain-data display list in a pure, tested function on the JS thread (`game/starswarm/render/frame.ts`), write it to one shared value, and replay it in a worklet into a `Picture` (`createPicture` inside `useDerivedValue`, drawn by `game/starswarm/render/drawFrame.ts`). The worklet makes no decisions, so all drawing rules stay unit-testable without a canvas.

### Conventions

- Keep `CardView`, `TileView`, `BottleView` purely presentational. No game logic, no gesture detection, no direct Reanimated shared value reads.
- Do not use `StyleSheet.absoluteFill` inside a game component unless it is intentionally an overlay.
- For overlays (DragOverlay, ghost bottle, match burst): render as a sibling of the board inside the game's root container, with `position: absolute` + appropriate `zIndex`. Do not portal to the app root.

---

## 7. Shared Drag System

The shared drag system lives in `frontend/src/game/_shared/drag/`. Use it for **any card game that requires drag-and-drop**. Do not reimplement drag for a new game.

### Components

| File                | Purpose                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| `DragContainer.tsx` | Root wrapper; owns `onLayout` measurement of the container bounds              |
| `DragContext.tsx`   | Provider holding all drag state and shared values; registers drop zones        |
| `DraggableCard.tsx` | Wraps a card; handles Pan gesture → `startDrag`, `endDrag`, `snapBackAndClear` |
| `DropTarget.tsx`    | Registers a drop zone with an `id`, bounds measurement, and `onDrop` handler   |
| `DragOverlay.tsx`   | Absolute-positioned ghost rendering the dragged card(s) above all piles        |

### How to use

**Step 1 — Wrap the screen** with `<DragProvider>` and `<DragContainer>`:

```tsx
<DragProvider getLegalDropIds={getLegalDropIds}>
  <DragContainer>
    <MyBoard />
    {/* DragOverlay is rendered inside DragContainer automatically */}
  </DragContainer>
</DragProvider>
```

`getLegalDropIds` is optional. If provided, it receives the `DragSource` and dragged cards and returns the set of drop zone IDs that are legal — those zones will receive a highlight.

**Step 2 — Make cards draggable** with `<DraggableCard>`:

```tsx
<DraggableCard
  dragCards={[{ suit, rank, width: cardW, height: cardH }]}
  dragSource={{ game: "mygame", type: "pile", col: 3, fromIndex: i }}
  onTap={() => handleTap(card)}
  draggable={card.faceUp}
>
  <CardView card={card} />
</DraggableCard>
```

- `dragCards` — the card(s) that will appear in the ghost. For a tableau run, include all cards from `fromIndex` to end of pile.
- `dragSource` — identifies where the card came from; passed to `onDrop` on the receiving zone.
- `onTap` — fallback for users who tap instead of drag. Always provide this.
- `draggable={false}` — face-down cards still receive tap but cannot be dragged.

**Step 3 — Register drop targets** with `<DropTarget>`:

```tsx
<DropTarget
  id={`pile-${col}`}
  onDrop={(source, cards) => {
    const accepted = engine.validateDrop(state, source, cards, col);
    if (accepted) dispatch({ type: "DROP", col, cards });
    return accepted; // false triggers snap-back
  }}
>
  <PileView col={col} />
</DropTarget>
```

`onDrop` must return `true` if the drop was accepted (DragContext clears state) or `false` to trigger snap-back.

### Shared pile components (#2983)

FreeCell and Solitaire draw their foundations and tableau columns with one pair of components in `frontend/src/components/cards/`, so a drag fix lands once:

| File                 | What it owns                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FoundationPile.tsx` | Top card as a `DraggableCard` (`type: "foundation"`), the empty suit placeholder, the `DropTarget` wrap (`dropId` doubles as the testID, #2346)                                                     |
| `TableauColumn.tsx`  | Stacking offsets (face-down cards use `faceDownOffset`), the dashed empty placeholder, one `DraggableCard` per card with the run from it up, buried-card `hitSlop` (#1248), the column `DropTarget` |

The game wrappers (`components/freecell/FoundationPile.tsx` and `TableauColumn.tsx`, `components/solitaire/FoundationPile.tsx` and `TableauPile.tsx`) only fix the per-game props: `game` / `ns`, testIDs, label keys, corner radius (6 vs 8), hint border width (2 vs 3), the placeholder glyph's style, and — for the tableau — the offsets and `renderCard` (FreeCell: `SelectableCard` with hint borders; Solitaire: `CardView`, or `SelectableCard` when selected, plus a hint frame on the hint source). A change to drag, drop or hit areas belongs in `components/cards/`; check it on a physical iPhone and Android device (pitfalls below).

### DragSource type

`DragSource` is a discriminated union defined in `DragContext.tsx`. When adding a new game, extend the union:

```ts
// In DragContext.tsx — add your game's source variants:
export type DragSource =
  | { game: "solitaire"; type: "tableau"; col: number; fromIndex: number }
  | { game: "freecell"; type: "freecell"; cell: number }
  | { game: "mygame"; type: "pile"; col: number; fromIndex: number }; // ← add
// ...
```

Update `isCardInDragStack()` in the same file to handle the new variant.

### Known iOS pitfalls

| Pitfall                                  | Symptom                            | Fix                                                                                                    |
| ---------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GestureHandlerRootView` not at app root | Pan gesture silently fails on iOS  | Ensure it wraps `<App />` once, at the top                                                             |
| Parent `overflow: hidden`                | Ghost card invisible during drag   | Remove `overflow: hidden` from any ancestor of `DragContainer`                                         |
| Pan activation tuned too aggressively    | Drag fires on taps or feels sticky | Start from the shared card drag's tested `minDistance(5)`; change only with device regression coverage |
| Testing only on simulator                | Works in sim, fails on device      | iOS UIGestureRecognizer priority differs from simulator; test on physical device                       |

---

## 8. Screen Layer

A game screen (`frontend/src/screens/<Game>Screen.tsx`) sits above the five layers and composes them. It wires the engine to the platform: the shell, the session, saving, pausing, the end of the game and the result card. It owns none of the rules, layout maths or drawing. The backend side of the same wiring is [`GAME-CONTRACT.md §2`](GAME-CONTRACT.md#2-frontend-contract).

### What a screen contains

- **Shell.** `GameShell` (`components/shared/GameShell.tsx`) with `gameType="<game>"`, which is required and adds the ⋯ menu's Stats (and Scorecard) items. `gameType={null}` is only for a screen that is not a play screen. Back defaults to the lobby. See [GAME-CONTRACT §2.2](GAME-CONTRACT.md#22-gameshell).
- **Session.** `useGameSync("<game>")` (`game/_shared/useGameSync.ts`) is the only path to `/games`: `markStarted()`, `complete()`, `setProgressSnapshot()`, and `resume()` for restored progress. See [GAME-CONTRACT §2.3](GAME-CONTRACT.md#23-usegamesync).
- **Rank and board.** `useGameLeaderboard("<game>", navigation, partition?)` returns `{ leaderboard, openLeaderboard }`. It wraps `useGameRank` (the rank lookup, called `useLeaderboardSubmit` before #2990) and `useLeaderboardLink` (the opener). Call `leaderboard.lookup(gameId)` once at game over and `leaderboard.reset()` on a new game, and pass `openLeaderboard` to both `GameShell` and the result card. A game with no board (Blackjack, Daily Word) uses none of them.
- **Saving.** The default is the game's storage module (`game/<name>/storage.ts`, built on `_shared/storageSlot`, #2987): the screen loads on mount, calls `resume()` for a saved mid-game (#2654) and saves after each change. Solitaire, FreeCell, Sudoku, Twenty48, Yacht, Sort (plus on background) and Daily Word do exactly that. The exceptions:
  - **Star Swarm** saves only a paused run: on pause, on backgrounding and on leaving the screen (`savePausedRun` → `savePausedState`). Its `game/starswarm/pauseStore.ts` writes AsyncStorage directly, not through `storageSlot`, and carries the engine counters (#2645). A run that is never paused is never saved.
  - **Hearts** saves at trick and hand transitions, on blur and on background, not after every card.
  - **Blackjack** saves from `BlackjackGameContext` (every `apply`), not from its screens.
  - **Mahjong** debounces its saves by `SAVE_DEBOUNCE_MS` in `useMahjongPersistence`, writing at once on leave, New Game and unmount.
  - **Cascade** (disabled, #3033) throttles its saves (`SAVE_THROTTLE_MS`).
- **Restore and save hook.** `usePersistedGameState({ load, save, clear })` (`game/_shared/usePersistedGameState.ts`, #3087) owns the game state and returns `{ state, setState, stateRef, loading, hasLoadedRef, clear, reload }`, plus `restoredRef`, which is internal: it carries the handler `useGameRestored` registers, and screens never touch it. It loads once on mount, and a load that lands after unmount sets nothing. It saves nothing until the load has landed, so a state set early can't overwrite the save, and after that it saves every non-null state (a null state is pre-game and saves nothing). `stateRef` follows each committed state (written at layout time, so a handler running before the passive effects flush still reads it), `clear()` deletes the save and ignores a failure, and `reload()` runs the load again for a Retry (`loading` turns true, a load still in flight is dropped, and the restore handler runs again when it lands). A load that rejects ends `loading` and saves nothing for the rest of the session, which protects a save that could not be read; FreeCell would then show an empty board. The storage slots never reject today. The screen's restore work (`resume()`, the guards for a resumed won game, a fresh deal on a clean slot, `usePausableClock`'s `adoptLoaded`) goes in a `useGameRestored(game, handler)` call after it. The handler runs once, when the load lands, with the loaded game or null, and a `setState` there replaces the loaded state in the same batch. That call is a separate hook because the handler uses things the screen builds on the hook's state (the play clock, the deal), and those exist only after the hook. Call the hook before `useCompletionTransition` so that a winning move is saved before the completion clears it. Throttling and debouncing stay outside the hook.
  - **Uses it:** Solitaire, Sudoku and FreeCell, each loading its stats inside `load`, and Daily Word (#3109). Daily Word's `load` fetches today's puzzle with the save. A save whose `puzzle_id` (`YYYY-MM-DD:lang`) is today's resumes. One for another day is cleared inside `load`, before today's fresh board is returned and saved. A failed load (offline with no cached puzzle, or an error) resolves null and the restore handler shows the error; its Retry is `reload()`. A finished board it restores is already stored, so its `save` skips that state: a finished puzzle is never re-saved. Play Again clears the save and the next puzzle's board is saved in its place. The slot (`daily_word_state_v1`) and its shape are unchanged.
  - **Twenty48** (#3109) loads its best score inside `load` and saves every change with the one-shot `events` stripped. A clean slot's fresh game is saved at once, and a restored game is not written back. Its play clock still saves the paused board in the pause event's own handler (`saveOnLeave`), before any render, and the hook saves it again when it commits.
  - **Does not use it:**
    - **Yacht** (`GameScreen`, checked again in #3109) has no mount load: the lobby reads the save (`HomeScreen`'s `startYacht`) and passes the game through the route, so the board is there on the first render. The hook would start it null for a render and add a load the screen doesn't need. Its save is also four values written together (the board, the difficulty, the computer's scorecard from `useYachtCpuOpponent`, and the finished game's id), and two of them live outside the board's state. A finished game is kept saved with its id, so a VS game reopened with only the computer's last turn left still finds its rank; the lobby starts a new game over any other finished save.
    - **Sort** (checked again in #3109). Its save is the player's progress record (`saveProgress`: the unlocked level, plus the level and board in play), not a game state. That record loads with the level definitions in `useSortLevels`, which owns the load error and its Retry. The board in it becomes the screen's state only when the player taps Continue on the level grid, long after the load. The board is saved inside the record only in play, merged with the progress, and a solve writes the record without the board. The hook would own a state that is not on screen until Continue, and its save would have to merge into a record another hook loads.
    - **Mahjong** keeps `useMahjongPersistence` (`game/mahjong/useMahjongPersistence.ts`, #2961), with the owner's agreement (#3109). Its save stores the undo history as deltas (`MahjongUndoEntry`) and reads older snapshot saves through a shim, and it debounces its writes by `SAVE_DEBOUNCE_MS`, writing at once on leave, New Game and unmount. Its end of game uses `useCompletionTransition` all the same.
    - **Hearts**, **Star Swarm** and **Blackjack** save at their own moments, as listed above.
    - **Cascade** is disabled (#3033).
- **Pausing while away.** `usePauseWhileAway` (`hooks/usePauseWhileAway.ts`, #2735 / #2750), directly or through `usePausableClock`: Mahjong, Solitaire, Sudoku, Twenty48 (and the disabled Cascade). Hearts pauses its play clock through it too (#3087). Its optional `onLeave` callback runs on every leave event (each blur, and each `AppState` change to `background` or `inactive`, with the previous status), even while the player is already away, after `onPause` and never at mount: Hearts saves there on the move to the background, Sort saves its board on each move to `background` or `inactive`, and Star Swarm pauses and saves a live run (a run resumed while the app stayed inactive is paused again by the next event). Yacht keeps its own background listener but shares the hook's `isAwayStatus` check.
- **The app overlay counts as away (#2944).** The header's ⋯ menu, the feedback sheet (from the menu or the "?" button) and the New Game confirmation are native `Modal`s: they neither blur the screen nor change `AppState`, yet the player can't see or play the game behind them. `AppHeader` reports them through `hooks/appOverlay.ts` (`useReportAppOverlay`), and `usePauseWhileAway` treats an open overlay as a third away reason. So every screen on the hook (and on `usePausableClock`) stops its clock while one is open, and `onLeave` gets `{ reason: "overlay" }`: Star Swarm pauses its live run there, and the player resumes from the pause overlay. A screen with its own clock or real-time loop that doesn't use the hook must read `useAppOverlayOpen()` and treat it as away too. `GameResultModal` holds its card while an overlay is open, and presents it `OVERLAY_DISMISS_SETTLE_MS` after the overlay closes: on iOS a second native Modal can't present while another is up or still dismissing.
- **End of game.** `useCompletionTransition(state, isComplete, handlers)` (`game/_shared/useCompletionTransition.ts`, #3087) runs the step from playing to complete, once per game. It fires on each rising edge of `isComplete`, and a null state (pre-game, a cleared board) rearms it. The first edge of a game runs `onComplete`, where the screen ends the session (`complete()`), clears the save (the persisted-state hook's `clear()`, or Mahjong's `discardSave()`), asks for the rank (`lookup()`), works out the best with `bestOf` and saves its stats, in that order. A game the restore loaded already complete is marked with the returned `markRestoredComplete()` (in the `useGameRestored` handler, or Mahjong's mount load): its edge runs `onAlreadyComplete` instead. That records nothing new (no rank, no best, no stats), since its result was counted when it happened. It clears the save, and repeats only what is safe to repeat: `complete()` (a no-op once the session has ended) in FreeCell, Solitaire and Mahjong, the result card in Solitaire, and the idempotent layout unlock in Mahjong. A second edge in one game goes there too. New Game calls the returned `reset()`. The edge is an effect, so it runs after the save of the winning move and after any effect called above it; call `useGameRestored` after it, since the restore handler uses `markRestoredComplete` (the handler is registered at layout time, so its place among the effects changes nothing). The handlers are read at the edge and need no memoising. A plain function in place of the handlers runs on every edge with no once-per-game guard (Sudoku). The "new best" rule is shared: `bestOf(prior, value, lowerIsBetter)` (`game/_shared/bestOf.ts`, #2977). A first result is never a new best.
  - **Uses it:** FreeCell, Solitaire, Mahjong (`onComplete` plus `onAlreadyComplete`) and Sudoku (the plain function: a restored solved puzzle has no session to complete and no usable time, so the same path records nothing for it).
  - **Sort** (#3109) uses the plain function. Its edge is a solved board whose result card is not up (`isComplete && !showWinModal`), which keeps the screen's own timing: it fires on the solve, and again whenever the card is closed while the solved board is still in state (Change Level). That second edge finds the session already closed, so it records no game and asks for no rank. Every solve is scored, replays included, so there is no once-per-game guard. A solve saves progress rather than clearing a save, and Sort never restores a solved board (only an unfinished one is saved), so it has nothing to pass to `markRestoredComplete`.
  - **Twenty48** (#3109) uses it for its game over only: the edge clears the save (`onComplete`, and `onAlreadyComplete` for a game restored already over, marked by `markRestoredComplete()`), and New Game calls `reset()`. Its session is still finished inside the move handler, in the same call as the move that wins or loses: reaching 2048 (with Keep Playing after it) is not a game over, so it can't be this edge, and the loss is finished there too so both ends stay in one place.
  - **Does not use it:**
    - **Hearts** ends on its `game_over` phase and keeps the finished game saved, with its game id, so a reopened card asks for its rank again. It does not clear the save, and its session completion and its game-over sound are separate effects.
    - **Yacht**, **Daily Word**, **Blackjack** and **Star Swarm** keep their own end-of-game flow. #3087 moved only the screens that had the `prevCompleteRef` / `winRecordedRef` edge.
    - **Cascade** is disabled (#3033).
- **Engine events.** `useGameEvents(state.events, handlers)` for one-shot sounds and effects (Yacht, FreeCell, Hearts, Blackjack). Events are one-shot and must not replay on reload: Twenty48 and Blackjack strip them before `saveGame`.
- **Result.** `GameResultModal` (`components/result/`, #2504, split in #2990), and nothing else: no screen builds its own result screen. Blackjack's Goal Reached screen renders the same `ResultCard` inline. See [GAME-CONTRACT §2.5](GAME-CONTRACT.md#25-result-card-and-leaderboard).
- **Components.** Boards, piles, overlays, pickers and the dev panel live in `components/<game>/` (#2979). Dev panels build on `components/dev/DevPanelShell` (#2978) and only render in dev and internal builds. The screen file defines no board, overlay or panel component of its own (Star Swarm's `StarSwarmGame` is the screen body behind its hydration gate; Cascade's inline renderers wait for #3033).

Restoring and saving go through `usePersistedGameState`, and the end of the game through `useCompletionTransition`, both described above, for the screens they fit. A screen that repeats a reset block (leaving one game for the next) keeps it in one local function, such as Mahjong's and Hearts' `leaveCurrentGame()` and Sort's `leaveBoard()`.

### No per-frame React state

A screen never calls `setState` once per frame. Per-frame values live in Reanimated shared values (§5) or in refs that a canvas loop reads. Star Swarm's canvas runs the engine in a ref and writes one display list to a shared value per frame (§6), so the screen only re-renders on lifecycle changes (picker, running, paused, over). **Exempt pending epic #3033:** Cascade's screen still drives its physics loop through React state. It is disabled, and #3033 reworks it.

### The screen header

Every game screen starts with a block comment of roughly 10–18 lines. It names the screen, then lists the screen's concerns in order, each with the issues behind it, so a reader knows what the file wires before reading 500+ lines. Mahjong's header (`screens/MahjongScreen.tsx`) is the template (its full text runs longer; the shape is what to copy):

```ts
/**
 * MahjongScreen — Mahjong Solitaire with full lifecycle wiring (#874).
 *
 * Concerns:
 *   1. Game logic — dispatches engine functions (selectTile, shuffleBoard,
 *      undoMove) …; engine is pure and replaces state wholesale.
 *   2. Persistence — AsyncStorage save/resume, debounced (useMahjongPersistence).
 *   3. Instrumentation — useGameSync session started on first tile tap … (#2627).
 *   4. Result (#2510) — the shared GameResultModal …
 *   5. Audio + animations (#914) — … useMahjongFeedback (#2981).
 */
```

Keep it a list of what the screen wires, not a description of the game (that is [`docs/games/<game>.md`](games/), which links back to the screen). Update the header when a concern moves into or out of the file. Cascade's screen has none: it is pending its rework in epic #3033.

---

## 9. New-Game Gameplay Checklist

This supplements the backend checklist in [`GAME-CONTRACT.md §3`](GAME-CONTRACT.md#3-new-game-checklist).

### Logic layer

- [ ] `frontend/src/game/<name>/engine.ts` is headless — no React, no AsyncStorage, no animation imports
- [ ] Rule engine is covered by unit tests runnable in Node (no React Native environment needed)
- [ ] `validateMove` and `applyMove` (or equivalent) are pure functions — same input always produces same output
- [ ] Play-affecting randomness uses the seed or the `setRng` slot; any module-level counter is restored when a saved game loads, and reset in tests ([ARCHITECTURE §3.2](ARCHITECTURE.md#32-determinism-rng-and-counters-2985-2999))

### Layout layer

- [ ] A `calculate<Name>Layout()` function exists in `frontend/src/game/<name>/layout.ts`
- [ ] All tile/card/piece dimensions are derived from this function — no pixel constants in child components
- [ ] Minimum readable size is clamped (cards ≥ 36px wide, tiles ≥ 28px wide)
- [ ] Validated on iPhone SE (375pt wide) and at least one tablet size

### Gesture layer

- [ ] Card games: uses shared `DragProvider` + `DraggableCard` + `DropTarget`
- [ ] Tap-only controls use an accessible native activation path; if `GestureDetector` is used for primary input, an equivalent screen-reader activation action is wired explicitly
- [ ] Tap fallback works independently of drag (test with drag disabled)
- [ ] Shared draggable cards expose an accessibility label plus activation action that reaches the same tap/move-validation path
- [ ] Tested on a physical iOS device (not only simulator)

### Animation layer

- [ ] No `setState` called on every gesture frame — position tracked via `useSharedValue`
- [ ] Game state committed in animation completion callback, not before animation starts
- [ ] `useReduceMotion()` path skips intermediate steps but still commits game state
- [ ] Every animation sequence uses `withSequence`/`withDelay` — no `setTimeout` chains

### Rendering layer

- [ ] Pile/tile/piece components are purely presentational (no logic, no gesture detection)
- [ ] If using Skia Canvas: web fallback (`GameCanvas.web.tsx`) exists with identical hit-test logic
- [ ] Overlays (ghost, burst, highlights) rendered as absolute-positioned siblings inside the game root

### Screen layer

- [ ] The screen file opens with a roughly 10–18-line header listing its concerns with issue refs (§8)
- [ ] Everything renders inside `GameShell` with `gameType="<game>"`
- [ ] Boards, piles, overlays and the dev panel live in `components/<game>/`; the screen defines none of its own
- [ ] A game with its own clock pauses it through `usePauseWhileAway` / `usePausableClock`; saved progress restores on mount and calls `resume()` (through `usePersistedGameState` where it fits, §8)
- [ ] Game over fires once per game, through `useCompletionTransition` where it fits (§8); a game restored already complete records nothing; "new best" comes from `bestOf`
- [ ] No React state is set once per frame

### Reporting

How a finished game reaches the server and the player. The rules are in [`ARCHITECTURE.md §4`](ARCHITECTURE.md#4-persistence-and-offline-contract) and the screens in [`ARCHITECTURE.md §14`](ARCHITECTURE.md#14-result-leaderboard-and-stats-screens); this game's own page goes in [`docs/games/`](games/).

- [ ] The screen records its session through `useGameSync("<game>")` only: `markStarted()` on the player's first real action, `complete()` on game over, `setProgressSnapshot()` so the hook's own abandons carry the result block, and `resume()` when it restores saved progress. No direct `/games` calls and no queue of its own.
- [ ] The outcome comes from `recordedOutcome()` (`game/_shared/recordedOutcome.ts`). `win` / `loss` / `push` only if the game has a winner — its backend module sets `has_winner = True`, which reaches the app as `HAS_WINNER` in `api/vocab.ts`. Every other game records `completed`. The outcome guard (`game/_shared/outcomeGuard.ts`) fails the screen tests if it doesn't.
- [ ] Duration: pass `durationMs` only if the game measures its own active play time (paused while backgrounded or idle); otherwise pass nothing and `useGameSync`'s active-play window fills it in. Never send wall-clock start-to-end time. A screen that shows a picker or a new board before its session opens calls `resetPlayWindow()` when play begins — **only with no session open**, because it drops what the window has counted. Guard it with `if (!syncGetGameId())` (Yacht's `GameScreen`, Star Swarm, Blackjack) or close the session first (FreeCell's New Game, Sort's level select); with a session open, `start()` / `restart()` reset the window themselves.
- [ ] `summary.result` matches the backend module's `result_model`, including any fields the game's daily-challenge goals read (`backend/daily_challenge/definitions.py`).
- [ ] The result card is `GameResultModal` (`components/result/`). For a game with a board, `const { leaderboard, openLeaderboard } = useGameLeaderboard("<game>", navigation)` and `leaderboard.lookup(gameId)` once at game end: the card only reads the rank (`GET /games/{id}/rank`); it submits no score. Pass `submission={toSubmission(leaderboard)}`, and `onViewLeaderboard={openLeaderboard}` so "View leaderboard" appears when the board is openable.
- [ ] Stats entry: every `GameShell` on one of the game's play screens gets `gameType="<game>"`, which adds the ⋯ menu's "Stats" item (and "Scorecard" for a game in `SCORECARD_GAMES`). A screen of the game that is not a play screen — a run history (`BlackjackStatsScreen`), a detail or inspector screen (`MahjongLayoutDetailScreen`, `MahjongLayoutInspectorScreen`), the scorecard (`ScorecardScreen`) — passes `gameType={null}` (ARCHITECTURE §14). Add the game to `SCORECARD_GAMES` (`navigation/scorecards.ts`) only if it has a live in-match view.
