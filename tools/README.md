# Dev tooling

Everything a developer runs by hand (never shipped in the app) lives here or in one of the exceptions listed at the bottom. Run every command from the **repo root** unless noted.

| Directory | What | Command |
| --- | --- | --- |
| `sim/` | Balance simulators and the Hearts PIMC spike. They import the engines from `frontend/src/game/` and the harnesses from `frontend/tooling/`. | `npx --prefix frontend tsx tools/sim/simulate-hearts.ts --gate --group presets` (also `simulate-yacht.ts`, `simulate-starswarm.ts`, `hearts-pimc-spike.ts`; each header lists its flags). See `docs/TESTING.md` "Simulators". |
| `generators/` | Offline generators for committed app data. | `npx --prefix frontend tsx tools/generators/build-yacht-oracle.ts` (see `docs/research/YACHT_ORACLE.md`); `npx --prefix frontend tsx tools/generators/pack-sudoku-puzzles.ts` (see `docs/games/sudoku.md`). |
| `assets/` | Python asset pipeline and the Sort palette check. Own `requirements.txt`, separate from `backend/`. | See below. |

## Python asset tools (`tools/assets/`)

```bash
python -m venv tools/.venv && source tools/.venv/bin/activate
pip install -r tools/assets/requirements.txt
```

| Script | Command |
| --- | --- |
| `remove_backgrounds.py` | `cd frontend && npm run process-assets` |
| `extract_vertices.py` | `cd frontend && npm run extract-vertices` |
| `bake_sprites.py` | `python tools/assets/bake_sprites.py` |
| `convert_icons_to_webp.py` | `python tools/assets/convert_icons_to_webp.py frontend/assets/fruit-icons` |
| `generate_svg_sprites.py` | `python tools/assets/generate_svg_sprites.py` (writes to `/tmp/svg_sprites`) |
| `check_palette.py` | `python tools/assets/check_palette.py` (Sort palette check; see [Sort palette check](#sort-palette-check-check_palettepy)) |

Tests for these scripts: `cd tools && python -m pytest` (`tools/pytest.ini`; the backend suite does not collect them). CI runs them, and lints `tools/**/*.py` with the same ruff and black rules as `backend/` (config in `tools/pyproject.toml`). Locally: `cd tools && ruff check . && black --check .`.

### Sort palette check (`check_palette.py`)

A manual tool: nothing in CI or the deploy calls it, so it only protects you if you run it.

**What it checks.** The 14 Bottle Sort liquid colours, once for the dark theme (against `#0e0e13`) and once for the light theme (against `#f5ecd7`):

- **Contrast.** Every colour must reach at least 3:1 WCAG contrast against its theme background.
- **Distinguishability.** Every pair of the 14 colours (91 pairs per theme) must differ by at least 20 in CIEDE2000 delta-E. This is a perceptual distance between colours, not a colour-blindness simulation. A pair above 20 is clearly different to typical vision; it does not prove the pair stays distinct under red-green or blue-yellow colour blindness. Treat a pass as necessary, not sufficient, for colour-blind players (see [`docs/ACCESSIBILITY.md`](../docs/ACCESSIBILITY.md)).
- **Sync.** Both themes define the same colour keys.

**When to run it.** Whenever the Sort colours change: `BOTTLE_LIQUID_COLORS` in `frontend/src/theme/theme.bottle.ts`, or the theme backgrounds `darkBg` / `lightBg` in `frontend/src/theme/ThemeContext.tsx`. The script keeps its own copy of the palette, so first update the `PROPOSED` and `BG_PER_THEME` tables in `tools/assets/check_palette.py` to match the app, then run it.

**Command** (from the repo root; one-time setup is the venv and `pip install` above):

```bash
python tools/assets/check_palette.py
```

**Dependencies.** `numpy` and `colour-science`, both in `tools/assets/requirements.txt`.

**Reading the output.** It prints a `CURRENT` block, then a `PROPOSED` block. Each theme prints a `[ΔE₂₀₀₀]` result (failing pairs listed worst first, `!!!` marks a delta-E under 10), a `[Contrast vs <bg>]` result (failing colours with their ratio), and a `Result:` line. A final `[SYNC]` line covers the key check. The exit code reflects only the `PROPOSED` block, which is what ships (it mirrors `theme.bottle.ts`). Expect `CURRENT` to show failures: it is a frozen snapshot of the old pre-fix palette kept for regression comparison. A good run ends each `PROPOSED` theme with `Result: ALL PASS ✓` and exits 0:

```text
[ΔE₂₀₀₀] PASS ✓ — 0 pair(s) below 20.0
[Contrast vs #0e0e13] PASS ✓ — 0 color(s) below 3.0:1
  Result: ALL PASS ✓
[ΔE₂₀₀₀] PASS ✓ — 0 pair(s) below 20.0
[Contrast vs #f5ecd7] PASS ✓ — 0 color(s) below 3.0:1
  Result: ALL PASS ✓
[SYNC] PASS ✓ — all themes have the same 14 color keys
```

Related docs: [`docs/games/sort.md`](../docs/games/sort.md) (Colour palette), [`docs/ACCESSIBILITY.md`](../docs/ACCESSIBILITY.md) (Colour-blind support).

## Not under `tools/`

- `backend/scripts/` - generators and one-off jobs that import backend modules and run from `backend/` with the backend venv (`gen_*.py`, `sort_*.py`, `apple_replay_notifications.py`, `google_play_jobs.py`, `check_file_length.py`). Documented in `docs/games/*.md`, `docs/IAP.md` and `docs/TESTING.md`.
- `scripts/` (repo root) - CI guards: `check_large_files.py` and `verify-aab-signing.sh` (Android release signing check).
- `frontend/scripts/` - Node scripts wired into `frontend/package.json`, CI or `render.yaml` (`translate`, `check-i18n`, `check-build-env`, `fetch-render-env`, `optimize-assets`, `analyze-bundle.mjs`, `list-bundled-assets.mjs`).
- `docs/research/animation-lab.html` and `asset-preview.html` - browser labs; serve the repo root with `python -m http.server 8080` and open `/docs/research/<name>.html`.
