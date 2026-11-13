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

Game canvases use the same faces. Star Swarm's HUD (#3598) takes its fonts from
`theme/typography.ts` through `game/starswarm/render/hudStyle.ts`: React Native Text on iOS and
Android, and canvas text on web, where the canvas asks the browser to load the expo-font faces
(`document.fonts.load`) before relying on them. See
[`games/starswarm.md#hud-3598`](games/starswarm.md#hud-3598).

```ts
import { typography } from "@/theme/typography";

<Text style={{ fontFamily: typography.heading }}>24,850</Text>
<Text style={{ fontFamily: typography.body }}>High score</Text>
```

---

## Palette

Tokens live in `frontend/src/theme/ThemeContext.tsx`. Import via `useTheme()` — never hardcode hex values in components.

### Dark theme (canonical, matches Stitch)

| Token          | Hex       | Purpose                                                                        |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `background`   | `#0e0e13` | App background, surface-dim equivalent                                         |
| `surface`      | `#19191f` | Cards, containers                                                              |
| `surfaceAlt`   | `#1f1f26` | Elevated surfaces, nav bars                                                    |
| `surfaceHigh`  | `#25252c` | Highest elevation, modals                                                      |
| `border`       | `#2e2e38` | Dividers, faint outlines                                                       |
| `boxBorder`    | `#7a7a88` | Structural separators (Sudoku 3×3 boxes), ≥ 3:1 on every surface (WCAG 1.4.11) |
| `text`         | `#e8e8f0` | Primary text on surfaces                                                       |
| `textMuted`    | `#a0a0ac` | Secondary text, labels                                                         |
| `textOnAccent` | `#0e0e13` | Text on accent-filled buttons                                                  |
| `accent`       | `#8ff5ff` | Cyan primary — CTAs, highlights                                                |
| `accentText`   | `#8ff5ff` | The accent as the colour of text (the same as `accent` in dark)                |
| `accentBright` | `#00eefc` | Accent gradient stop, neon glow                                                |
| `secondary`    | `#d674ff` | Magenta secondary — combo, alt state                                           |
| `tertiary`     | `#cafd00` | Lime tertiary — tertiary accents                                               |
| `error`        | `#ff716c` | Errors, critical mass                                                          |
| `errorText`    | `#ff9a95` | Error red for text: ≥ 4.5:1 on every surface and the Sudoku washes             |
| `bonus`        | `#4ade80` | Positive confirmations                                                         |

### Light theme

Stitch only ships a dark mockup. The light theme is **first-class** and maintained by us — we keep it so users on bright environments or with system-level light preference aren't forced into dark. It is intentionally not a mechanical inversion of dark: it uses a warm cream ground, and accent hues are desaturated/darkened so they don't vibrate on cream.

| Token          | Hex       | Purpose                                                                        |
| -------------- | --------- | ------------------------------------------------------------------------------ |
| `background`   | `#f5ecd7` | App background (cream)                                                         |
| `surface`      | `#fbf4e2` | Cards, containers                                                              |
| `surfaceAlt`   | `#eddfbf` | Elevated surfaces                                                              |
| `surfaceHigh`  | `#fff8e8` | Highest elevation, modals                                                      |
| `border`       | `#d8c9a6` | Dividers, faint outlines                                                       |
| `boxBorder`    | `#1a1412` | Structural separators (Sudoku 3×3 boxes), ≥ 3:1 on every surface (WCAG 1.4.11) |
| `text`         | `#1a1412` | Primary text                                                                   |
| `textMuted`    | `#6b5e4a` | Secondary text                                                                 |
| `accent`       | `#1bc5d4` | Teal — fills and decoration, not text                                          |
| `accentText`   | `#006d77` | Teal for text: ≥ 4.5:1 on every cream surface (4.6–5.8:1)                      |
| `accentBright` | `#00a8b8` | Accent-filled buttons (dark text on it)                                        |
| `secondary`    | `#a34fc4` | Darkened magenta                                                               |
| `tertiary`     | `#8fa800` | Darkened lime                                                                  |
| `error`        | `#d94a42` | Errors                                                                         |
| `errorText`    | `#b52d26` | Error red for text: ≥ 4.5:1 on every cream surface and the Sudoku washes       |
| `bonus`        | `#2da557` | Positive confirmations (large text/UI)                                         |

The light header bar stays dark (`headerBg` `#1a1412`) over the cream body.

**Contrast rule:** all body and label text must achieve **≥ 4.5:1** against its surface (WCAG AA). Accent-on-surface pairs used for meaningful information (not decoration) must also meet 4.5:1.

### Accent as text: `accentText` (#3748)

The light accent `#1bc5d4` measures 1.6–2:1 on cream, so it can't colour text. **Any text (or thin stroke) that would be `colors.accent` is `colors.accentText`**: in dark it is the accent itself, in light a darker teal `#006d77` that reaches **≥ 4.5:1** on `background`, `surface`, `surfacePeer`, `surfaceAlt`, `surfaceHigh` and the held-die tint (`frontend/src/theme/__tests__/accentTextContrast.test.ts`). Backgrounds, button fills, bars and borders that carry no information stay `accent`. The light `potential` token (Yacht's potential scores) is `accentText`.

