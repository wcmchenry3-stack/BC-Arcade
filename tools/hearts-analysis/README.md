# hearts-analysis

Local-only FastAPI app (not deployed, not in CI). `POST /api/simulate` runs
`tools/sim/simulate-hearts.ts --log-games N` through `npx --prefix frontend tsx`,
`analyzer.py` summarises the game log, and `static/index.html` is the UI.

    npm ci --prefix frontend
    pip install -r tools/hearts-analysis/requirements.txt
    uvicorn main:app --app-dir tools/hearts-analysis

`data/` receives the generated `games.json`.
