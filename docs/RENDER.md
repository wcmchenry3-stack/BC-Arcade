# Deploying to Render

Web (Expo Web) is a secondary target; what matters here is the **API**, which the
iOS and Android apps talk to. For the why behind the topology see
[`ARCHITECTURE.md` §11](ARCHITECTURE.md).

## Environments

| Environment | Branch | API service         | API domain                     | Static site              | Site domain                | Database                                  |
| ----------- | ------ | ------------------- | ------------------------------ | ------------------------ | -------------------------- | ----------------------------------------- |
| Production  | `main` | `bc-arcade-api`     | `games-api.buffingchi.com`     | `bc-arcade-frontend`     | `games.buffingchi.com`     | **Supabase** Postgres (session pooler)    |
| Dev         | `dev`  | `bc-arcade-api-dev` | `dev-games-api.buffingchi.com` | `bc-arcade-frontend-dev` | `dev-games.buffingchi.com` | Render Postgres `bc-arcade-db` (dev only) |

Local development and CI use SQLite; neither touches Render or Supabase.

All services are in Oregon. DNS is Cloudflare (CNAME per custom domain, owner-managed).

## `render.yaml` is a reference, not a one-click installer

`render.yaml` records every service, its build/start commands and the **names** of
its env vars. Do not create the stack with **New → Blueprint → Apply**:

- The live dev database predates the blueprint — its real database and user names
  differ from the `databases:` block, so applying it would try to create a second
  database rather than adopt the existing one.
- Every secret is `sync: false`, so a blueprint-created service boots without
  them and fails.

Create services individually (dashboard or the Render MCP server) using the
values in `render.yaml`, then paste the secrets in the dashboard. Keep
`render.yaml` in step with any change made there — two tests read it
(`backend/tests/test_entitlements.py`):

- `test_render_yaml_prod_database_is_not_a_render_db` — no `main` service may use
  `fromDatabase`; the only Render database is dev's.
- `test_render_yaml_prod_does_not_set_dev_override` — prod never sets
  `ENTITLEMENT_DEV_OVERRIDE`.

## Environment variables

### API (`bc-arcade-api`, `bc-arcade-api-dev`)

| Variable                   | Prod                                                            | Dev                                                                     | Where set           |
| -------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------- |
| `PYTHON_VERSION`           | `3.11.0`                                                        | `3.11.0`                                                                | `render.yaml`       |
| `ENVIRONMENT`              | `production`                                                    | `development`                                                           | `render.yaml`       |
| `ALLOWED_ORIGINS`          | `https://games.buffingchi.com,https://games-api.buffingchi.com` | `https://dev-games.buffingchi.com,https://dev-games-api.buffingchi.com` | `render.yaml`       |
| `DATABASE_URL`             | Supabase **session pooler** URL                                 | Render `bc-arcade-db` internal URL                                      | Dashboard secret    |
| `SENTRY_DSN`               | same DSN in both — events are split by `ENVIRONMENT`            | ←                                                                       | Dashboard secret    |
| `ENTITLEMENT_PRIVATE_KEY`  | prod RS256 keypair — **never reuse dev's**                      | dev keypair                                                             | Dashboard secret    |
| `ENTITLEMENT_PUBLIC_KEY`   | ↑                                                               | ↑                                                                       | Dashboard secret    |
| `DAILY_WORD_SALT`          | prod-only value                                                 | dev value                                                               | Dashboard secret    |
| `DAILY_CHALLENGE_SALT`     | prod-only value (integer)                                       | dev value                                                               | Dashboard secret    |
| `ADMIN_API_TOKEN`          | prod-only value                                                 | dev value                                                               | Dashboard secret    |
| `ENTITLEMENT_DEV_OVERRIDE` | **must not exist**                                              | set (unlocks every premium game for every session)                      | Dashboard, dev only |
| `RENDER_GIT_COMMIT`        | injected by Render — becomes the Sentry `release`               | ←                                                                       | Render (automatic)  |

`ENVIRONMENT` unset means `development` — an API never reports to Sentry's
`production` environment by accident. `ENVIRONMENT=test` additionally registers
the `/debug/error` route; never set it on Render.

### Static site (`bc-arcade-frontend`, `bc-arcade-frontend-dev`)

