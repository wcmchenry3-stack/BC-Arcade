# Dev tooling

Everything a developer runs by hand (never shipped in the app) lives here or in one of the exceptions listed at the bottom. Run every command from the **repo root** unless noted.

| Directory | What | Command |
| --- | --- | --- |
| `sim/` | Balance simulators and the Hearts PIMC spike. They import the engines from `frontend/src/game/` and the harnesses from `frontend/tooling/`. | `npx --prefix frontend tsx tools/sim/simulate-hearts.ts --gate --group presets` (also `simulate-yacht.ts`, `simulate-starswarm.ts`, `hearts-pimc-spike.ts`; each header lists its flags). See `docs/TESTING.md` "Simulators". |
| `generators/` | Offline generators for committed app data. | `npx --prefix frontend tsx tools/generators/build-yacht-oracle.ts` (see `docs/research/YACHT_ORACLE.md`); `npx --prefix frontend tsx tools/generators/pack-sudoku-puzzles.ts` (see `docs/games/sudoku.md`). |
| `assets/` | Python asset pipeline and the palette check. Own `requirements.txt`, separate from `backend/`. | See below. |
| `hearts-analysis/` | Local-only FastAPI app and static page that runs a batch of Hearts games and visualises them. Not deployed. | See `tools/hearts-analysis/README.md`. |

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
| `check_palette.py` | `python tools/assets/check_palette.py` (Sort Puzzle palette contrast and delta-E check) |

Tests for these scripts: `cd tools && python -m pytest` (`tools/pytest.ini`; the backend suite does not collect them).

## Not under `tools/`

- `backend/scripts/` - generators and one-off jobs that import backend modules and run from `backend/` with the backend venv (`gen_*.py`, `sort_*.py`, `apple_replay_notifications.py`, `google_play_jobs.py`, `check_file_length.py`). Documented in `docs/games/*.md`, `docs/IAP.md` and `docs/TESTING.md`.
- `scripts/` (repo root) - CI guards: `check_large_files.py` and `verify-aab-signing.sh` (Android release signing check).
- `frontend/scripts/` - Node scripts wired into `frontend/package.json`, CI or `render.yaml` (`translate`, `check-i18n`, `check-build-env`, `fetch-render-env`, `optimize-assets`, `analyze-bundle.mjs`, `list-bundled-assets.mjs`).
- `docs/research/animation-lab.html` and `asset-preview.html` - browser labs; serve the repo root with `python -m http.server 8080` and open `/docs/research/<name>.html`.
