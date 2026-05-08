# BC Arcade — Gameplay Standards

This document defines how every interactive game in BC Arcade must be structured. It covers the five architectural layers, per-layer conventions, and the shared drag-and-drop system. It is a companion to [`ARCHITECTURE.md`](ARCHITECTURE.md) (server/client split) and [`GAME-CONTRACT.md`](GAME-CONTRACT.md) (backend protocol and new-game checklist).

---

## Table of Contents

1. [The Five-Layer Model](#1-the-five-layer-model)
2. [Layer 1 — Game Logic](#2-layer-1--game-logic)
3. [Layer 2 — Board Layout](#3-layer-2--board-layout)
4. [Layer 3 — Gesture / Input](#4-layer-3--gesture--input)
5. [Layer 4 — Animation](#5-layer-4--animation)
6. [Layer 5 — Rendering](#6-layer-5--rendering)
7. [Shared Drag System](#7-shared-drag-system)
8. [New-Game Gameplay Checklist](#8-new-game-gameplay-checklist)

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

The rule engine lives in `frontend/src/game/<name>/engine.ts` and is fully headless — no React, no AsyncStorage, no animation, no platform imports. See [`ARCHITECTURE.md §3`](ARCHITECTURE.md#3-the-rule-engine--written-once).

### Conventions

- Export pure functions: `validateMove(state, move) → boolean`, `applyMove(state, move) → GameState`.
- Never call `setState`, `useSharedValue`, or any animation API from inside the engine.
- Side effects (audio, haptics, score submission) happen one layer up in the screen or a hook that consumes the engine.
- Game state is persisted to AsyncStorage **after** the engine returns a new state — never inside the engine.

### Reference implementations

| Game | Engine | Notes |
|---|---|---|
| Solitaire | `frontend/src/game/solitaire/engine.ts` | `validateMove` + `applyMove` pure functions |
| FreeCell | `frontend/src/game/freecell/engine.ts` | Same pattern; auto-move candidates computed separately |
| Mahjong | `frontend/src/game/mahjong/engine.ts` | Tile matching, shuffle, deadlock detection all headless |
| Bottle Sort | `frontend/src/game/sort/engine.ts` | `validatePour` + `applyPour` pure; no animation coupling |

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
- Clamp all sizes to a readable minimum. For cards: `cardWidth ≥ 36px`. For tiles: `tileWidth ≥ 28px`.
- If the board overflows the screen even at the minimum size, wrap in a `ScrollView` rather than squishing further.
- Offsets between stacked items (tableau FACE_UP_OFFSET, Mahjong LAYER_DX/DY) must be derived proportionally from the computed tile/card size — never fixed.

### Reference implementations

| Game | Layout Function | Notes |
|---|---|---|
| Solitaire | `useResponsiveCardSize()` in `CardSizeContext` | `scale = min(1, effectiveWidth / naturalBoardWidth)` |
| FreeCell | Same `CardSizeContext` | Smaller default card (40×57) for 8-column fit |
| Bottle Sort | Inline in `SortBoard.tsx` | `bottleH = min(defaultH, maxBottleH)` from `availableHeight` |
| Mahjong | **Pending** (Epic [#1331](https://github.com/wcmchenry3-stack/BC-Arcade/issues/1331)) | Currently hardcoded — `calculateMahjongLayout()` to be extracted |

---

## 4. Layer 3 — Gesture / Input

### Rule

Use `react-native-gesture-handler` for all touch input. Never use raw `onTouchStart`, browser drag events, or `PanResponder`. Never update React state on every frame of a gesture — that belongs in Layer 4 (shared values on the UI thread).

### Card games (drag required)

Use the shared drag system (see [§7](#7-shared-drag-system)).

- Wrap draggable cards in `<DraggableCard>`.
- Register drop targets with `<DropTarget>`.
- Wrap the board in `<DragContainer>` with `<DragProvider>`.
- Tap fallback (select + tap-to-place) must work independently of drag — iOS testers use this fallback when gesture conflicts occur.

### Board games (tap only)

Use `Gesture.Tap()` from `react-native-gesture-handler` inside `<GestureDetector>`. Do not use `TouchableOpacity` or `Pressable` for primary game input — they do not compose correctly with RNGH gestures.

**Exception:** Canvas-based games (Mahjong on native uses Skia, on web uses Canvas2D). These implement hit-testing inside `onPress` on the canvas root; RNGH is not used because there are no individual React elements per tile. This pattern must be documented in the game's component if used.

### Conventions

- Always set `activeOffsetX/Y` thresholds (we use `[-12, 12]`) to prevent spurious pan activation on vertical scroll.
- Do not use `simultaneousHandlers` unless you have measured a specific conflict. It is rarely needed and introduces ordering bugs.
- `GestureHandlerRootView` must wrap the entire app root — never nested, never missing. Its absence causes silent gesture failures on iOS.
- Test gesture interactions on a **physical iOS device**, not just the simulator. The simulator does not faithfully reproduce iOS UIGestureRecognizer priority resolution.

### Reference implementations

| Game | Pattern | File |
|---|---|---|
| Solitaire | `DraggableCard` (Pan + Tap via shared system) | `frontend/src/game/_shared/drag/DraggableCard.tsx` |
| FreeCell | Same shared system + double-tap (300ms window) | `frontend/src/components/freecell/FreeCellBoard.tsx` |
| Bottle Sort | `Gesture.Tap()` per bottle | `frontend/src/game/sort/components/SortBoard.tsx` |
| Mahjong | `onPress` → canvas hit-test | `frontend/src/components/mahjong/GameCanvas.tsx` |

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

| Purpose | Tool | Notes |
|---|---|---|
| Drag ghost position | `useSharedValue` + `useAnimatedStyle` | UI-thread only; no setState per frame |
| Card selection lift/glow | `withSpring` | Short spring, ~200ms |
| Invalid move shake | `withSequence` of `withTiming` translations | X-axis only |
| Pour/tilt sequence | `withSequence` + `withDelay` | Completion commits game state |
| Win/match burst particles | `FlyingPair` or equivalent overlay component | Separate from game state |
| Snap-back on failed drop | `withSpring` to `originX/Y` | In `snapBackAndClear` in DragContext |

### Reference implementations

| Game | Animation | File |
|---|---|---|
| Solitaire | Win cascade, card lift/glow, shake | `frontend/src/game/solitaire/components/SolitaireWinCascade.tsx` |
| FreeCell | Foundation complete, game win, auto-complete | `frontend/src/components/freecell/FreeCellGameWinAnimation.tsx` |
| Bottle Sort | Pour choreography (lift, travel, tilt, stream) | `frontend/src/game/sort/components/SortBoard.tsx` |
| Mahjong | Match burst (FlyingPair), shuffle pulse, deadlock shake | `frontend/src/screens/MahjongScreen.tsx` |

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

### Conventions

- Keep `CardView`, `TileView`, `BottleView` purely presentational. No game logic, no gesture detection, no direct Reanimated shared value reads.
- Do not use `StyleSheet.absoluteFill` inside a game component unless it is intentionally an overlay.
- For overlays (DragOverlay, ghost bottle, match burst): render as a sibling of the board inside the game's root container, with `position: absolute` + appropriate `zIndex`. Do not portal to the app root.

---

## 7. Shared Drag System

The shared drag system lives in `frontend/src/game/_shared/drag/`. Use it for **any card game that requires drag-and-drop**. Do not reimplement drag for a new game.

### Components

| File | Purpose |
|---|---|
| `DragContainer.tsx` | Root wrapper; owns `onLayout` measurement of the container bounds |
| `DragContext.tsx` | Provider holding all drag state and shared values; registers drop zones |
| `DraggableCard.tsx` | Wraps a card; handles Pan gesture → `startDrag`, `endDrag`, `snapBackAndClear` |
| `DropTarget.tsx` | Registers a drop zone with an `id`, bounds measurement, and `onDrop` handler |
| `DragOverlay.tsx` | Absolute-positioned ghost rendering the dragged card(s) above all piles |

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

### DragSource type

`DragSource` is a discriminated union defined in `DragContext.tsx`. When adding a new game, extend the union:

```ts
// In DragContext.tsx — add your game's source variants:
export type DragSource =
  | { game: "solitaire"; type: "tableau"; col: number; fromIndex: number }
  | { game: "freecell"; type: "freecell"; cell: number }
  | { game: "mygame"; type: "pile"; col: number; fromIndex: number }  // ← add
  // ...
```

Update `isCardInDragStack()` in the same file to handle the new variant.

### Known iOS pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| `GestureHandlerRootView` not at app root | Pan gesture silently fails on iOS | Ensure it wraps `<App />` once, at the top |
| Parent `overflow: hidden` | Ghost card invisible during drag | Remove `overflow: hidden` from any ancestor of `DragContainer` |
| `activeOffsetX/Y` too small | Drag fires on every tap | Keep threshold at `[-12, 12]` — the current value was tuned for this |
| Testing only on simulator | Works in sim, fails on device | iOS UIGestureRecognizer priority differs from simulator; test on physical device |

---

## 8. New-Game Gameplay Checklist

This supplements the backend checklist in [`GAME-CONTRACT.md §3`](GAME-CONTRACT.md#3-new-game-checklist).

### Logic layer
- [ ] `frontend/src/game/<name>/engine.ts` is headless — no React, no AsyncStorage, no animation imports
- [ ] Rule engine is covered by unit tests runnable in Node (no React Native environment needed)
- [ ] `validateMove` and `applyMove` (or equivalent) are pure functions — same input always produces same output

### Layout layer
- [ ] A `calculate<Name>Layout()` function exists in `frontend/src/game/<name>/layout.ts`
- [ ] All tile/card/piece dimensions are derived from this function — no pixel constants in child components
- [ ] Minimum readable size is clamped (cards ≥ 36px wide, tiles ≥ 28px wide)
- [ ] Validated on iPhone SE (375pt wide) and at least one tablet size

### Gesture layer
- [ ] Card games: uses shared `DragProvider` + `DraggableCard` + `DropTarget`
- [ ] Board games: uses `Gesture.Tap()` inside `<GestureDetector>`, not `Pressable`/`TouchableOpacity`
- [ ] Tap fallback works independently of drag (test with drag disabled)
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