| Variable                 | Prod                               | Dev                                    | Where set        |
| ------------------------ | ---------------------------------- | -------------------------------------- | ---------------- |
| `APP_ENV`                | `production`                       | `staging`                              | `render.yaml`    |
| `EXPO_PUBLIC_API_URL`    | `https://games-api.buffingchi.com` | `https://dev-games-api.buffingchi.com` | `render.yaml`    |
| `EXPO_PUBLIC_SENTRY_DSN` | secret                             | secret                                 | Dashboard secret |
| `SKIP_SKIA_DOWNLOAD`     | `1`                                | `1`                                    | `render.yaml`    |

`EXPO_PUBLIC_*` values are baked into the bundle at build time — change one,
redeploy the site. The app's Sentry environment is not a variable: it follows
`EXPO_PUBLIC_API_URL` (`frontend/src/utils/sentryConfig.ts`).
**Never set `EXPO_PUBLIC_SENTRY_ENVIRONMENT` in a tracked env file or on a service** —
an explicit value overrides that rule for every build that loads it
(`sentryEnvFiles.test.ts` guards the tracked files).
`scripts/check-build-env.js` fails the build if `EXPO_PUBLIC_TEST_HOOKS=1` leaks in.

### Secrets

This repository is **public**. Secrets are typed into the Render dashboard by the
owner and live otherwise only in the password manager — never in the repo, a PR,
an issue, a chat, or an MCP tool argument. The Supabase pooler URL contains the
database password and gitleaks will not reliably recognise a Postgres URL, so
treat it like any other secret.

## Production database (Supabase)

Supabase is used as plain Postgres. The app never uses Supabase Auth, Storage or
the Data API.

- **Connect through the session pooler**: host `*.pooler.supabase.com`, port
  **5432**. Not the transaction pooler (port 6543) — it does not support the
  prepared statements asyncpg relies on — and not the direct host, which is
  IPv6-only and unreachable from Render.
- **Connection budget**: the API holds a pool of 5 + 5 overflow
  (`backend/db/base.py`), plus one Alembic connection at boot. That fits one
  instance; revisit the pool size before scaling out.
- **Project settings** (dashboard, owner): Enforce SSL **on**; Data API **off**
  (Alembic's `public` tables have no RLS — the Data API would expose them to
  anyone with the anon key; the Supabase MCP server uses the Management API and
  is unaffected); GitHub integration unused.
- **Schema** comes only from Alembic. The API's start command runs
  `alembic upgrade head` on every boot, so merged migrations apply themselves on
  deploy. To build or check the schema by hand, export `DATABASE_URL` in your own
  shell and run `alembic upgrade head` from `backend/`.
- **Free plan pauses after about a week idle and has no backups.** Production
  must be on Pro with daily backups before store submission.

## Health checks

| Path             | Touches the DB | Used by                                                        |
| ---------------- | -------------- | -------------------------------------------------------------- |
| `GET /health`    | no             | Render's `healthCheckPath` — a DB outage must not restart-loop |
| `GET /health/db` | `SELECT 1`     | External uptime monitor (5-minute poll)                        |

`/health/db` returns `200 {"status":"ok"}`, or `503` with `unavailable` /
`unconfigured`; the failure detail goes to the service log only. The query is
bounded at 5 seconds, so a stalled pooler yields a prompt `503` rather than a
hung request. It is rate limited to 30/minute per IP.

## Deploys

- Push to `dev` → both dev services auto-deploy. Push to `main` → both prod
  services auto-deploy. Production therefore changes only through a `dev` → `main`
  promotion PR.
- The first production deploy needs `main` to contain everything the release
  depends on — promote before creating the prod services.

## First production deploy — checklist

1. `dev` → `main` promotion PR merged.
2. Supabase project hardened (settings above) and schema built with
   `alembic upgrade head`; `game_types` has 12 rows.
3. Create `bc-arcade-api` and `bc-arcade-frontend` from `render.yaml`'s values
   (Oregon, branch `main`).
4. Owner pastes every dashboard secret from the table above. Confirm
   `ENTITLEMENT_DEV_OVERRIDE` is absent.
5. Cloudflare CNAMEs for `games-api` and `games`; add the custom domains in Render.
6. Verify:
   - `curl https://games-api.buffingchi.com/health/db` → `{"status":"ok"}`
   - `GET /entitlements` with a fresh `X-Session-ID` → `entitled_games` is empty
   - a play-through adds rows in Supabase and leaves the Render dev DB unchanged
   - Sentry shows the events under `production`, with a `release`
7. Point the uptime monitor at `/health/db`.
