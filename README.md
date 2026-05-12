# BC Arcade

A collection of classic card/dice games (Yacht, Hearts, Solitaire, Blackjack, Sudoku, Cascade) with a FastAPI backend and an Expo/React Native frontend that runs on iOS, Android, and the web.

- **Backend:** Python 3.13, FastAPI, uvicorn
- **Frontend:** Expo (TypeScript), React Native, Expo Web
- **Docs:** see [`docs/`](docs/) for testing, deployment, iOS/Android, branding
- **Claude Code guide:** [`CLAUDE.md`](CLAUDE.md)

## Requirements

- **Python 3.13** (3.14 is not yet supported by `pydantic-core` / PyO3 — the install will fail)
- **Node.js 20+** and **npm**
- Xcode (for iOS local builds), Android Studio + JDK 17 (for Android local builds)

## Running Locally

Two terminals from the repo root.

### Terminal 1 — Backend

First time (or when `requirements.txt` changes):

**Mac/Linux:**
```bash
cd backend
python3.13 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

**Windows (PowerShell):**
```powershell
cd backend
python3.13 -m venv .venv
.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
```

> If PowerShell blocks the `.ps1` script, run once: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

Every time:

**Mac/Linux:**
```bash
cd backend
source .venv/bin/activate
python -m uvicorn main:app --reload   # http://localhost:8000
```

**Windows (PowerShell):**
```powershell
cd backend
.venv\Scripts\Activate.ps1
python -m uvicorn main:app --reload   # http://localhost:8000
```

To leave the venv: `deactivate`.

### Terminal 2 — Frontend (web)

```bash
cd frontend
npm install            # first time or when package.json changes
npx expo start --web   # http://localhost:8081
```

The frontend points at `http://localhost:8000` by default. Override with `EXPO_PUBLIC_API_URL` if the backend is elsewhere.

## Testing

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/ -v
```

Project-specific test cases and E2E guidance live in [`docs/TESTING.md`](docs/TESTING.md).

## Git Workflow

- Branch from `dev`: `git checkout dev && git checkout -b feat/<name>`
- Open PR: `feat/<name>` → `dev`
- Releases only: `dev` → `main`
- Never push directly to `main` or `dev`

## Mobile Builds

- **iOS:** Xcode Cloud (App Store Connect). `frontend/ios/` is committed — see [`docs/IOS.md`](docs/IOS.md).
- **Android:** Gradle → Google Play Console. `frontend/android/` is committed — see [`docs/ANDROID-CI.md`](docs/ANDROID-CI.md).

EAS Build is **not** used for either platform.

## Deployment

Backend is hosted on Render — see [`docs/RENDER.md`](docs/RENDER.md).

## Troubleshooting

**`pip install -r requirements.txt` fails building `pydantic-core`** — your venv is using Python 3.14. Recreate it with 3.13:

**Mac/Linux:**
```bash
deactivate
rm -rf backend/.venv
python3.13 -m venv backend/.venv
source backend/.venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
```

**Windows (PowerShell):**
```powershell
deactivate
Remove-Item -Recurse -Force backend\.venv
python3.13 -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r backend\requirements.txt
```