### Error as text: `errorText` (#3773)

The light error `#d94a42` is ~3.6:1 on cream, so it can't colour small text. **Text that would be `colors.error` is `colors.errorText`** (the HUD error count, a wrong or conflicting Sudoku digit): in light a darker red `#b52d26`, in dark a lighter `#ff9a95` (the dark `error` is 3.5:1 on the same-digit wash), both **≥ 4.5:1** on every page surface and Sudoku wash (`frontend/src/theme/__tests__/errorTextContrast.test.ts`, `components/sudoku/__tests__/boardContrast.test.ts`). Rings, washes, fills and underlines stay `error`.

Not switched, by design: icons and spinners (graphics need 3:1, not 4.5:1), text on a fixed dark surface (the dark header bar, the blackjack and solitaire felt, dev panels) where the bright accent is the readable one.

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

### Hint ring

| Token      | Dark      | Light     | Use                                                                                                                                                                                                                                     |
| ---------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hintRing` | `#4ade80` | `#1f7a3c` | The ring on a hint's destination (Bottle Sort, #3660). A graphic, so it needs ≥ 3:1 on the board background (11.0:1 dark, 4.6:1 light); `bonus` is 2.7:1 on cream. Enforced by `frontend/src/theme/__tests__/hintRingContrast.test.ts`. |

### Modal scrim

Use `colors.overlay` behind every modal card: `rgba(0,0,0,0.75)` in dark, `rgba(0,0,0,0.5)` in light (a 75% scrim over cream reads as an error state). Don't hardcode a scrim.

### Per-game palette modules

Some colours are not UI chrome and must not follow the light/dark theme: a Mahjong tile is ivory, Star Swarm is drawn on black, a Wordle tile is green or yellow because that is the game. These live in a per-game module `frontend/src/theme/theme.<game>.ts` as named constants, never inlined in a screen or component:

| Module                                  | Holds                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme.mahjong.ts`                      | Board, tile face / border / sides, shadow and lock tint, suit placeholder colours (`MAHJONG_SUIT_COLOR`), flying pair (`MAHJONG_FP_*`), mini-map (`MAHJONG_MINIMAP_*`), deadlock dim and sparks (`MAHJONG_DEADLOCK_DIM`, `MAHJONG_SPARK`), overlay                                                                                              |
| `theme.starswarm.ts`                    | Screen, HUD and Controls colours: space, cyan accent, hull blue, armour blue and pale, lightning, pause scrim                                                                                                                                                                                                                                   |
| `game/starswarm/render/palette.ts`      | Star Swarm's in-canvas colours as `0xRRGGBB` (`*_RGB`) and packed `0xAARRGGBB`: shots, tiers, asteroids, Buddy HP, Carrier, pickups                                                                                                                                                                                                             |
| `theme.dailyword.ts`                    | Wordle tile and key colours (correct / present / absent), their letter colour, and the win sparks (`DAILYWORD_SPARK`)                                                                                                                                                                                                                           |
| `theme.cascade.ts`                      | Cascade placeholder piece colours (`CASCADE_PIECE_COLORS`): the plain circle shown for a tier whose sprite hasn't decoded, and the dev-panel swatch. Replaced by the code-drawn art in #3698. The lid and danger state (`CASCADE_LID_PALETTE`, light and dark: lid line, spawner ring, over-lid wash, #3694)                                    |
| `theme.twenty48.ts`                     | 2048 flat tile ladder, 2 to 131072 (`TWENTY48_TILES`: fill and AA text colour per value), the empty slot per theme (`TWENTY48_SLOT`), the 2048+ glow (`TWENTY48_TOP_TILE_GLOW`), and the game-over beat's board dim (`TWENTY48_DIM`, #3689); contrast and distinctness are tested in `components/twenty48/__tests__/tileStyles.test.ts` (#3688) |
| `theme.hearts.ts`                       | Hearts card-table felt (centre, edge, rim; same in light and dark) and the moments' colours (queen, hearts broken, moon shot)                                                                                                                                                                                                                   |
| `theme.table.ts`                        | Card-table felt for Solitaire and FreeCell (centre, edge, rim; own dark and light greens) and the felt's slot outlines                                                                                                                                                                                                                          |
| `theme.bottle.ts`, `theme.constants.ts` | Sort liquids; shared one-offs (badges, menu shadow, dev-panel accents); Blackjack's natural edges and sweep (`BLACKJACK_NATURAL_*`, a dark and a light set, #3621)                                                                                                                                                                              |

Rules:

- **One definition, every renderer.** The native (Skia) and web (2D canvas) renderers import the same constants, so they cannot drift. The Star Swarm canvas colours that the HUD shares (space, accent, hull blue, lightning) are defined once in `theme.starswarm.ts` and `palette.ts` derives from them; `GameCanvas.web.tsx` builds its colour table from `palette.ts` with `cssHex` / `cssRgba`.
- **Use a token first.** If `colors.*` already has the meaning (`celebration`, `error`, `bonus`, `accent`), use it. A per-game module is for colours that are fixed by the game's look, not for avoiding a token.
- **Contrast is tested.** Add new text or tile colours to `frontend/src/theme/__tests__/gamePalettes.test.ts` (WCAG helpers, same pattern as `outcomeContrast.test.ts`).
- **Enforced in CI.** `npm run check-colors` (`frontend/scripts/check-color-literals.mjs`) fails on a colour literal in `src/screens`, `src/components`, `src/game/_shared`, `src/game/cascade` or `src/game/starswarm/render` (multi-line strings included; tests: `npm run test:check-colors`). `theme.*.ts` (including `theme.cards.ts`: card shadow, scrim, selection glow and the Neon deck palette) and `palette.ts` are exempt by design; its allowlist is the dev-only code, Cascade (#3033); an entry that matches no file fails the check. Do not add to the allowlist to get a literal past the check.

---

## Stitch-as-basis rule

The Stitch zip is the **structural basis** for a screen's redesign — layout, component hierarchy, spacing, and interaction intent — not just a source of colors and fonts to paint onto the existing implementation. Earlier we made the mistake of reskinning existing screens with BC Arcade tokens while keeping their old layouts; that's not the goal.

Stitch mockups are **guidelines, not truth**. They contain inconsistencies and reference functionality that isn't implemented. When a mockup conflicts with shipped reality, flag it in the PR rather than silently working around it.

### Per-screen status

| Screen        | Source of truth            | Notes                                                                                                             |
| ------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Cascade**   | Our implementation         | Tokens already match Stitch exactly. Do not regress Cascade to match the Stitch mockup layout.                    |
| **Yacht**     | Our implementation         | The thumb tray (#3748, see [Yacht UI](games/yacht.md#ui)). The Stitch mockup is no longer the target.             |
| **2048**      | Stitch mockup              | Rebuild from the Stitch layout, not a reskin.                                                                     |
| **Blackjack** | Stitch mockup (priority)   | `stitch_gaming_app/blackjack_table/` and `blackjack_betting/` — this is the one we most want to faithfully match. |
| **Lobby**     | Stitch mockup              | The shipped lobby came out squished; any rework must honor the Stitch layout's breathing room and proportions.    |
| Other screens | Default to Stitch-as-basis | Unless explicitly decided otherwise.                                                                              |

---

## Card decks

### The card back (Classic, Minimal, Neon)

The always-available decks share one back (#3740, owner decision #3742): the **lattice**. A white margin (`cardFace`) round a BC teal field (`cardBack`, `#00737e`), a dense diamond lattice and an inset line in white (`cardBackInk`), a diamond medallion from 40 px card width, and a 1-px outer edge. Like the face, it is the same in light and dark: one physical deck. The tokens sit next to `cardFace` in `theme/ThemeContext.tsx`.

