# Cascade Asset Spike — Public-Source Evaluation

**Issue:** #1618  
**Date:** 2026-05-20  
**Scope:** Research only. No code, no asset changes.

---

## 1. Background and scope

Cascade's current fruit and celestial sprites have unclear licensing. This document evaluates three open-license asset sources — **OpenMoji**, **Twemoji**, and **Kenney.nl** — against the game's v1 asset set (what ships today), estimates swap effort, and provides a go/no-go recommendation for each source.

**Two asset systems coexist after #1746:**

| System | File | Tiers | Themes |
|--------|------|-------|--------|
| v1 (shipping) | `frontend/src/theme/fruitSets.ts` → `FRUIT_SETS` | 11 fruit (0–10) + 11 cosmos (0–10) + reserved slots | Fruits, Cosmos |
| v2 (new engine) | `frontend/src/game/cascade/pieceDefs.ts` → `PIECE_DEFS` | 10 fruit (0–9) | Fruits only (no cosmos yet) |

This spike evaluates sources against the **v1 asset set** — what ships today. V2 implications are noted in §4.

---

## 2. V1 asset inventory

The per-game registry (`frontend/src/game/cascade/images.ts`) imports 26 icon WebPs and 26 baked PNGs (52 files total). Active v1 assets are 23; 3 are reserved future tiers.

### Fruit theme (v1)

| Tier | Name | Active | Emoji |
|------|------|--------|-------|
| 0 | Cherry | ✓ | 🍒 |
| 1 | Blueberry | ✓ | 🫐 |
| 2 | Lemon | ✓ | 🍋 |
| 3 | Grape | ✓ | 🍇 |
| 4 | Orange | ✓ | 🍊 |
| 5 | Apple | ✓ | 🍎 |
| 6 | Peach | ✓ | 🍑 |
| 7 | Coconut | ✓ | 🥥 |
| 8 | Dragonfruit | ✓ | 🐉 (placeholder) |
| 9 | Pineapple | ✓ | 🍍 |
| 10 | Watermelon | ✓ | 🍉 |
| — | Pumpkin | reserved | 🎃 |

> **Note on Dragonfruit:** not a Unicode emoji. The current sprite uses a dragon (🐉) placeholder. Any emoji-based source will have a coverage gap here.

### Celestial theme (v1)

| Tier | Name | Active | Notes |
|------|------|--------|-------|
| 0 | Moon | ✓ | Standard emoji 🌙 |
| 1 | Pluto | ✓ | No standard emoji; dwarf planet |
| 2 | Mercury | ✓ | No standard emoji |
| 3 | Mars | ✓ | No standard emoji |
| 4 | Venus | ✓ | No standard emoji |
| 5 | Earth | ✓ | Standard emoji 🌍 |
| 6 | Neptune | ✓ | No standard emoji |
| 7 | Uranus | ✓ | No standard emoji |
| 8 | Saturn | ✓ | Standard emoji 🪐 |
| 9 | Jupiter | ✓ | No standard emoji |
| 10 | Sun | ✓ | Standard emoji ☀️ |
| — | Milky Way | reserved¹ | Standard emoji 🌌 |

> ¹ Milky Way is imported in `images.ts` (both `COSMOS_ICONS` and `COSMOS_BAKED`) but does not appear in the `fruitSets.ts` cosmos fruits array (which caps at tier 10/Sun). It is available in the registry for a future 12th tier.

**Total active v1 assets: 22** (11 fruit + 11 cosmos). The issue tracker states 23, counting Milky Way as active; the registry includes it but `fruitSets.ts` does not map it to a playable tier.

---

## 3. Source evaluation

### 3.1 OpenMoji

- **URL:** openmoji.org
- **License:** CC BY 4.0 — attribution required
- **Style:** Hand-drawn, open-source, consistent set of 4,500+ glyphs
- **Formats:** SVG (scalable), PNG at 72 px and 618 px

**Fruit coverage (11 active assets)**

