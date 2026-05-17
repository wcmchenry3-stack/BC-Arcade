# BC Arcade — Claude Guide

<!-- User-level standards: ~/.claude/CLAUDE.md and ~/.claude/standards/ -->

## Stack

- **Backend:** Python 3.13, FastAPI, uvicorn, PostgreSQL (Alembic migrations)
- **Frontend:** Expo TypeScript, runs in browser via Expo Web
- **Setup & runbook:** [`README.md`](README.md)
- **Docs:** testing, iOS/Android CI, Render, branding — see [`docs/`](docs/)

## Git Workflow — see [~/.claude/standards/git.md](~/.claude/standards/git.md)

- Never push directly to `main` or `dev`
- Branch from `dev`: `git checkout dev && git checkout -b feat/<name>`
- PR: `feat/<name>` → `dev` → `main` (releases only)

## Testing — see [~/.claude/standards/testing.md](~/.claude/standards/testing.md) + [`docs/TESTING.md`](docs/TESTING.md)

`cd backend && source .venv/bin/activate && python -m pytest tests/ -v`

## iOS & Android Builds

- **iOS:** Xcode Cloud (App Store Connect). `frontend/ios/` is committed. See [`docs/IOS.md`](docs/IOS.md). Do **not** suggest `eas build` or treat `ios/` as ephemeral.
- **Android:** Gradle → Play Console. `frontend/android/` is committed. See [`docs/ANDROID-CI.md`](docs/ANDROID-CI.md) for modification/signing/CI rules. Do **not** suggest `eas build`/`eas submit`.
- Before modifying `frontend/android/`: verify `cd frontend/android && ./gradlew assembleDebug` passes locally.
- Never commit `upload-keystore.jks`, `debug.keystore`, or `local.properties` (gitignored).

## Deployment & Branding

Deployment (Render): [`docs/RENDER.md`](docs/RENDER.md). Design system is **BC Arcade** (never "Neon Arcade") — see [`docs/BRANDING.md`](docs/BRANDING.md).

## Key Conventions

- Game logic lives in `frontend/src/game/<name>/engine.ts` (client-side, offline-capable). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Scoring is server-side; outcomes are queued locally when offline and flushed by `SyncWorker`.
- Premium access is gated by an RS256 entitlement JWT from `GET /entitlements` (24-hr TTL, 7-day offline grace). See [`docs/ARCHITECTURE.md §10`](docs/ARCHITECTURE.md).
- Yacht scoring keys: `ones` `twos` `threes` `fours` `fives` `sixes` `three_of_a_kind` `four_of_a_kind` `full_house` `small_straight` `large_straight` `yacht` `chance`.
- `EXPO_PUBLIC_API_URL` env var overrides `BASE_URL` in `frontend/src/api/client.ts`.

## Available Agents

Project subagents in `.claude/agents/`, invoked via the `Agent` tool. Prefer these over general-purpose:

| Agent             | `subagent_type`     | When to use                                                                                                                   |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| lint-review       | `lint-review`       | Auto-fix lint issues after a lint-gate hook failure                                                                           |
| plan-issues       | `plan-issues`       | Break a feature/bug/initiative into scoped GitHub issues — investigates code, drafts for confirmation, then `gh issue create` |
| policy-compliance | `policy-compliance` | Check and fix policy violations after a policy-gate hook failure                                                              |