| Deck    | Back                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Classic | The lattice in `cardFace` / `cardBack` / `cardBackInk`.                                                                                      |
| Neon    | The lattice in `NEON_DECK`: a cyan margin (`backRim`), a navy field (`backField`), a cyan inset line and lattice (`backLine`, `backAccent`). |
| Minimal | The frame only (margin, field, inset line), drawn with Views, no pattern, no mark.                                                           |

The back holds 3:1 (WCAG 1.4.11) against the Blackjack, Solitaire / FreeCell and Hearts felts in both themes, through its margin or its field (`theme/__tests__/cardBackContrast.test.ts`), so no table outlines it. The outer edge is the `border` prop, so the Solitaire and FreeCell hint and selection borders show on face-down cards.

It is drawn by `decks/CardBack.tsx` from the pure shapes in `decks/cardBackShapes.ts`: 4-6 SVG elements per card (the lattice is one path clipped analytically), no filters, clip paths, gradients or per-card ids. The shapes are cached per (design, size, radius, colours) and the component is `React.memo`. The back is a function of (design, palette): a chosen back (#3429) overrides it by passing a different `backDesign` or palette to `SvgCardFace`; there is no cosmetics system yet.

Besides Classic, Minimal and Neon, three original decks are drawn in code (SVG, no third-party art) in `frontend/src/game/_shared/decks/`. They share one face component (`bc/BcCardFace.tsx`) and a 250 x 350 card box; art colours live in `BC_DECK_ART` (`theme/theme.cards.ts`). They are listed in Settings only when `BC_DECK_ENABLED` is on (internal and dev builds, same rule as hidden games); in store builds a saved selection falls back to Classic.

| Deck      | Look                                                                                                             | Colours                                                               | Index font    |
| --------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------- |
| Arcade    | Flat geometric courts in BC colours, ringed ace, BC monogram back                                                | Face, ink and red suit from the theme; courts cyan, violet, gold, red | Space Grotesk |
| Parlor    | Traditional double-headed courts, larger ace of spades, navy lattice back                                        | Face, ink and red suit from the theme; navy, red and gold courts      | Manrope       |
| Synthwave | Single-line icon courts (crown, tiara, cap), glow, sunset-grid back; always dark, in light and dark themes alike | Face `#14141b`, black suits cyan `#8ff5ff`, red suits pink `#ff5fa2`  | Space Grotesk |

Synthwave draws outlined pips from 48 px card width and solid pips below it, so it stays readable in a 4-hand Blackjack split (36 px).

Backs are fixed per deck and ignore the theme's `cardBgBack`. The outer edge of every BC deck, face and back, Synthwave included, takes the `border` prop, so the selection and hint borders in Solitaire and FreeCell work as they do in Classic (including on face-down cards). It is drawn inset by half its width, 6 card units wide (1.25 px on a 52 px card), so the viewBox never clips it. Backs use a 6 px corner on screen, like PlayingCard's scrim and hint frame.

Performance: Arcade and Parlor render no SVG filters. Synthwave renders no filter below 48 px width, none on 2-10 cards, and at most one filter (a blur-and-merge glow) on an ace or a J/Q/K at 48 px and wider. Every filter, clip path and gradient id is per card instance (`useId`), so cards never share ids.

---

## Cascade-specific theming

Cascade has its own asset pipeline (background removal, vertex extraction, fruit-set definitions) that is orthogonal to BC Arcade's palette/typography system. See [`research/CASCADE-THEMING.md`](research/CASCADE-THEMING.md) for that pipeline.

---

## How to use in code

- **Colors:** `const { colors } = useTheme();` then `colors.accent`, `colors.surface`, etc. Never hardcode hex in components.
- **Fonts:** `import { typography } from "@/theme/typography"` then `typography.heading`, `typography.body`. Never hardcode family strings.
- **Theme toggle:** `const { theme, toggle } = useTheme()`. The theme persists to `AsyncStorage` under `gaming_app_theme`.

If you need a token that doesn't exist yet, add it to both `dark` and `light` palettes in `ThemeContext.tsx` and document it here — don't invent a one-off hex in a component. If the colour is fixed by one game's look and should not change with the theme, add it to that game's `theme.<game>.ts` instead (see [Per-game palette modules](#per-game-palette-modules)).