| Asset | In OpenMoji? | Notes |
|-------|-------------|-------|
| Cherry | ✓ | Standard emoji |
| Blueberry | ✓ | Standard emoji (Unicode 13) |
| Lemon | ✓ | Standard emoji |
| Grape | ✓ | Standard emoji |
| Orange | ✓ | Standard emoji |
| Apple | ✓ | Standard emoji |
| Peach | ✓ | Standard emoji |
| Coconut | ✓ | Standard emoji |
| **Dragonfruit** | **⚠ verify** | Not in Unicode; OpenMoji has some custom additions — verify at openmoji.org |
| Pineapple | ✓ | Standard emoji |
| Watermelon | ✓ | Standard emoji |

**Estimated fruit coverage: 10/11 confirmed; Dragonfruit requires in-person verification.**

**Celestial coverage (11 active assets)**

| Asset | In OpenMoji? | Notes |
|-------|-------------|-------|
| Moon | ✓ | Standard emoji 🌙 |
| **Pluto** | **⚠ verify** | Not a planet or standard emoji; OpenMoji may have astronomical extensions |
| **Mercury** | **⚠ verify** | Astrological symbol ☿ exists in Unicode; planetary illustration not standard |
| **Mars** | **⚠ verify** | Astrological symbol ♂ exists; planetary illustration not standard |
| **Venus** | **⚠ verify** | Astrological symbol ♀ exists; planetary illustration not standard |
| Earth | ✓ | Standard emoji 🌍 |
| **Neptune** | **⚠ verify** | No standard emoji |
| **Uranus** | **⚠ verify** | No standard emoji |
| Saturn | ✓ | Standard emoji 🪐 |
| **Jupiter** | **⚠ verify** | No standard emoji |
| Sun | ✓ | Standard emoji ☀️ |

**Estimated celestial coverage: 4/11 confirmed; 7 require in-person verification.** OpenMoji's extended set may cover planet illustrations — this is the single largest unknown.

---

### 3.2 Twemoji

- **URL:** github.com/twitter/twemoji
- **License:** CC BY 4.0 — attribution required
- **Style:** Twitter's flat design system, consistent with Twitter/X UI
- **Formats:** SVG, PNG at 72 px

**Fruit coverage:** Identical coverage to OpenMoji for standard emoji (10/11 confirmed). Dragonfruit faces the same gap — not in Unicode standard; requires verification.

**Celestial coverage:** Same Unicode-constrained gaps as OpenMoji (4/11 confirmed: Moon, Earth, Saturn, Sun). Twemoji does not extend beyond the Unicode standard, making gaps for non-emoji planets more likely than with OpenMoji.

**Key difference from OpenMoji:** Twemoji tracks Unicode strictly and does not add custom illustrations outside the standard. This makes it *less likely* to cover Pluto or individual planet illustrations for Mercury, Venus, Mars, Jupiter, Neptune, Uranus.

---

### 3.3 Kenney.nl

- **URL:** kenney.nl/assets
- **License:** CC0 — no attribution required
- **Style:** Clean, game-art vector illustrations — not emoji-style
- **Formats:** SVG, PNG at various resolutions; optimized for games

**Relevant packs:**
- **Food Pack** (`kenney.nl/assets/food-kit`) — 100+ food items; likely covers all 11 v1 fruits including dragonfruit. Verify exact matches against the v1 fruit list.
- **Space Shooter / Simple Space** — includes planets; Pluto is commonly included as a dwarf planet in Kenney space packs. Verify coverage for all 11 celestial bodies.

**Fruit coverage estimate:**

