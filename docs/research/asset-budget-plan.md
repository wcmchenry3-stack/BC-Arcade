# Packaged-Asset Budget Plan (#3631)

Measured 2026-11-13 on `origin/dev` (the base of branch `docs/3631-asset-budget-plan`). Nothing that ships was changed to produce this: the plan proposes, the owner decides. Audible changes need the owner's audition ([design-review.md](../../.claude/skills/ship-story/references/design-review.md)).

The budget rule that came out of this is in [PERFORMANCE.md: Packaged-asset budget rule](../PERFORMANCE.md#packaged-asset-budget-rule-3631).

## Summary

- Store-config packaged assets are **3,699,614 B (3.53 MiB, 127 files)** against the **4.0 MiB hard limit** (4,194,304 B): **494,690 B (0.47 MiB) of headroom**. The proposed 3.75 MiB warn line (3,932,160 B) leaves **232,546 B (0.22 MiB)** before it trips.
- The issue's framing is out of date. **Sounds are 851 KB (23% of the total). Fonts are 2.71 MiB (75%).** There are no mp3 files in the store config at all: every packaged sound is a small `.ogg`. The Star Swarm and Mahjong mp3 loops are hidden-premium-only and the `--forbid-hidden-assets` guard keeps them out of the store bundle.
- The best saving is **not audible and not in sounds**: the app loads 5 font files but the Google-fonts barrel imports make Metro package 12 (7 Manrope weights, 5 Space Grotesk weights). Importing the five by subpath **saves 648,186 B (0.62 MiB), taking packaged assets to 3.51 to 2.91 MiB** (measured, see below). That alone clears the issue's "about 3.3 MB" target.
- A second, larger lever needs a design decision: `MaterialCommunityIcons.ttf` is 1.31 MB for about 15 glyphs. **Done in #3843** (owner chose subset fonts): both icon fonts are subsets of the 50 glyphs in use, measured store assets 3,054,980 to 1,397,878 B (-1,657,102 B) and store JS 6,190,131 to 5,960,039 B (-230,092 B).
- #3795 and #3820 cover the all-games JS ceiling and are not part of this plan.

## How it was measured

Same command as the CI step `android-bundle-check` ("Create Android JS bundle (store config)"), run from `frontend/`:

```bash
ENTRY_FILE=$(node -e "require('expo/scripts/resolveAppEntry')" . android absolute | tail -n 1)
EXPO_PUBLIC_API_URL=https://games-api.buffingchi.com EXPO_PUBLIC_TEST_HOOKS=0 \
  npx expo export:embed --platform android --dev false --entry-file "$ENTRY_FILE" \
    --bundle-output dist/index.android.bundle --assets-dest dist/assets
node scripts/size-report.mjs --bundle dist/index.android.bundle --assets dist/assets \
  --max-js 8388608 --warn-js 6291456 --max-assets 4194304 --forbid-hidden-assets --forbid-hidden-locales
```

Result: exit 0, 0 hidden-premium assets, 0 non-launch locale strings. JS is 6,168,672 B (5.88 MiB; warn line 6.0 MiB, so JS is also close, but it is out of scope here). Per-game sound ownership comes from each game's `src/game/<slug>/sounds.ts` `require` calls matched to Metro's flattened file names (`metroAssetName` in `frontend/scripts/size-report.mjs`). The all-games config was not rebuilt: it is #3795/#3820 territory.

## Measurement

MiB = 1,048,576 B. KB = 1,024 B.

### By type

| Type                                         | Files |     Bytes |     KB | Share |
| -------------------------------------------- | ----: | --------: | -----: | ----: |
| Fonts                                        |    14 | 2,775,824 | 2710.8 | 75.0% |
| Sounds (all `.ogg`)                          |    93 |   871,616 |  851.2 | 23.6% |
| Images: app logo (`assets/logo.png`)         |     1 |    38,541 |   37.6 |  1.0% |
| Images: libraries (react-navigation icons)   |    17 |     6,299 |    6.2 |  0.2% |
| Other (Android `raw/keep.xml`)               |     1 |     4,636 |    4.5 |  0.1% |
| Images: other (`assets/home/starswarm-tile`) |     1 |     2,698 |    2.6 |  0.1% |
| **Total**                                    |   127 | 3,699,614 |        |       |

### Fonts (2.65 MiB)

| File                                   |     Bytes | Used by `App.tsx` `useFonts`? |
| -------------------------------------- | --------: | ----------------------------- |
| `MaterialCommunityIcons.ttf`           | 1,307,660 | yes, 15 or so glyphs          |
| `MaterialIcons.ttf`                    |   356,840 | yes, 10 call sites            |
| Manrope 800 ExtraBold                  |    97,524 | **no**                        |
| Manrope 600 SemiBold                   |    96,936 | yes                           |
| Manrope 500 Medium                     |    96,904 | **no**                        |
| Manrope 400 Regular                    |    96,832 | yes                           |
| Manrope 700 Bold                       |    96,800 | yes                           |
| Manrope 300 Light                      |    96,728 | **no**                        |
| Manrope 200 ExtraLight                 |    96,700 | **no**                        |
| Space Grotesk 500 Medium               |    86,612 | **no**                        |
| Space Grotesk 300 Light                |    86,612 | **no**                        |
| Space Grotesk 400 Regular              |    86,588 | yes                           |
| Space Grotesk 600 SemiBold             |    86,572 | **no**                        |
| Space Grotesk 700 Bold                 |    86,516 | yes                           |
| **Never referenced (4 + 3 = 7 files)** |   647,652 | see below                     |

(The seven unused weights sum to 647,652 B. The measured before/after difference below is 648,186 B: the other 534 B is the Android `raw/keep.xml` resource list, which shrinks with the fonts.)

### Sounds by owner (store config, 93 files, 851 KB)

| Game or shared set                     | Files |   Bytes |    KB |
| -------------------------------------- | ----: | ------: | ----: |
| Yacht                                  |    28 | 256,944 | 250.9 |
| Sort (pour streams, win, etc.)         |    23 | 255,508 | 249.5 |
| Daily Word                             |    12 |  93,623 |  91.4 |
| 2048                                   |     8 |  70,572 |  68.9 |
| Freecell + Solitaire (shared)          |     5 |  62,011 |  60.6 |
| Sudoku                                 |     6 |  48,905 |  47.8 |
| Freecell + Hearts + Solitaire (shared) |     4 |  41,926 |  40.9 |
| Solitaire only                         |     3 |  17,423 |  17.0 |
| Blackjack + Solitaire (shared)         |     3 |  15,414 |  15.1 |
| Freecell only                          |     1 |   9,290 |   9.1 |

(Sum 871,616 B, equal to the by-type row. Hearts and Blackjack appear only in shared sets because their own sounds are hidden-premium and not in the store bundle.) The largest single sound is `riffle-loop.ogg` at 35,697 B; every packaged sound is under the 50 KB SFX budget in [ASSETS.md](../ASSETS.md#size-budgets). Average is 9.4 KB per sound.

### Ten largest packaged assets

| #   | Bytes     | File (Metro name under `dist/assets/`)                      |
| --- | --------- | ----------------------------------------------------------- |
| 1   | 1,307,660 | `raw/..._materialcommunityicons.ttf`                        |
| 2   | 356,840   | `raw/..._materialicons.ttf`                                 |
| 3   | 97,524    | `raw/..._manrope_800extrabold_manrope_800extrabold.ttf`     |
| 4   | 96,936    | `raw/..._manrope_600semibold_manrope_600semibold.ttf`       |
| 5   | 96,904    | `raw/..._manrope_500medium_manrope_500medium.ttf`           |
| 6   | 96,832    | `raw/..._manrope_400regular_manrope_400regular.ttf`         |
| 7   | 96,800    | `raw/..._manrope_700bold_manrope_700bold.ttf`               |
| 8   | 96,728    | `raw/..._manrope_300light_manrope_300light.ttf`             |
| 9   | 96,700    | `raw/..._manrope_200extralight_manrope_200extralight.ttf`   |
| 10  | 86,612    | `raw/..._spacegrotesk_500medium_spacegrotesk_500medium.ttf` |

The largest non-font file is `drawable-mdpi/assets_logo.png` (38,541 B), then `assets_sounds_riffleloop.ogg` (35,697 B), `assets_sounds_cardgamewon.ogg` (26,345 B) and `assets_sounds_yachtwin.ogg` (22,900 B). The top 14 files are all fonts.

### Unreferenced and "not bundled" files

The issue says the audit counts 39 "present but not bundled" files. The audit has been edited since (44, then 32, then edits by #3638 and #3711), and **none of them was in `dist/assets`**. Checked two ways: `node frontend/scripts/list-bundled-assets.mjs` listed 6 files under `frontend/assets/` that no code referenced (two more were deleted earlier: `sounds/freecell-invalid-move.mp3`, 25,584 B, in #3870 (part of #3845), and `sounds/freecell-game-win.mp3`, 87,960 B, in #3871), and none of those names appears in the store `dist/assets` (which contains no `.mp3` at all). The 24 icon masters in `cascade_icon_masters/` (10,352 KB on disk) are at the repo root, outside `frontend/`, so Metro cannot reach them. Answer: no, none of them was bundled after all.

The six were then deleted in two steps. #3885 (#3578 cleanup) deleted `sounds/hearts-moon-shot.mp3` and `sounds/solitaire-invalid-move.ogg`; #3845 (owner decision, #3881) deleted the other four. `list-bundled-assets.mjs` now reports 0 unreferenced files under `frontend/assets/`, and the "present but not bundled" figure is the 24 icon masters only (it was 30 with the six). Packaged assets are unchanged: the bundled count stays 299 and shipped stays 334.

| File (under `frontend/assets/`)     |   Bytes | Deleted in | Note                                                            |
| ----------------------------------- | ------: | ---------- | --------------------------------------------------------------- |
| `sounds/hearts-moon-shot.mp3`       | 321,024 | #3885      | Third-party. Blackjack dropped it in #3581; Sudoku until #3775. |
| `celestial-icons/milkyway.webp`     |  47,058 | #3845      | Cascade, not in any theme list                                  |
| `cosmos-baked/milkyway.png`         |  37,760 | #3845      | Cascade, not in any theme list                                  |
| `fruits-baked/pumpkin.png`          |  16,162 | #3845      | Cascade, not in any theme list                                  |
| `sounds/solitaire-invalid-move.ogg` |   5,956 | #3885      | Replaced by shared `card-invalid-move.ogg`                      |
| `fruit-icons/pumpkin.webp`          |   4,856 | #3845      | Cascade, not in any theme list                                  |
| **Total**                           | 432,816 |            |                                                                 |

#3845's four files total 47,058 + 37,760 + 16,162 + 4,856 = 105,836 B; #3885's two total 321,024 + 5,956 = 326,980 B.

Deleting them saved **0 B of packaged assets** (they shipped nowhere) and 433 KB of repo weight.

The mp3 loops that do exist are all hidden-premium and absent from the store bundle: `mahjong-bg-1/2/3.mp3` (5,020,151 + 2,356,497 + 3,117,601 = 10,494,249 B, 128 kbps stereo, third-party) and `starswarm-bgm.mp3` (6,604,461 B, 6:52 at 24 kHz stereo 128 kbps, original). They are 17.1 MB of the all-games config and matter for the premium launch re-budget, not today's store number.

## Cheap wins, ranked

Savings are against today's 3,699,614 B. "Approve" is what the owner must sign off on.

| Rank | Win                                                                  | Saves (B)                        | Risk                   | Approve                                          |
| ---- | -------------------------------------------------------------------- | -------------------------------- | ---------------------- | ------------------------------------------------ |
| 1    | Import only the 5 used Manrope/Space Grotesk weights by subpath      | **648,186 (measured)**           | None audible; low code | Nothing audible. Normal review.                  |
| 2    | Replace `MaterialCommunityIcons` with a subset font or MaterialIcons | about 1.25 MB (est.)             | Medium, visual         | Owner sees every swapped icon; glyph mapping     |
| 3    | Subset `MaterialIcons.ttf` to the glyphs used (10 call sites)        | about 330 KB (est.)              | Low-medium, visual     | Same icon review as #2                           |
| 4    | Re-encode packaged `.ogg` SFX at lower quality                       | about 100-170 KB (est.)          | Audible, no code       | Owner's audition of the whole set                |
| 5    | Trim variant counts (3 to 2) where variants are near-identical       | about 50-90 KB (est.)            | Audible, design        | Owner's audition                                 |
| 6    | Delete the 8 unreferenced files                                      | 0 (repo only)                    | None to the build      | Owner (rights audit row changes)                 |
| 7    | Re-encode hidden-premium mp3 loops (all-games config only)           | 0 store; 5-9 MB all-games (est.) | Audible                | Owner's audition; defer to the premium re-budget |
| 8    | Move background loops out of the base bundle                         | 0 store (already absent)         | n/a                    | Only for the premium launch                      |

### 1. Subpath font imports (measured)

`frontend/App.tsx` calls `useFonts` with five fonts (Space Grotesk 400 and 700, Manrope 400, 600, 700) but imports them from the package barrels `@expo-google-fonts/space-grotesk` and `@expo-google-fonts/manrope`. A barrel `index.js` `require`s every weight's `.ttf`, so Metro packages all 12. The packages ship per-weight subpaths (`@expo-google-fonts/manrope/400Regular`, and so on), which pull only that file.

Verified, then reverted (no change is in this PR): replacing the two import blocks in `App.tsx` with five subpath imports and re-running the store bundle gave **packaged assets 3,051,428 B (2.91 MiB, 120 files), down 648,186 B and 7 files**, JS 6,162,862 B (-5,810 B). Weights actually used (4 or more call sites each): Manrope 400/600/700 and Space Grotesk 400/700. Nothing else references the other weights (`grep` over `src/` and `App.tsx`). The visible output is identical because the unused files were never requested at run time.

Follow-up story to file: "Load only the used Google font weights", one file (`App.tsx`), plus a guard test or a `size-report.mjs` check that fails if an unused-weight file name is packaged.

### 2 and 3. Icon fonts (estimate, needs a design decision)

> **Done in #3843 (2026-11-14).** Option (a) for both fonts: 20 MaterialCommunityIcons and 30 MaterialIcons glyphs, generated by `tools/assets/subset_icon_fonts.py` into `frontend/assets/fonts/`, loaded through `createIconSet` in `frontend/src/components/icons/`. MaterialCommunityIcons 1,307,660 to 3,708 B, MaterialIcons 356,840 to 3,796 B; the estimate below undercounted the glyphs (50, not about 15) but not the saving. Measured numbers are in [PERFORMANCE.md: Measurements](../PERFORMANCE.md#measurements-2026-10-10). No native change was needed.

`MaterialCommunityIcons.ttf` is 1,307,660 B (35% of all packaged assets) and serves about 15 glyphs (`trophy-outline`, `minus-circle-outline`, `equal`, `check-circle-outline`, `play-circle-outline`, `exit-to-app`, `flag-outline`, `podium`, `home-outline`, `hand-back-right`, `numeric-2-circle-outline`, ...) in 8 files. Options: (a) generate a subset font with `fonttools`/`pyftsubset` and register it with `createIconSet` (a few KB; no visual change; needs a repeatable script and a test that every used glyph name is in the subset), or (b) switch those call sites to `MaterialIcons` (one font fewer, some glyphs differ visually). (a) is the safe one. `MaterialIcons.ttf` (356,840 B, 10 call sites) can be subset the same way. This also touches the iOS bundle (same Metro assets), so check both stores. Not done here: it is app code and a visual change.

### 4 and 5. Lower-quality `.ogg`, fewer variants (estimate, audible)

Sounds are already small (avg 9.4 KB) so the gain is limited. A Vorbis quality step down might take 10-20% off 851 KB. Yacht and Sort are the two big sets (251 and 250 KB); Sort has three near-sized `sort-pour-stream-N-uM` tiers. Both change what players hear, so they go through the owner's audition. Recommend not doing these until #1 has landed: with it the budget is no longer tight.

### 6. Unreferenced files

Listed above. Delete in one cleanup PR once the owner approves, updating `docs/audits/ASSET-RIGHTS-AUDIT.md`. No effect on packaged size.

### 7 and 8. Background loops

The issue asks whether BGM must ship in the base bundle. In the store config it does not: no loop is packaged today (guarded by `--forbid-hidden-assets`). When the premium games un-hide, the 17.1 MB of mp3 (Mahjong 10.5 MB, Star Swarm 6.6 MB) breaks the 4 MiB limit by design, and that launch needs the deliberate re-budget [PERFORMANCE.md](../PERFORMANCE.md#enforced-budgets) already describes. Options then: re-encode (128 kbps stereo to 64 kbps is about -50% for the same length; Star Swarm is already 24 kHz), ship loops as on-demand downloads (Play Asset Delivery / on-demand resources, which is a native release-pipeline change), or accept a larger store budget. Decide with the premium-launch epic, not here.

## CI warning at about 3.75 MiB

How it works today: the "Size budgets" step in the `android-bundle-check` job runs `frontend/scripts/size-report.mjs` with `--max-assets 4194304`. The script's `evaluate()` has a warn path for JS (`--warn-js`) that prints `WARNING:` and `::warning::` annotations and exits 0, but none for assets. The PR comment (a separate shell step) only states the hard limit in its table.

Smallest change, in two parts:

1. **Done in this PR (script only):** `size-report.mjs` gains `--warn-assets <bytes>`. It warns (exit 0, `::warning::` annotation, `status=warn` in the GitHub output) when packaged assets exceed the value, and says nothing extra when `--max-assets` already fails. Tests in `frontend/scripts/size-report.test.mjs` (the existing "evaluate" test) cover below, at, between and above the two limits. The flag is **inert until the workflow passes it**.
2. **Follow-up (workflow file, deliberately not changed here):** add `--warn-assets 3932160 \` after `--max-assets 4194304 \` in the "Size budgets" step of `.github/workflows/ci.yml`, and change the PR-comment cell `4.0 MiB hard` to `4.0 MiB hard, 3.75 MiB warn`. No new permissions, no new actions. Edits to `ci.yml` are security-sensitive, so it needs its own owner-approved PR.

Note: with today's 3.53 MiB the warning would not fire yet; it would fire after about 0.22 MiB of additions. After the font fix (2.91 MiB) there would be 0.84 MiB before it fires.

## What the owner needs to decide

1. Approve the subpath-font story (rank 1). No audition needed.
2. Decide whether to subset or replace the icon fonts (ranks 2-3), and if so which approach.
3. Approve a cleanup PR for the 8 unreferenced files (rank 6) and the rights-audit edit.
4. Approve a follow-up PR that adds `--warn-assets 3932160` to `ci.yml`.
5. Accept the budget rule in PERFORMANCE.md (per-file and per-set numbers are proposals, tighter than ASSETS.md for store-visible files).
6. Premium-launch audio (ranks 7-8): defer to the premium re-budget.
7. The issue's acceptance line "packaged assets back under about 3.3 MB" is met by rank 1 alone once it ships (2.91 MiB).
