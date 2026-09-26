# BC Arcade — Branding Guidelines

The visual design system for BC Games is called **BC Arcade**. This document is the source of truth for palette, typography, theming, and how Stitch mockups translate into shipped screens. If code disagrees with this doc, the doc is right — fix the code.

> Never refer to this system as "Neon Arcade". It is **BC Arcade**, always.

---

## Origin

BC Arcade tokens are derived from the Stitch mockup `cascade_gameplay_refined` in `~/Downloads/stitch_gaming_app.zip`. The full Stitch zip contains per-screen mockups (HTML + PNG) that serve as the **structural basis** for each screen's layout — not merely a palette to paint over existing layouts. See [Stitch-as-basis rule](#stitch-as-basis-rule) below.

---

## Typography

Two families, both loaded via `@expo-google-fonts` and mapped through `frontend/src/theme/typography.ts`:

| Role                                           | Family            | Weights in use |
| ---------------------------------------------- | ----------------- | -------------- |
| Headline (titles, scores, HUD numerals)        | **Space Grotesk** | 400, 700       |
| Body / label (paragraphs, buttons, tab labels) | **Manrope**       | 400, 600, 700  |

Import from `theme/typography.ts` — never hardcode font family strings in components.

```ts
import { typography } from "@/theme/typography";

<Text style={{ fontFamily: typography.heading }}>24,850</Text>
<Text style={{ fontFamily: typography.body }}>High score</Text>
```

---

## Palette

Tokens live in `frontend/src/theme/ThemeContext.tsx`. Import via `useTheme()` — never hardcode hex values in components.

### Dark theme (canonical, matches Stitch)

| Token          | Hex       | Purpose                                |
| -------------- | --------- | -------------------------------------- |
| `background`   | `#0e0e13` | App background, surface-dim equivalent |
| `surface`      | `#19191f` | Cards, containers                      |
| `surfaceAlt`   | `#1f1f26` | Elevated surfaces, nav bars            |
| `surfaceHigh`  | `#25252c` | Highest elevation, modals              |
| `border`       | `#2e2e38` | Dividers, faint outlines               |
| `text`         | `#e8e8f0` | Primary text on surfaces               |
| `textMuted`    | `#a0a0ac` | Secondary text, labels                 |
| `textOnAccent` | `#0e0e13` | Text on accent-filled buttons          |
| `accent`       | `#8ff5ff` | Cyan primary — CTAs, highlights        |
| `accentBright` | `#00eefc` | Accent gradient stop, neon glow        |
| `secondary`    | `#d674ff` | Magenta secondary — combo, alt state   |
| `tertiary`     | `#cafd00` | Lime tertiary — tertiary accents       |
| `error`        | `#ff716c` | Errors, critical mass                  |
| `bonus`        | `#4ade80` | Positive confirmations                 |

### Light theme

Stitch only ships a dark mockup. The light theme is **first-class** and maintained by us — we keep it so users on bright environments or with system-level light preference aren't forced into dark. It is intentionally not a mechanical inversion of dark: it uses a warm cream ground, and accent hues are desaturated/darkened so they don't vibrate on cream.

| Token          | Hex       | Purpose                                 |
| -------------- | --------- | --------------------------------------- |
| `background`   | `#f5ecd7` | App background (cream)                  |
| `surface`      | `#fbf4e2` | Cards, containers                       |
| `surfaceAlt`   | `#eddfbf` | Elevated surfaces                       |
| `surfaceHigh`  | `#fff8e8` | Highest elevation, modals               |
| `border`       | `#d8c9a6` | Dividers, faint outlines                |
| `text`         | `#1a1412` | Primary text                            |
| `textMuted`    | `#6b5e4a` | Secondary text                          |
| `accent`       | `#1bc5d4` | Teal — fills and decoration, not text   |
| `accentBright` | `#00a8b8` | Accent-filled buttons (dark text on it) |
| `secondary`    | `#a34fc4` | Darkened magenta                        |
| `tertiary`     | `#8fa800` | Darkened lime                           |
| `error`        | `#d94a42` | Errors                                  |
| `bonus`        | `#2da557` | Positive confirmations (large text/UI)  |