| Asset | In Kenney Food Pack? | Notes |
|-------|---------------------|-------|
| Cherry | ✓ (expected) | Common food pack item |
| Blueberry | ⚠ verify | May appear as "berry" generic |
| Lemon | ✓ (expected) | Common food pack item |
| Grape | ✓ (expected) | Common food pack item |
| Orange | ✓ (expected) | Common food pack item |
| Apple | ✓ (expected) | Common food pack item |
| Peach | ⚠ verify | Less common; may need substitution |
| Coconut | ⚠ verify | Less common; may need substitution |
| **Dragonfruit** | **⚠ verify** | Kenney's extended food packs sometimes include exotic fruits |
| Pineapple | ✓ (expected) | Common food pack item |
| Watermelon | ✓ (expected) | Common food pack item |

**Celestial coverage estimate:**

All named planets (including Pluto) appear in Kenney's space asset packs as dedicated planet illustrations. Sun, Moon, and Milky Way/Galaxy are typically covered. Estimated **11/11 likely covered** — requires pack-by-pack verification.

---

## 4. Licensing analysis

### CC BY 4.0 (OpenMoji and Twemoji)

Attribution is required wherever the assets are publicly distributed. For a mobile/web game, this means:

- A visible "About" or credits screen listing "Icons by OpenMoji / Twemoji (CC BY 4.0)"
- App Store / Play Store listing must not imply ownership of the art
- Attribution must survive theme switching: if the user selects the Fruits theme, OpenMoji attribution must be accessible regardless of which theme is active

**UX burden:** Low friction in isolation (one credits line) but non-zero. Mixing sources — e.g., OpenMoji fruits and Kenney planets — multiplies attribution obligations and risks inconsistent attribution placement. Attribution must also survive app updates without being accidentally removed.

### CC0 (Kenney.nl)

No attribution is required, now or in the future. Assets can be modified, redistributed, and incorporated commercially without credit. This is materially simpler from a legal maintenance standpoint.

**Summary table:**

| Source | License | Attribution required | Commercial use | Modification allowed |
|--------|---------|---------------------|----------------|---------------------|
| OpenMoji | CC BY 4.0 | Yes — in app UI/credits | Yes | Yes |
| Twemoji | CC BY 4.0 | Yes — in app UI/credits | Yes | Yes |
| Kenney.nl | CC0 | No | Yes | Yes |

---

## 5. Swap effort estimate

### 5.1 What a swap touches

**Registry** (`frontend/src/game/cascade/images.ts`)  
26 icon imports + 26 baked imports = 52 static import statements. All must be replaced with new asset files. The export objects (`FRUIT_ICONS`, `FRUIT_BAKED`, `COSMOS_ICONS`, `COSMOS_BAKED`) retain their shape — consumers do not change.

**Bake pipeline** (`frontend/scripts/bake_sprites.py`)  
The script IS committed to the repo (contrary to the issue description which listed it as absent). It reads source images from `fruit_images/` and `celestial_images/` (gitignored), bakes 512×512 PNGs with circular clip, and writes `bakedClipR` values to `fruit-vertices.json` / `cosmos-vertices.json`. A swap requires:

1. Placing new source images in `fruit_images/` and `celestial_images/`
2. Running `bake_sprites.py` to regenerate `fruits-baked/` and `cosmos-baked/`
3. Updating `bakedClipR` values in `fruitSets.ts` from the new `*-vertices.json` output

**Compression check** (`docs/ASSETS.md §Size budgets`)  
Budgets: WebP icon ≤ 500 KB, baked PNG ≤ 200 KB. There is no automated per-asset prebuild enforcement — `npm run prebuild` only crushes the 4 app-icon PNGs. Compliance is verified manually: inspect file sizes after conversion (`convert_icons_to_webp.py`) and after baking (`bake_sprites.py`).

**Hull polygon data** (`assets/fruit-vertices.json`, `assets/cosmos-vertices.json`)  
The `extract_vertices.py` script extracts polygon hull data from source images. If new art has significantly different silhouettes, hull data must be regenerated. This affects physics collision fidelity (Matter.js) but not rendering.

### 5.2 Effort by scenario

