# Mahjong renderer split: why it exists and whether to unify it (#3707)

Status: research, no code changes. Date: 2026-11-13. Evidence is cited as files, commits (short SHAs) and PRs/issues. Anything that could not be checked from the repo is marked **Unverified**.

## Summary

- The split is **inherited, not decided for Mahjong**. It was copied from Star Swarm, which copied it from Cascade (then "Fruit Merge"). The CanvasKit/WASM hypothesis is **partly confirmed**: it is the reason the _pattern_ exists, but no document or commit says Mahjong was weighed against it.
- Unifying on Skia means shipping CanvasKit to web: per open PR #3732, **8.08 MB raw / 3.25 MB gzip** of `canvaskit.wasm`, plus a CSP change. That cost is only acceptable because Cascade is already paying it.
- Camera, zoom and the mini-map are **not** duplicated. They are React Native views and Reanimated shared values outside the canvas. The duplication is the tile drawing, face rasterising and motion drawing (about 1,375 lines in `TileNode.tsx` + `tileFaces.ts` + `GameCanvas.web.tsx`).
- The testing gap is smaller than the issue says. Maestro already uploads every named screenshot on pass or fail (#3705), on both Android and iOS. What is missing is a **deterministic board** and a **comparison**, not an upload.
- **Recommendation:** option (a), plus a small step toward (c). Do not unify on Skia now.

## 1. Why was it split?

**History** (`git log --follow` on both files; the repo's history was shallow in this checkout and was unshallowed to read it):

| Date       | Commit                      | What                                                                                                                                                                                                                                       |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-03-21 | `fa253b30f`                 | Fruit Merge added with an HTML canvas                                                                                                                                                                                                      |
| 2026-03-27 | `104e740b5`                 | Fruit Merge moved to Skia "so it renders on iOS, Android, and Web from a single codebase"                                                                                                                                                  |
| 2026-03-27 | `c015a158d`                 | Same day: `GameCanvas.web.tsx` added, "Metro picks this automatically on web; GameCanvas.tsx/Skia used on native". Also "Remove app.json Skia plugin entry (Skia 2.4.18 has no app.plugin.js, caused PluginError on npx expo start --web)" |
| 2026-04-25 | `a03f463ef` (#801, PR #866) | Star Swarm: "Use `cascade/GameCanvas.tsx` and `GameCanvas.web.tsx` as the direct implementation reference"                                                                                                                                 |
| 2026-04-26 | `31e646cd4` (#873, PR #908) | Mahjong: AC says "mirroring the Star Swarm split"                                                                                                                                                                                          |

So Skia-on-web was tried first (`104e740b5`) and backed out within the day (`c015a158d`). The only recorded reason is the web start failing on the Skia Expo plugin, and the commit does not mention CanvasKit. **Verdict:** the CanvasKit/WASM hypothesis is consistent with the evidence and with how Skia 2.x works on web (PR #3732: "Skia's web module reads `global.CanvasKit`"), but **no commit, issue or doc states it as the reason**. For Mahjong specifically the stated reason is "mirror Star Swarm" (#873).

The rule is now written down as a standard: `docs/GAMEPLAY_STANDARDS.md` §6 says a Skia game "must maintain a parallel web implementation (`GameCanvas.web.tsx`) using Canvas2D", with the same hit-test math, driven by the same layout function (also the checklist at line 662). `docs/games/mahjong.md` (line 161) only records the fact ("Native rendering uses Skia; web uses Canvas2D"), not a rationale.

Mahjong's native canvas became large through later work: #2962 (per-tap cost: memoised `TileNode`, cached `SkImage` faces), #3611 (code-drawn faces), #3613 (motion).

## 2. What would unifying cost?

**CanvasKit on web (precedent, open).** PR #3732 ("render Cascade on web through CanvasKit, with a Playwright smoke") is open, not merged. Its numbers:

| What                  | Raw         | gzip        | When                                         |
| --------------------- | ----------- | ----------- | -------------------------------------------- |
| `canvaskit.wasm`      | 8,076,553 B | 3,246,406 B | first Cascade open on web only, cached after |
| `CascadeRoute` chunk  | 124,717 B   | 37,713 B    | when Cascade opens                           |
| `CascadeScreen` chunk | 681,063 B   | 166,321 B   | after CanvasKit loads                        |

It also needs: a lazy route split (`CascadeRoute.web.tsx`) because Skia's web module reads `global.CanvasKit` at first evaluation; a retryable loader with a 60 s timeout; `canvaskit-wasm` 0.41.0 as a direct dependency pinned to Skia's; accessibility props moved onto a wrapping `View` (Skia's web Canvas drops them); and `'wasm-unsafe-eval'` in the CSP (`render.yaml` dev header; prod header at `render.yaml:101` has no such token). As of this checkout, `docs/games/cascade.md:99` says "Cascade does not render on web yet", and `frontend/package.json` has no `canvaskit-wasm`. There is **no merged precedent on dev**.

**Bundle guard.** The guard in `docs/PERFORMANCE.md` ("Store Size: Current Budgets") measures the **Android store bundle** (JS 8 MiB hard limit, 6 MiB warn). It does not cover web, and web has no size budget in `ci.yml` (the e2e job only runs `npx expo export --platform web`). The WASM would not count against the store budget, but #3732 adds a Metro rule to keep Cascade's route out of store bundles (`frontend/metro/storeBundle.js`). Mahjong is also stubbed out of store bundles (it is a hidden game, `HIDDEN_GAME_SCREENS.mahjong`), so web is where Mahjong's renderer matters most today.

**Performance.** **Unverified.** No measurement of Skia-on-web on mid-range Android browsers or desktop exists in the repo. `docs/PERFORMANCE.md` notes Cascade's device rendering is itself unverified. CanvasKit is WebGL-backed; Mahjong redraws only while something animates, which the 2D path already does cheaply.

**Feature comparison.**

| Feature                                  | Native (Skia)                                                                          | Web (Canvas2D)                                                  | Shared?                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| Camera, zoom, pan, refit                 | `useBoardZoomPan` (Reanimated, RN gestures)                                            | same                                                            | shared, outside the canvas         |
| Mini-map (#3612)                         | `MahjongMiniMap.tsx` (RN views)                                                        | same                                                            | shared                             |
| Layout, hit-test math, `boardResolution` | `game/mahjong/layout.ts`, `zoom.ts`                                                    | same                                                            | shared                             |
| Colours                                  | `theme/theme.mahjong`                                                                  | same                                                            | shared                             |
| Look maths (lift, glow, spark paths)     | `game/mahjong/motion.ts` (worklets)                                                    | same functions, plain                                           | shared                             |
| Tile drawing                             | `TileNode.tsx`, 559 lines, per-tile memoised nodes                                     | `drawTile*`, in a 577-line file, one redraw pass                | **duplicated**                     |
| Face art                                 | Skia SVG parse then CPU-rasterised `SkImage` (`tileFaces.ts`, 239 lines), 4-size cache | `new window.Image()` from asset URIs (`tileAssetLoader.web.ts`) | **duplicated, different decoders** |
| Animation driving                        | `useDerivedValue` on the UI thread                                                     | RAF redraw while `isMoving`                                     | **duplicated**                     |
| Test                                     | `GameCanvas.native.test.tsx` (Skia stubbed, no pixels)                                 | `GameCanvas.test.tsx` + Playwright `mahjong-*.spec.ts`          | n/a                                |

The difference that causes bugs like #3684 is the face decoder: the web build never runs Skia's SVG parser or `Skia.Surface`, so rasterising faults cannot reproduce there. Unifying on Skia would remove that blind spot; keeping the split cannot.

## 3. Do other games split the same way?

Only the Skia games, and each is different.

| Game                | Renderer                                                       | Split?                                                                                                                  | Evidence                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mahjong             | Skia / Canvas2D                                                | yes                                                                                                                     | `components/mahjong/GameCanvas{,.web}.tsx`                                                                                                                                                                        |
| Star Swarm          | Skia / Canvas2D                                                | yes, 1,287 vs 1,419 lines                                                                                               | `components/starswarm/GameCanvas{,.web}.tsx`; shared plain-data `DrawOp` display list in `game/starswarm/render/` (`docs/games/starswarm.md:750`: "the web canvas replays the same ops, so the two cannot drift") |
| Cascade             | Skia                                                           | was split, now not: the web file was byte-identical to native and deleted in `16fc501ec`; web shows nothing until #3732 | `docs/games/cascade.md:99`                                                                                                                                                                                        |
| Solitaire, FreeCell | React Native views, Reanimated (`CardView`, `cardFlights.tsx`) | no canvas, no split                                                                                                     | `docs/games/solitaire.md`, `freecell.md`; no `@shopify/react-native-skia` import in their components                                                                                                              |

Only `LanguageSwitcher.web.tsx` is another `.web.tsx` under `components/`. The app-wide pattern is therefore "RN views by default; Skia where element count or per-frame redraw demands it; Canvas2D mirror on web". Star Swarm's shared display list is the closest in-repo model for sharing logic across the two backends. Cascade's #3732 is the only precedent for Skia on web.

## 4. Options

Effort is in story-sized units (S about 1 day, M about 3 days, L about 1 to 2 weeks of agent plus review time). These are estimates, not measurements.

| Option                                                          | What                                                                                                                                                                        | Effort                          | Risk                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a)** Keep split, add parity harness                          | A deterministic Mahjong board in Maestro, Playwright screenshots of the same board, and a side-by-side check                                                                | M                               | Low. Catches drift by eye or by loose diff; never exact, since Skia and Canvas2D anti-alias differently                                                                                                                                               |
| **(b)** Unify on Skia                                           | Mahjong joins Cascade on CanvasKit; delete `GameCanvas.web.tsx`, `tileAssetLoader.web.ts`                                                                                   | L, and blocked on #3732 merging | High. Adds a first-load WASM of about 3.25 MB gzip to a game that today loads none; CSP change reaches prod when Mahjong is unhidden; Skia-on-web a11y workaround; no perf data; every Playwright mahjong spec may need rework for a CanvasKit canvas |
| **(c)** One drawing description, two backends                   | Move per-tile rect, shadow, side and glow geometry into a pure function that returns ops (like Star Swarm's `DrawOp`); Skia replays into nodes, Canvas2D replays into `ctx` | L                               | Medium. `TileNode` is memoised per tile on purpose (#2962); a flat op list can lose that win unless ops are grouped per tile. Face art stays per-backend                                                                                              |
| **(d)** Make web a faithful preview with Skia headless in tests | Run the native drawing through CanvasKit in Node (as the #2960 Cascade comparison did, "pixel-identical" on real engine states) and compare it to a stored image            | M                               | Medium. Needs `canvaskit-wasm` as a dev dependency (#3732 adds it) and a Jest setup that runs real Skia instead of the stubs; would test the real raster path of #3684, but not the iOS GPU path                                                      |

(d) is the only option that tests the iOS blur class of bug without a device, but a headless CPU raster would not show a device-specific scaling defect, so it complements (a), it does not replace it.

## 5. Testing gap: native screenshots and recordings in CI

The issue says screenshots upload only on failure. That is out of date.

- **Already working** (`docs/MAESTRO.md` lines 55 to 66, `.github/workflows/mobile-smoke-android.yml:308-338`, `mobile-smoke-ios.yml:352-382`): the `maestro-{android,ios}-media` artifact uploads every named `takeScreenshot` and `startRecording` file on pass or fail (since #3705), kept 14 days. iOS runs Maestro 2.12.1 on a `macos-26` simulator; Android runs 1.39.13 on an API 34 emulator.
- **Mahjong already takes one:** `e2e/maestro/flows/mahjong/smoke.yaml` ends with `takeScreenshot: mahjong-smoke`, after tapping the hint button. So a Mahjong native image exists on every run that includes the Mahjong flow.
- **Why it is not enough:**
  1. The board is **not deterministic**. The flow taps the Turtle layout and does not pin a seed (Solitaire and FreeCell do, via `EXPO_PUBLIC_TEST_HOOKS`; `docs/MAESTRO.md` "Deterministic deals"). The engine supports `setRng(createSeededRng(seed))` (`game/mahjong/engine.ts:9`) and a `drawDealSeed` (`:572`), but nothing wires a test-build seed into the deal. **Unverified:** the exact hook point in `MahjongScreen.tsx`.
  2. The hint tap puts a glow animation in the screenshot, so the frame depends on timing.
  3. **Nothing compares** the image to anything. Maestro 1.39 and 2.12 have no baseline compare in these workflows; **Unverified** whether either version's built-in assertion could be used.
  4. The iOS leg runs on PRs into `dev` **only for native changes** (`docs/MAESTRO.md` rule 3, #3547), so a JS-only Mahjong change gets Android only. The iOS leg is where #3684 showed up. iOS costs about $6.40/month (about 12 times Android), and the iOS Release build takes about 27 minutes, per `docs/MAESTRO.md`.
  5. Nobody opens the artifact. It is not posted to the PR.
- **Path:** (i) add a test-build seed and a fixed layout to Mahjong; (ii) make `mahjong/smoke.yaml` take a screenshot before any tap, plus one zoomed in; (iii) add a Mahjong-only dispatch like `flows: cascade-demo` (`docs/MAESTRO.md`, "Cascade demo flows"), so iOS can be run on demand against a JS-only PR without paying for every PR; (iv) post the images on the PR or open them from the design-review gate (`.claude/skills/ship-story/references/design-review.md`); (v) optionally store a baseline and compare with a loose threshold. Note that Cascade's #3705 demos already follow steps (iii) and (iv).
- iOS simulator capture also exists outside Maestro: `mobile-smoke-ios.yml:328` already runs `xcrun simctl io "$SIM_UDID" screenshot` at the end.

## Recommendation

**Do (a), and prepare (c); do not do (b) now.**

Why:

1. The duplication that hurts (#3612's mismatch, #3684) is a **visual check** problem first. The shared code (`motion.ts`, `layout.ts`, `zoom.ts`, theme, camera, mini-map) already holds most behaviour; what remains is drawing, which is the part a screenshot harness checks best.
2. (b) trades a recurring cost (two drawing paths) for a bigger one-off and per-load cost on a platform the project calls secondary ("Web ... is not a revenue platform", `CLAUDE.md`). It also depends on #3732 merging, and on a Skia-on-web performance and accessibility story that nobody has measured.
3. Revisit (b) **after #3732 is in and Cascade web has real-use data** (wasm cache hit rate, load failures reported to Sentry, load time). If those are fine, Mahjong joining CanvasKit becomes mostly deletion.
4. (c) is the right long-term shape if the owner wants to keep Canvas2D, and Star Swarm already proves it works. Do it only for tile geometry, and only if a parity harness shows continued drift.

**Rough cost:** (a) about 1 to 1.5 weeks including one iOS run to validate; no new runtime cost; CI cost is one extra iOS dispatch per visual Mahjong change. (c) about 1 to 2 weeks on top. (b) 1 to 2 weeks plus CSP, perf and a11y work, and a permanent 3.25 MB gzip first-load on web.

## Proposed follow-up stories (not created)

1. **Mahjong: deterministic board in test builds.** Under `EXPO_PUBLIC_TEST_HOOKS`, deal a fixed layout and seed (as Solitaire and FreeCell do), so Maestro and Playwright render the same tiles.
2. **Maestro: Mahjong still and zoomed screenshots.** Extend `e2e/maestro/flows/mahjong/smoke.yaml` (or add a `demo`-tagged flow) to capture the untouched board and a zoomed board on Android and iOS; add a `flows: mahjong-demo` dispatch on both legs.
3. **Playwright: same-board Mahjong screenshots on web.** Capture the same seed and layout on the web build and write them to a CI artifact for side-by-side review.
4. **CI: show Mahjong media on the PR.** Post or link the `maestro-*-media` images and the Playwright images on visual Mahjong PRs.
5. **Mahjong: headless Skia raster test of the native tile art.** Use CanvasKit in Jest (or Node) to rasterise `tileFacesFor` at real sizes and fail on faces that come out blank or blurred beyond a threshold (the #3684 class).
6. **Research: re-evaluate Mahjong on CanvasKit after #3732.** One short write-up with real load-time, failure and cache numbers from Cascade web; decides (b).
7. **Mahjong: shared tile geometry (only if drift continues).** Extract tile body, side and shadow geometry into one pure function used by both backends, keeping `TileNode`'s per-tile memoisation.

## Unverified

- Why Mahjong was not tried on Skia-on-web in April 2026: only "mirror Star Swarm" is recorded (#873).
- Skia-on-web performance and CanvasKit load time on mid-range Android and browsers: no repo data.
- Whether #3732 merges as written, and the production CSP plan (`render.yaml:101` today has no `'wasm-unsafe-eval'`; the PR says prod is unchanged until #3703).
- Whether either pinned Maestro version can compare screenshots against a baseline.
- The right hook point for a test-build Mahjong seed in `MahjongScreen.tsx`.
- The effort figures in section 4 are estimates.