The light header bar stays dark (`headerBg` `#1a1412`) over the cream body.

**Contrast rule:** all body and label text must achieve **≥ 4.5:1** against its surface (WCAG AA). Accent-on-surface pairs used for meaningful information (not decoration) must also meet 4.5:1.

### Outcome tokens (end-of-game results)

Used by the shared end-of-game result card (see epic #2500). Each foreground reaches **≥ 4.5:1** on `surfaceHigh` in its theme, enforced by `frontend/src/theme/__tests__/outcomeContrast.test.ts`. Don't substitute `bonus` or `accent` here: on cream they measure 2.99:1 and 1.99:1.

| Token          | Dark      | Light     | Use                                      |
| -------------- | --------- | --------- | ---------------------------------------- |
| `outcomeWin`   | `#4ade80` | `#1f7a3c` | "You Win!"                               |
| `outcomeLoss`  | `#a0a0ac` | `#6b5e4a` | "You Lose" — muted, deliberately not red |
| `outcomeDraw`  | `#d674ff` | `#8a3fb0` | "It's a Tie!"                            |
| `outcomeEnded` | `#8ff5ff` | `#00737e` | "Game Over" in score-attack games        |
| `celebration`  | `#ffd700` | `#8a6100` | Gold in win celebrations                 |

Each outcome also has a `*Tint` (same hue, 10–14% alpha) for icon discs and badges.

### Modal scrim

Use `colors.overlay` behind every modal card: `rgba(0,0,0,0.75)` in dark, `rgba(0,0,0,0.5)` in light (a 75% scrim over cream reads as an error state). Don't hardcode a scrim.

---

## Stitch-as-basis rule

The Stitch zip is the **structural basis** for a screen's redesign — layout, component hierarchy, spacing, and interaction intent — not just a source of colors and fonts to paint onto the existing implementation. Earlier we made the mistake of reskinning existing screens with BC Arcade tokens while keeping their old layouts; that's not the goal.

Stitch mockups are **guidelines, not truth**. They contain inconsistencies and reference functionality that isn't implemented. When a mockup conflicts with shipped reality, flag it in the PR rather than silently working around it.

### Per-screen status

| Screen        | Source of truth            | Notes                                                                                                             |
| ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Cascade**   | Our implementation         | Tokens already match Stitch exactly. Do not regress Cascade to match the Stitch mockup layout.                    |
| **Yacht**     | Stitch mockup              | `stitch_gaming_app/yatch_gameplay/` is the target layout.                                                         |
| **2048**      | Stitch mockup              | Rebuild from the Stitch layout, not a reskin.                                                                     |
| **Blackjack** | Stitch mockup (priority)   | `stitch_gaming_app/blackjack_table/` and `blackjack_betting/` — this is the one we most want to faithfully match. |
| **Lobby**     | Stitch mockup              | The shipped lobby came out squished; any rework must honor the Stitch layout's breathing room and proportions.    |
| Other screens | Default to Stitch-as-basis | Unless explicitly decided otherwise.                                                                              |

---

## Cascade-specific theming

Cascade has its own asset pipeline (background removal, vertex extraction, fruit-set definitions) that is orthogonal to BC Arcade's palette/typography system. See [`CASCADE-THEMING.md`](CASCADE-THEMING.md) for that pipeline.

---

## How to use in code

- **Colors:** `const { colors } = useTheme();` then `colors.accent`, `colors.surface`, etc. Never hardcode hex in components.
- **Fonts:** `import { typography } from "@/theme/typography"` then `typography.heading`, `typography.body`. Never hardcode family strings.
- **Theme toggle:** `const { theme, toggle } = useTheme()`. The theme persists to `AsyncStorage` under `gaming_app_theme`.

If you need a token that doesn't exist yet, add it to both `dark` and `light` palettes in `ThemeContext.tsx` and document it here — don't invent a one-off hex in a component.
