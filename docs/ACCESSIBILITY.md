# BC Arcade — Accessibility

BC Arcade targets **WCAG 2.1 Level AA** across web, iOS, and Android. This document defines the standards and per-surface checklist every game and screen must satisfy.

---

## 1. Color Contrast

| Context                            | Minimum ratio | Notes                                 |
| ---------------------------------- | ------------- | ------------------------------------- |
| Body text (< 18pt / < 14pt bold)   | 4.5 : 1       | Against the surface it sits on        |
| Large text (≥ 18pt or ≥ 14pt bold) | 3 : 1         |                                       |
| UI components & interactive states | 3 : 1         | Borders, icons, focus rings           |
| Disabled / decorative              | Exempt        | Must not convey essential information |

Both dark and light themes must pass independently. Use the design tokens from [`docs/BRANDING.md`](BRANDING.md) — they are calibrated for AA compliance. Never add one-off hex values without running them through a contrast checker.

**Tooling:** [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/), Figma Contrast plugin, axe DevTools browser extension.

---

## 2. Touch Targets

- Minimum **44 × 44 pt** on iOS and Android (Apple HIG / Material guidance).
- No interactive game control — card, tile, button, die — may be smaller than this.
- If a visual element is naturally smaller (e.g. a small card), expand the hit area with padding or a transparent overlay rather than enlarging the visual.
- On web, minimum **24 × 24 CSS px** for pointer targets (WCAG 2.5.8 AA).

---

## 3. Motion & Animation

BC Arcade uses React Native Reanimated and Matter.js physics. Both must respect the OS-level "Reduce Motion" preference.

- All animations must check `useReduceMotion()` from Reanimated and skip or simplify motion when it returns `true`.
- Physics simulations (Cascade) must resolve immediately to final state when reduce motion is active — no dropping, bouncing, or sliding.
- Do not auto-play looping animations that cannot be paused.
- Avoid content that flashes more than 3 times per second (seizure risk).

This requirement is already enforced at Layer 4 of the gameplay architecture — see [`docs/GAMEPLAY_STANDARDS.md §5`](GAMEPLAY_STANDARDS.md).

---

## 4. Screen Readers

### React Native components

- Every interactive element must have `accessibilityLabel` (a short, meaningful description) and `accessibilityRole` (e.g. `"button"`, `"text"`, `"image"`).
- Decorative images must use `accessible={false}` so screen readers skip them.
- Score updates and turn changes must use `accessibilityLiveRegion="polite"` so VoiceOver / TalkBack announces them without interrupting the user.
- Group related elements with `accessibilityViewIsModal` or `accessible={true}` + `accessibilityLabel` on the container where appropriate.

### Canvas-based games (Cascade, Starswarm, Mahjong on native)

Canvas (`@shopify/react-native-skia`) renders outside the native accessibility tree. These games must provide an accessible text layer alongside or beneath the canvas:

- Current score displayed in a native `Text` element (not only on canvas).
- Game-over / win / loss state announced via a live region or modal.
- Canvas itself marked `accessible={false}` to prevent double-announcement.

---

## 5. Keyboard & Focus (Web)

- All game controls must be reachable and operable via **Tab** (focus) and **Enter / Space** (activate).
- Focus order must follow visual reading order — no invisible focus traps.
- Focus ring must be visible and meet the 3 : 1 contrast ratio against the adjacent background.
- Do not suppress the default browser focus outline without replacing it with a custom one that meets contrast requirements.
- Canvas games (web) must provide keyboard alternatives for every primary action (e.g. arrow keys or dedicated key bindings), documented in the game's `docs/games/<name>.md`.

---

## 6. Text & Readability

- Never convey information through color alone — always pair with a label, icon, or pattern.
- Minimum body font size: **14 sp** (Android), **14 pt** (iOS), **14 px** (web).
- Do not override system text-size settings — use scalable units (`sp` / dynamic type / `rem`), not fixed `px`.
- Line length for any prose UI (rules screen, onboarding) should not exceed 75 characters.

---

## 7. Testing Checklist

Run this before shipping any new game or screen.

### Automated

- [ ] **axe-core (web):** `npx axe <url>` or axe DevTools browser extension — zero critical / serious violations
- [ ] **Color contrast:** run design tokens through a contrast checker for both dark and light themes

### Manual — iOS

- [ ] **VoiceOver:** enable in Settings → Accessibility → VoiceOver. Navigate the game with swipe + double-tap only. Every interactive element must be reachable and announced correctly.
- [ ] **Reduce Motion:** enable in Settings → Accessibility → Motion → Reduce Motion. Confirm all animations simplify or are skipped.
- [ ] **Dynamic Type:** set text size to the largest accessibility size. Confirm no text is clipped or overlaps.

### Manual — Android

- [ ] **TalkBack:** enable in Settings → Accessibility → TalkBack. Same navigation test as VoiceOver.
- [ ] **Reduce Animations:** enable in Developer Options → Animator duration scale → Off. Confirm physics and transitions resolve correctly.
- [ ] **Font size:** maximum system font size. Confirm no layout breaks.

### Manual — Web

- [ ] **Keyboard-only:** unplug mouse and navigate the full game flow with Tab / Shift+Tab / Enter / Space / arrow keys.
- [ ] **NVDA or JAWS (Windows) or VoiceOver (macOS):** spot-check interactive elements and live regions.

---

## 8. Per-Game Notes

| Game        | Canvas?            | Known accessibility work                                              |
| ----------- | ------------------ | --------------------------------------------------------------------- |
| Yacht       | No                 | Dice faces need `accessibilityLabel` (e.g. "Die showing 4")           |
| Hearts      | No                 | Card labels must include suit + rank (e.g. "Queen of Spades")         |
| Blackjack   | No                 | Card labels must include suit + rank; chip count must use live region |
| Solitaire   | No                 | Pile positions and card labels required                               |
| Sudoku      | No                 | Cell coordinates + value in labels (e.g. "Row 3, Column 5, empty")    |
| Cascade     | Yes (Skia)         | Score + game state must have native text overlay; keyboard alt TBD    |
| 2048        | No                 | Grid cell values must be announced on merge                           |
| FreeCell    | No                 | Same card label convention as Solitaire                               |
| Mahjong     | Yes (Skia, native) | Same overlay requirement as Cascade                                   |
| Bottle Sort | No                 | Bottle contents must be labeled by color sequence                     |
| Daily Word  | No                 | Letter input cells need row/column position labels                    |
| Starswarm   | Yes (Skia)         | Score + state overlay required; no keyboard equivalent yet            |

---

_See [`docs/BRANDING.md`](BRANDING.md) for color token values and contrast baselines. See [`docs/GAMEPLAY_STANDARDS.md §5`](GAMEPLAY_STANDARDS.md) for the animation layer contract._