| Scenario | Effort estimate | Blockers |
|----------|-----------------|----------|
| **Full v1 swap, one source** | 3–5 days | Download + rename 22 source images; run bake pipeline; update bakedClipR values; WebP conversion; manual size checks; visual QA per tier |
| **Partial swap (fruits only)** | 2–3 days | Same pipeline, 11 assets |
| **Gap fill only (Dragonfruit + planets)** | 1–2 days | Identify substitutes for 7–8 assets; run bake pipeline for changed assets only |
| **V2 swap (when cosmos theme exists)** | Lower than v1 | V2 uses `SpriteRef { assetKey }` — no `bakedClipR` required; simpler asset reference |

### 5.3 V1 vs V2 implications

The v1 renderer uses `bakedClipR` for Skia `drawImage` sizing. Baking new sprites regenerates these values automatically via `bake_sprites.py`. This is the main pipeline overhead.

The v2 engine (`pieceDefs.ts`) uses `SpriteRef { assetKey }` with no `bakedClipR`. If and when v2 adds a cosmos theme and sprite rendering, a swap would be simpler: assign asset keys, no baking needed unless the v2 renderer also uses pre-composited PNGs. This is TBD pending v2 renderer design.

V2 also has a different fruit lineup from v1: Strawberry, Pear, and Melon replace Blueberry, Lemon, and Coconut. A v1 asset swap does not automatically cover v2's asset needs.

---

## 6. Recommendations

### OpenMoji — **Conditional no**

Coverage for standard fruit emoji is strong (10/11). Celestial coverage is unverified for 7 of 11 bodies and likely requires custom illustrations for Mercury, Venus, Mars, Jupiter, Neptune, Uranus, and Pluto. CC BY 4.0 adds attribution UI obligations. Style is cohesive but unmistakably emoji-aesthetic, which may or may not fit the game's visual direction long-term.

**Verdict:** Viable only if OpenMoji's extended set covers the planet gap (requires manual verification). Attribution burden is manageable but adds ongoing legal maintenance. Not recommended unless the emoji-consistent visual style is a deliberate product choice.

### Twemoji — **No**

Same licensing constraints as OpenMoji (CC BY 4.0 attribution required) with *less* likely coverage of non-standard celestial assets. Twemoji follows Unicode strictly and does not add custom illustrations beyond the standard — making planet gaps (Mercury, Venus, Mars, Jupiter, Neptune, Uranus, Pluto) very likely unfilled. Dragonfruit gap is the same as OpenMoji.

**Verdict:** The stricter Unicode scope makes Twemoji the weakest candidate for this specific asset set. Not recommended.

### Kenney.nl — **Recommended**

CC0 license eliminates all attribution obligations now and in perpetuity. Kenney's food and space packs are purpose-built game assets that likely cover the full v1 set including Dragonfruit and Pluto — though exact pack-level coverage requires in-person verification at kenney.nl. Style is game-art rather than emoji, which is appropriate for a physics-based game.

**Verdict:** Recommended pending pack coverage verification. If the food and space packs cover ≥20/22 active v1 assets, gap-fill substitutions are straightforward (e.g., rename a generic "exotic fruit" to Dragonfruit). CC0 removes the only non-technical blocker.

### Recommended next step

Verify Kenney.nl food and space pack coverage against the v1 asset list in §2. If ≥20/22 assets are covered, proceed to a follow-on implementation epic scoped to v1 fruit theme first, v1 cosmos second (matching the current tier-by-tier bake pipeline).

---

## 7. Open questions (for product owner)

1. **V1 or v2 as swap target?** V2 has a different fruit lineup (no Blueberry, Lemon, Coconut; adds Strawberry, Pear, Melon) and no cosmos theme yet. A full v1 swap does not carry over to v2 automatically.
2. **Style preference?** Kenney.nl is game-art; OpenMoji is emoji-style. If brand consistency with the emoji-based UI (e.g., score sheets, menus) matters, OpenMoji may be preferable despite its gaps.
3. **Attribution appetite?** CC BY 4.0 attribution is low friction but must be maintained across app versions. CC0 (Kenney) eliminates this concern entirely.
