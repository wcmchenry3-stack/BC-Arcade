# Mahjong renderer split: why it exists and whether to unify it (#3707)

Status: research, no code changes. Date: 2026-11-13. Evidence is cited as files, commits (short SHAs) and PRs/issues. Anything that could not be checked from the repo is marked **Unverified**.

## Summary

- The split is **inherited, not decided for Mahjong**. It was copied from Star Swarm, which copied it from Cascade (then "Fruit Merge"). The CanvasKit/WASM hypothesis is **partly confirmed**: it is the reason the _pattern_ exists, but no document or commit says Mahjong was weighed against it.
- Unifying on Skia means shipping CanvasKit to web: per open PR #3732, **8.08 MB raw / 3.25 MB gzip** of `canvaskit.wasm`, plus a CSP change. That cost is only acceptable because Cascade is already paying it.
- Camera, zoom and the mini-map are **not** duplicated. They are React Native views and Reanimated shared values outside the canvas. The duplication is the tile drawing, face rasterising and motion drawing (about 1,375 lines in `TileNode.tsx` + `tileFaces.ts` + `GameCanvas.web.tsx`).
- The testing gap is smaller than the issue says. Maestro already uploads every named screenshot on pass or fail (#3705), on both Android and iOS. What is missing is a **deterministic board** and a **comparison**, not an upload.
- **Recommendation:** option (a), plus a small step toward (c). Do not unify on Skia now.

## 1. Why was it split?

**History** (`git log --follow` on both files):

| Date       | Commit                      | What                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-21 | `fa253b30f`                 | Fruit Merge added with an HTML canvas                                                                                                                                                                                                                                                                             |
| 2026-03-27 | `104e740b5`                 | Fruit Merge moved to Skia (commit message: "so fruit-merge now renders correctly on iOS, Android, and Web from a single codebase")                                                                                                                                                                                |
| 2026-03-27 | `c015a158d`                 | Same day: `GameCanvas.web.tsx` added (message: "Metro picks this automatically on web; GameCanvas.tsx/Skia used on native"). The message gives no reason for adding it. The same commit removes the `app.json` Skia plugin entry ("Skia 2.4.18 has no app.plugin.js, caused PluginError on npx expo start --web") |
| 2026-04-25 | `a03f463ef` (#801, PR #866) | Star Swarm. The #801 issue body (not the commit message) says: "Use `cascade/GameCanvas.tsx` and `GameCanvas.web.tsx` as the direct implementation reference"                                                                                                                                                     |
| 2026-04-26 | `31e646cd4` (#873, PR #908) | Mahjong. The #873 issue body's acceptance criteria (not the commit message) say "mirroring the Star Swarm split"                                                                                                                                                                                                  |

So Skia-on-web was tried first (`104e740b5`) and a Canvas2D web file was added the same day (`c015a158d`). That commit records no reason for the web file. The only related fact in it is the removal of the `app.json` Skia plugin entry, which caused a PluginError on `expo start --web`; it does not mention CanvasKit. **Verdict:** the CanvasKit/WASM hypothesis is consistent with the evidence and with how Skia 2.x works on web (PR #3732: "Skia's web module reads `global.CanvasKit`"), but **no commit, issue or doc states it as the reason**. For Mahjong specifically the stated reason is "mirror Star Swarm" (#873).

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

**Bundle guard.** The guard in `docs/PERFORMANCE.md` ("Store Size: Current Budgets") measures the **Android store bundle** (JS 8 MiB hard limit, 6 MiB warn). It does not cover web, and web has no size budget in `ci.yml` (web does have Lighthouse thresholds, `docs/PERFORMANCE.md:87-93`, all warn-only except accessibility) (the e2e job only runs `npx expo export --platform web`). The WASM would not count against the store budget, but #3732 adds a Metro rule to keep Cascade's route out of store bundles (`frontend/metro/storeBundle.js`). Mahjong is also stubbed out of store bundles (it is a hidden game, `HIDDEN_GAME_SCREENS.mahjong`), so web is where Mahjong's renderer matters most today.

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

The web build cannot exercise Skia's SVG parser or `Skia.Surface` at all: its faces come from the browser's image decoder. So any bug in the native-only paths cannot show on web. The cause of #3684's blur is **unverified**: its comments say faces are rasterised at `PixelRatio` x `boardResolution`, "so on paper the faces are drawn at full resolution", and name the leading hypothesis as iOS shrinking the oversized canvas layer by `1/res` (a view transform in `GameCanvas.tsx`) with no mipmaps. The faded half was a shared-theme tint, fixed in #3685. Unifying on Skia would let web run the same Skia paths, but would not by itself reproduce an iOS layer-scaling issue.

## 3. Do other games split the same way?

Only the Skia games, and each is different.

| Game                | Renderer                                                       | Split?                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mahjong             | Skia / Canvas2D                                                | yes                                                                                                                                                                                                                                                       | `components/mahjong/GameCanvas{,.web}.tsx`                                                                                                                                                                        |
| Star Swarm          | Skia / Canvas2D                                                | yes, 1,287 vs 1,419 lines                                                                                                                                                                                                                                 | `components/starswarm/GameCanvas{,.web}.tsx`; shared plain-data `DrawOp` display list in `game/starswarm/render/` (`docs/games/starswarm.md:750`: "the web canvas replays the same ops, so the two cannot drift") |
| Cascade             | Skia                                                           | was split, now not: `components/cascade/GameCanvas.web.tsx` was Canvas2D when added (`c015a158d`), was edited until 2026-05 (`627b0456d`), and was byte-identical to the native Skia file by `16fc501ec`, which deleted it; web shows nothing until #3732 | `docs/games/cascade.md:99`                                                                                                                                                                                        |
| Solitaire, FreeCell | React Native views, Reanimated (`CardView`, `cardFlights.tsx`) | no canvas, no split                                                                                                                                                                                                                                       | `docs/games/solitaire.md`, `freecell.md`; no `@shopify/react-native-skia` import in their components                                                                                                              |

Only `LanguageSwitcher.web.tsx` is another `.web.tsx` under `components/`. The app-wide pattern is therefore "RN views by default; Skia where element count or per-frame redraw demands it; Canvas2D mirror on web". Star Swarm's shared display list is the closest in-repo model for sharing logic across the two backends. Cascade's #3732 is the only precedent for Skia on web.

## 4. Options

Effort is in story-sized units (S about 1 day, M about 3 days, L about 1 to 2 weeks of agent plus review time). These are estimates, not measurements.

| Option                                                          | What                                                                                                                                                                        | Effort                                                             | Risk                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a)** Keep split, add parity harness                          | A deterministic Mahjong board in Maestro, Playwright screenshots of the same board, and a side-by-side check                                                                | M for the harness; the whole follow-up set is about 1 to 1.5 weeks | Low. Catches drift by eye or by loose diff; never exact, since Skia and Canvas2D anti-alias differently                                                                                                                                               |
| **(b)** Unify on Skia                                           | Mahjong joins Cascade on CanvasKit; delete `GameCanvas.web.tsx`, `tileAssetLoader.web.ts`                                                                                   | L, and blocked on #3732 merging                                    | High. Adds a first-load WASM of about 3.25 MB gzip to a game that today loads none; CSP change reaches prod when Mahjong is unhidden; Skia-on-web a11y workaround; no perf data; every Playwright mahjong spec may need rework for a CanvasKit canvas |
| **(c)** One drawing description, two backends                   | Move per-tile rect, shadow, side and glow geometry into a pure function that returns ops (like Star Swarm's `DrawOp`); Skia replays into nodes, Canvas2D replays into `ctx` | L                                                                  | Medium. `TileNode` is memoised per tile on purpose (#2962); a flat op list can lose that win unless ops are grouped per tile. Face art stays per-backend                                                                                              |
| **(d)** Make web a faithful preview with Skia headless in tests | Run the native drawing through CanvasKit in Node (as the #2960 Cascade comparison did, "pixel-identical" on real engine states) and compare it to a stored image            | M                                                                  | Medium. Needs `canvaskit-wasm` as a dev dependency (#3732 adds it) and a Jest setup that runs real Skia instead of the stubs; would test the real raster path of the faces, but not how iOS scales the canvas layer (the leading #3684 hypothesis)    |

(d) would test the faces' raster for the first time, but not the iOS downscale of the canvas layer, so it complements native screenshots and never replaces them.

## 5. Testing gap: native screenshots and recordings in CI

The issue says screenshots upload only on failure. That is out of date.

- **Already working** (`docs/MAESTRO.md` lines 55 to 66, `.github/workflows/mobile-smoke-android.yml:308-327`, `mobile-smoke-ios.yml:352-373`): the `maestro-{android,ios}-media` artifact uploads every named `takeScreenshot` and `startRecording` file on pass or fail (since #3705), kept 14 days. iOS runs Maestro 2.12.1 on a `macos-26` simulator; Android runs 1.39.13 on an API 34 emulator.
- **Mahjong already takes one:** `e2e/maestro/flows/mahjong/smoke.yaml` ends with `takeScreenshot: mahjong-smoke`, after tapping the hint button. So a Mahjong native image exists on every run that includes the Mahjong flow.
- **Why it is not enough:**
  1. The board is **not deterministic**. The flow taps the Turtle layout and does not pin a seed (Solitaire and FreeCell do, via `EXPO_PUBLIC_TEST_HOOKS`; `docs/MAESTRO.md` "Deterministic deals"). The engine supports `setRng(createSeededRng(seed))` (`game/mahjong/engine.ts:87`) and a `drawDealSeed` (`:572`), but nothing wires a test-build seed into the deal. **Unverified:** the exact hook point in `MahjongScreen.tsx`.
  2. The hint tap puts a glow animation in the screenshot, so the frame depends on timing.
  3. **Nothing compares** the image to anything. Maestro 1.39 and 2.12 have no baseline compare in these workflows; **Unverified** whether either version's built-in assertion could be used.
  4. The iOS leg runs on PRs into `dev` **only for native changes** (`docs/MAESTRO.md` rule 3, #3547), so a JS-only Mahjong change gets Android only. #3684 was reported on iOS. iOS costs about $6.40/month (about 12 times Android), and setup, CocoaPods and the Release build take about 27 minutes, per `docs/MAESTRO.md:110`.
  5. The artifact sits inside the run and is not posted to the PR (**unverified** that nobody opens it; no comment step was found in the workflows).
- **Path:** (i) add a test-build seed and a fixed layout to Mahjong; (ii) make `mahjong/smoke.yaml` take a screenshot before any tap, plus one zoomed in; (iii) add a Mahjong-only dispatch like `flows: cascade-demo` (`docs/MAESTRO.md`, "Cascade demo flows"), so iOS can be run on demand against a JS-only PR without paying for every PR; (iv) post the images on the PR or open them from the design-review gate (`.claude/skills/ship-story/references/design-review.md`); (v) optionally store a baseline and compare with a loose threshold. Note that Cascade's #3705 demos already follow steps (iii) and (iv).
- iOS simulator capture also exists outside Maestro: `mobile-smoke-ios.yml:328` runs `xcrun simctl io "$SIM_UDID" screenshot` at the end, but that step has `if: failure()`, so it only captures failed runs.

## Recommendation

**Do (a); do (c) only if drift continues; do not do (b) now.**

Why:

1. The duplication that hurts (#3612's mismatch) is a **visual check** problem first; #3684's blur cause is still unconfirmed. The shared code (`motion.ts`, `layout.ts`, `zoom.ts`, theme, camera, mini-map) already holds most behaviour; what remains is drawing, which is the part a screenshot harness checks best.
2. (b) trades a recurring cost (two drawing paths) for a bigger one-off and per-load cost on a platform the project calls secondary ("Web ... is not a revenue platform", `CLAUDE.md`). It also depends on #3732 merging, and on a Skia-on-web performance and accessibility story that nobody has measured.
3. Revisit (b) **after #3732 is in and Cascade web has real-use data** (wasm cache hit rate, load failures reported to Sentry, load time). If those are fine, Mahjong joining CanvasKit becomes mostly deletion.
4. (c) is the right long-term shape if the owner wants to keep Canvas2D, and Star Swarm already proves it works. Do it only for tile geometry, and only if the parity screenshots show continued drift.

**Rough cost:** (a) about 1 to 1.5 weeks for the whole follow-up set (the harness alone is about 3 days), including one iOS run to validate; no new runtime cost; CI cost is one extra iOS dispatch per visual Mahjong change. (c) about 1 to 2 weeks on top, only if triggered. (b) 1 to 2 weeks plus CSP, perf and a11y work, and a permanent 3.25 MB gzip first-load on web.

## Follow-up stories (filed)

1. **#3803, Mahjong: deal a fixed board in test builds.** Under `EXPO_PUBLIC_TEST_HOOKS`, deal a fixed layout and seed (as Solitaire and FreeCell do), so Maestro and Playwright render the same tiles.
2. **#3801, Maestro: Mahjong demo flows and a `flows: mahjong-demo` dispatch.** Extend `e2e/maestro/flows/mahjong/smoke.yaml` (or add a `demo`-tagged flow) to capture the untouched board and a zoomed board on Android and iOS; add a `flows: mahjong-demo` dispatch on both legs.
3. **#3804, Playwright: same-board Mahjong screenshots on web.** Capture the same seed and layout on the web build and write them to a CI artifact for side-by-side review.
4. **#3805, CI: surface Maestro screenshots (Mahjong first) on the PR.** Post or link the `maestro-*-media` images and the Playwright images on visual Mahjong PRs.
5. **#3806, Mahjong: render the native tile art with real Skia in a Jest test.** Run `tileFaces.ts`'s raster path through headless CanvasKit at the sizes the board uses and compare with a stored image at a loose threshold. It tests the faces' raster only, not iOS's `1/res` downscale of the canvas layer (the leading, unconfirmed #3684 hypothesis), so it does not replace device or simulator screenshots (#3801).
6. **#3807, Research: re-evaluate Mahjong on CanvasKit once Cascade web (#3732) has real-use data.** One short write-up with real load-time, failure and cache numbers from Cascade web; decides (b).
7. **#3808, Mahjong: share tile geometry between the Skia and Canvas2D renderers (only if they keep drifting).** Extract tile body, side and shadow geometry into one pure function used by both backends, keeping `TileNode`'s per-tile memoisation.

## Unverified

- Why Mahjong was not tried on Skia-on-web in April 2026: only "mirror Star Swarm" is recorded (#873).
- Skia-on-web performance and CanvasKit load time on mid-range Android and browsers: no repo data.
- Whether #3732 merges as written, and the production CSP plan (`render.yaml:101` today has no `'wasm-unsafe-eval'`; the PR says prod is unchanged until #3703).
- The cause of #3684's blur (the `1/res` layer-downscale hypothesis is unconfirmed; it needs a device or simulator comparison).
- Whether either pinned Maestro version can compare screenshots against a baseline.
- The right hook point for a test-build Mahjong seed in `MahjongScreen.tsx`.
- The effort figures in section 4 are estimates.
