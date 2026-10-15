# Deploying to Render

Web (Expo Web) is a secondary target; what matters here is the **API**, which the
iOS and Android apps talk to. For the why behind the topology and the external-service map see
[`ARCHITECTURE.md`](ARCHITECTURE.md); this file owns the concrete Render/Supabase
deployment procedure and environment-variable inventory.

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
| `DATABASE_URL`             | Supabase **session pooler** URL — the app role `bc_app` after the [cut-over](#app-database-role-least-privilege) | Render `bc-arcade-db` internal URL (likewise) | Dashboard secret    |
| `MIGRATION_DATABASE_URL`   | optional: the privileged (`postgres`) pooler URL Alembic migrates with; unset → `DATABASE_URL` | optional: the database owner's URL; unset → `DATABASE_URL` | Dashboard secret    |
| `DB_STATEMENT_TIMEOUT_SECONDS` | leave unset (`5`): Postgres cancels a statement after this | ←                                                                 | —                   |
| `DB_COMMAND_TIMEOUT_SECONDS` | leave unset (`10`): asyncpg gives up on a reply; must exceed the statement timeout | ←                                         | —                   |
| `DB_POOL_TIMEOUT_SECONDS`  | leave unset (`10`): longest wait for a free pooled connection   | ←                                                                       | —                   |
| `SENTRY_DSN`               | same DSN in both — events are split by `ENVIRONMENT`            | ←                                                                       | Dashboard secret    |
| `ENTITLEMENT_PRIVATE_KEY`  | prod RS256 keypair — **never reuse dev's**                      | dev keypair                                                             | Dashboard secret    |
| `ENTITLEMENT_PUBLIC_KEY`   | ↑                                                               | ↑                                                                       | Dashboard secret    |
| `DAILY_WORD_SALT`          | prod-only value                                                 | dev value                                                               | Dashboard secret    |
| `DAILY_CHALLENGE_SALT`     | prod-only value (integer)                                       | dev value                                                               | Dashboard secret    |
| `ENTITLEMENT_DEV_OVERRIDE` | **must not exist**                                              | set (unlocks every premium game for every session)                      | Dashboard, dev only |
| `RENDER_GIT_COMMIT`        | injected by Render — becomes the Sentry `release`               | ←                                                                       | Render (automatic)  |
| `TRUSTED_PROXY_MODE`       | `cloudflare` (the default; set explicitly)                      | `cloudflare`                                                            | `render.yaml`       |
| `TRUSTED_PROXY_HOPS`       | leave unset (`1`: Render's proxy)                               | ←                                                                       | —                   |
| `RATE_LIMIT_STORAGE_URL`   | optional; unset = in-memory counters (see [Rate-limit storage](#rate-limit-storage-and-the-process-model)) | ← | Dashboard secret (optional) |
| `LOG_PROXY_HEADERS`        | **must not exist** (ignored when `ENVIRONMENT=production`)      | `1` only while running the owner checks below, then remove it           | Dashboard, dev only |
| `APPLE_BUNDLE_ID`          | set when Apple purchases go live (#2786)                        | set on the purchase-testing backend                                     | Dashboard secret    |
| `APPLE_APP_ID`             | set with `APPLE_BUNDLE_ID` (required while Production is allowed) | ←                                                                     | Dashboard secret    |
| `APPLE_IAP_ENVIRONMENTS`   | optional; default `Production,Sandbox`                          | optional                                                                | Dashboard           |
| `APPLE_IAP_ISSUER_ID`      | optional (App Store Server API); set all three `APPLE_IAP_*` key vars or none | ←                                                         | Dashboard secret    |
| `APPLE_IAP_KEY_ID`         | ↑                                                               | ↑                                                                       | Dashboard secret    |
| `APPLE_IAP_PRIVATE_KEY`    | ↑ (the `.p8` PEM)                                               | ↑                                                                       | Dashboard secret    |
| `APPLE_IAP_ONLINE_CHECKS`  | leave unset (on); `off` is refused in production                | optional; `off` allowed for local testing                               | Dashboard           |
| `GOOGLE_PLAY_PACKAGE_NAME` | set when Google purchases go live (#2787): `com.buffingchi.games` | set on the purchase-testing backend                                   | Dashboard           |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | required with the package name: the Play API service-account key JSON | ← (same account is fine; the key is per service)             | Dashboard secret    |
| `GOOGLE_RTDN_AUDIENCE`     | required with the package name: `https://games-api.buffingchi.com/purchases/google/notifications` | `https://dev-games-api.buffingchi.com/purchases/google/notifications` | Dashboard |
| `GOOGLE_RTDN_PUSH_SA`      | required with the package name: the Pub/Sub push service-account email | ← (its own push subscription)                                   | Dashboard           |
| `GOOGLE_PLAY_ENVIRONMENTS` | **set `production`** (the default `production,test` lets licence testers unlock for free) | leave the default `production,test`                   | Dashboard           |

The `APPLE_*` variables are **unset by default**: Apple verification stays
dormant and `POST /purchases/apple` and `POST /purchases/apple/notifications`
answer `503 store_unavailable`. Meanings, the webhook URLs to enter in App
Store Connect and the replay job are in [IAP.md §6.6 and §16](IAP.md#66-as-built-2786-server-side).
The `GOOGLE_*` variables are **unset by default** too: `POST /purchases/google`
and `POST /purchases/google/notifications` answer `503 store_unavailable`
until all four required ones are set (a half-set configuration stays
dormant and is reported to Sentry by reason code). Service-account
permissions, the Pub/Sub push subscription, the RTDN URL and the daily
voided-purchases / acknowledgement jobs are in
[IAP.md §7.6 and §16](IAP.md#76-as-built-2787-server-side).
Never put values in `render.yaml` or the repo.

The backend is moving these reads into one `Settings` object in
`backend/settings.py` (#2997), one package per PR. Names (case-sensitive, no
prefix) and defaults stay exactly as listed here. A migrated variable is read
once, when the app starts, so changing it takes a redeploy (use Save and deploy
when you edit the variable on Render). Which variables are migrated, their defaults and the code
that reads them are in [ARCHITECTURE.md §11.1](ARCHITECTURE.md#111-infrastructure-and-external-services).

`ENVIRONMENT` unset means `development` — an API never reports to Sentry's
`production` environment by accident. `ENVIRONMENT=test` additionally registers
the `/debug/error` route; never set it on Render.

### Client IP and rate-limit keys

Per-IP rate limits and the request log key on `client_ip` in
`backend/limiter.py` (trust model: [SECURITY.md §9](../SECURITY.md)).
The path is client → Cloudflare → Render's proxy → uvicorn; the socket peer
uvicorn sees is Render's proxy.

| `TRUSTED_PROXY_MODE` | Client IP is                                                                                             | Use when                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `cloudflare`         | `CF-Connecting-IP`; if absent or invalid, the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the right; else the peer | The hostname is proxied by Cloudflare (prod and dev). **Default.** |
| `render`             | the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` from the right; else the peer                            | Render only, no Cloudflare proxy in front                        |
| `none`               | the socket peer                                                                                          | uvicorn with no proxy at all (local)                             |

`TRUSTED_PROXY_HOPS` (default `1`, max `10`) is the number of trusted proxies
that append to `X-Forwarded-For` in front of the app. Render's proxy is one.
Do not raise it to reach "past" Cloudflare in `render` mode: the extra entry
would be client-controlled on any request that skips Cloudflare. An invalid
value in either variable stops the app at boot.

Do **not** add `--forwarded-allow-ips` / `FORWARDED_ALLOW_IPS` to the uvicorn
start command: uvicorn would then rewrite the peer from `X-Forwarded-For`
before the resolver sees it.

Rate-limit buckets are per IPv4 address and per IPv6 **/64** (one
subscriber's usual allocation, so rotating addresses inside it does not buy
fresh buckets). The request log's `"ip"` keeps the full address.

Session-keyed routes (`backend/rate_limits.py`) also carry a looser per-IP limit
(#3300), since the session id is client-supplied; carrier NAT puts many players
behind one address, so these are backstops sized well above one player's use.
`session_key` keys on `X-Session-ID` only when it is a valid UUID, in its
canonical lowercase form (so every spelling of one UUID shares a bucket);
anything else shares the caller's IP bucket and the handler answers 400. The
IP limit is evaluated before the session limit. The trade-off: a request the
session limit rejects has already spent the shared IP budget, so a session that
retries in a loop behind a shared NAT drains it (the headroom over the session
limits absorbs this); the benefit is that an IP over its limit creates no new
session entries. The per-IP backstops assume the
origin is not directly reachable (see the origin-bypass residual risk, #2914).

At startup the API logs `{"event": "client_ip_trust", "mode": …, "hops": …}`.
If the mode is not `cloudflare` and a request arrives carrying
`CF-Connecting-IP`, it logs `client_ip_cf_header_ignored` once per process:
the mode is probably wrong for that host and callers may be sharing buckets.

Changing the mode moves every per-IP bucket; with the default in-memory
storage, counters simply start again (as on every deploy). With
`RATE_LIMIT_STORAGE_URL` set they live in the shared store, so the old buckets
just stop being used.

#### Rate-limit storage and the process model

- **Process model.** Each service runs one `uvicorn` process, with no
  request-count recycling. `--limit-max-requests` was removed (#3301): uvicorn
  counts every request, 429s included, and exits at the limit, so ordinary
  traffic (or a burst of blocked requests) restarted the only process, causing
  downtime, an `alembic upgrade head` re-run and reset counters.
  `backend/tests/test_limiter_storage.py` fails if it comes back.
- **Counters** are in process memory by default, so they reset on every restart
  and deploy. That is fine for one process.
- **`RATE_LIMIT_STORAGE_URL`** (optional) is a `redis://` or `rediss://` URL of a
  Redis-compatible store (for example a Render Key Value instance). Set it in the
  dashboard, not `render.yaml`, since it can hold a password. When set, counters
  survive restarts and are shared by every instance. Unset or blank keeps
  in-memory counters. No store is provisioned today. **Before setting it, land
  #3329**: the purchase routes' per-store-account limit calls the limiter directly
  and does not yet fall back to memory, so a store outage would 500 those routes.
- **Store down.** The limiter never fails a request because of the store. While
  it is unreachable (1 s connect/read timeout) limits are enforced in memory, and
  it switches back once the store answers. Counters restart empty at each switch.
  The Redis calls are synchronous on the event loop, so a blackholed store (no
  refusal, just silence) can stall requests up to the 1 s timeout during each
  recovery probe. At startup the API logs `{"event": "rate_limit_storage",
  "shared": …}` (never the URL) and, if the store does not answer, sends one
  Sentry warning.
- **Network.** A store outside Render's private network must use `rediss://`
  (TLS); `redis://` is for the internal URL only.
- **Workers.** Both start commands pass `--workers 1` explicitly: uvicorn reads
  `WEB_CONCURRENCY`, which Render sets on multi-CPU plans, and would otherwise
  start several processes with split in-memory counters. The config guard test
  requires `--workers 1` (or `-w 1`). To run more, set `RATE_LIMIT_STORAGE_URL`
  first, then change the test.
- **CI.** The Redis test runs in the advisory `test-postgres` job, so a red run
  does not block merge; read the job result before merging.

Two operational traps:

- **A blueprint sync overwrites the dashboard.** `render.yaml` sets
  `TRUSTED_PROXY_MODE: cloudflare`; syncing or applying a blueprint replaces
  whatever the dashboard holds. Change the mode in `render.yaml` too, or not
  at all.
- **Migrations run before the check.** The start command is
  `alembic upgrade head && uvicorn …`, and Alembic does not import the app, so
  a bad `TRUSTED_PROXY_MODE` / `TRUSTED_PROXY_HOPS` applies pending migrations
  and *then* fails to boot. Render keeps the previous instance serving — on
  the new schema.

#### Owner checks

The resolved `"ip"` cannot answer these questions: if Render's own edge is
Cloudflare, every request carries a genuine `CF-Connecting-IP` and the log
shows your address whatever the headers underneath look like. So look at the
raw headers:

1. On **`bc-arcade-api-dev` only**, set `LOG_PROXY_HEADERS=1` and deploy. The
   startup line shows `"log_proxy_headers": true`, and every request line gains
   `"proxy": {"cf_connecting_ip": […], "xff_count": n, "xff_tail": [last 3 entries], "peer": …}`
   — the headers exactly as they reached uvicorn. (The API ignores the flag
   when `ENVIRONMENT=production`.)
2. Note your own public address (`YOUR_IP` below). The forged values are
   documentation addresses: `192.0.2.10`, `192.0.2.20`.

**A. Through the owner's Cloudflare zone**

`curl -H 'X-Forwarded-For: 192.0.2.10' -H 'CF-Connecting-IP: 192.0.2.20' https://dev-games-api.buffingchi.com/health`

| `cf_connecting_ip` | Meaning |
| --- | --- |
| `["YOUR_IP"]` | Cloudflare is in front and replaced the forged value. Expected. |
| `["192.0.2.20"]` | Nothing replaced it — the record is not proxied, or not through Cloudflare. `cloudflare` mode is **unsafe on this host**; stop and report. |
| `[]` | No Cloudflare anywhere on the path. `cloudflare` mode falls back to `X-Forwarded-For`; check C decides whether that is safe. |

**B. Straight to Render, forged `CF-Connecting-IP`** (skips the owner's zone)

`curl -H 'CF-Connecting-IP: 192.0.2.20' https://gaming-app-api-dev.onrender.com/health`

| `cf_connecting_ip` | Meaning |
| --- | --- |
| `["YOUR_IP"]` | Render's own edge is Cloudflare and replaces the header. The bypass cannot forge a bucket. (It also means restricting inbound IPs to Cloudflare ranges would block nothing.) |
| `[]` | Render strips the header. The bypass cannot forge it; the resolver uses the `X-Forwarded-For` fallback (check C). |
| `["192.0.2.20"]` | **The bypass is open:** anyone using the `onrender.com` hostname picks their bucket. Apply the mitigation below. |

**C. Straight to Render, forged `X-Forwarded-For`**

`curl -H 'X-Forwarded-For: 192.0.2.10' https://gaming-app-api-dev.onrender.com/health`

| last `xff_tail` entry | Meaning |
| --- | --- |
| `YOUR_IP` | Render appends the connecting client. `TRUSTED_PROXY_HOPS=1` is right and the fallback is safe. |
| `192.0.2.10` | Render passes the client's list through without appending. The right-most entry is forgeable: `render` mode and the `cloudflare` fallback are **unsafe**; report it. |
| another address (e.g. a Cloudflare range) | Render's edge adds its own hop. `render` mode would bucket everyone by that address; keep `cloudflare`, which is fine as long as B showed `["YOUR_IP"]`. |

(Without the flag, check C alone can be run by setting
`TRUSTED_PROXY_MODE=render` on dev for the test and reading the resolved
`"ip"`: `YOUR_IP` / `192.0.2.10` / other have the same meanings.)

3. **Remove `LOG_PROXY_HEADERS`** and redeploy — the lines hold raw client
   addresses and forged values.
4. Cloudflare DNS: is `games-api` **proxied** (orange cloud)? The prod CNAMEs
   were added DNS-only on Sep 22 so Render could issue its certificate; dev is
   proxied (CI's Bot Fight Mode note). Render behaves the same for both
   services, so B and C carry over to prod; A needs the record proxied.

**Mitigation if B shows the bypass open**, in this order:

1. **Disable the `onrender.com` subdomain on the prod API** (Render service
   settings; `renderSubdomainPolicy`). Keep dev's: CI's backend-health job
   uses `gaming-app-api-dev.onrender.com`.
2. **A shared-secret header**: a Cloudflare Transform Rule adds it on the
   proxied hostname and the API rejects requests without it (needs code).
3. Restricting the service's inbound IPs to Cloudflare's published ranges is
   **weak** if Render's own edge is Cloudflare — direct requests then arrive
   from Cloudflare addresses too.

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
- **Query bounds** (#3302): every new API connection gets `statement_timeout`
  = 5 s (`DB_STATEMENT_TIMEOUT_SECONDS`), so Postgres cancels a runaway query
  rather than letting it pin a pooled connection. It is sent twice: as a
  connection startup parameter, and as a `SET statement_timeout` the API runs on
  each new connection, because the session pooler (Supavisor) is not documented
  to forward startup parameters — the `SET` reaches the server either way.
  asyncpg stops waiting after 10 s (`DB_COMMAND_TIMEOUT_SECONDS`) if the server
  or pooler goes quiet, and a request waits at most 10 s for a free connection
  (`DB_POOL_TIMEOUT_SECONDS`). A route that hits any of them, or whose
  connection attempt times out, answers `503 {"detail": "database_timeout"}`
  with `Retry-After: 5` and logs `{"event": "db_timeout"}` (routes that catch
  database errors themselves keep their own 500 detail). Alembic is not bounded.
- **Raising the timeouts**: `DB_COMMAND_TIMEOUT_SECONDS` must stay above
  `DB_STATEMENT_TIMEOUT_SECONDS` (the API refuses to start otherwise), so raise
  them together. The API's own `SET` overrides the app role's 5 s role-level
  default (below), so a higher value takes effect for the API; but any other
  session as `bc_app` (psql, or a connection that skips the API's `SET`) stays
  capped at 5 s until the script's `ALTER ROLE … SET statement_timeout` value is
  changed to match and the script re-run.
- **Project settings** (dashboard, owner): Enforce SSL **on**; Data API **off**
  (Alembic's `public` tables have no RLS — the Data API would expose them to
  anyone with the anon key; the Supabase MCP server uses the Management API and
  is unaffected); GitHub integration unused.
- **Schema** comes only from Alembic. The API's start command runs
  `alembic upgrade head` on every boot, so merged migrations apply themselves on
  deploy. Alembic connects with `MIGRATION_DATABASE_URL` when it is set and
  `DATABASE_URL` otherwise. To build or check the schema by hand, export the
  privileged URL as `MIGRATION_DATABASE_URL` (or, before the cut-over,
  `DATABASE_URL`) in your own shell and run `alembic upgrade head` from `backend/`.
- **Free plan pauses after about a week idle and has no backups.** Production
  must be on Pro with daily backups before store submission.

### App database role (least privilege)

Until this cut-over is done the API and Alembic both connect as the privileged
role (`postgres` on Supabase, the database owner on Render dev), and nothing
changes: `MIGRATION_DATABASE_URL` unset means Alembic uses `DATABASE_URL`.

After it, the API connects as **`bc_app`**, which can only read and write rows:
`SELECT`/`INSERT`/`UPDATE`/`DELETE` on every table in `public`, `USAGE`/`SELECT`
on its sequences, and `SELECT` on `alembic_version`, plus a role-level
`statement_timeout = 5s` default for any session that does not set its own. It cannot create, alter,
drop or truncate anything, and owns nothing. Alembic keeps the privileged role
through `MIGRATION_DATABASE_URL`. Tables a later migration creates are covered
automatically (`ALTER DEFAULT PRIVILEGES FOR ROLE <migration role>`), as long as
migrations keep running as that same role. The script is
[`backend/scripts/create_app_role.sql`](../backend/scripts/create_app_role.sql);
CI's `test-postgres` job runs it and checks that the role is refused DDL
(`backend/tests/test_db_postgres_role.py`).

The API needs nothing beyond DML at runtime (checked for #3302): no
`create_all`, `SET` or temporary tables; row locks (`SELECT … FOR UPDATE`) need
only `UPDATE`, which it has. The role can still create *temporary* tables,
because Postgres grants `TEMPORARY` on every database to `PUBLIC`; the API never
does, and revoking it from `PUBLIC` would affect every role.

Cut-over, per environment (dev first, then prod):

1. **Create the role.** Run the whole script as the privileged role, in the
   app's database. Supabase: dashboard → SQL editor (it runs as `postgres`), paste
   the file, run. Render dev: `psql "<owner's external URL>" -f
   backend/scripts/create_app_role.sql`. It is idempotent and applies all or
   nothing. If it stops with "can still CREATE in schema public", follow the
   message (confirm the migration role keeps its own `CREATE`, then `REVOKE
   CREATE ON SCHEMA public FROM PUBLIC`) and run it again.
2. **Set its password** — never in the repo or the script: in `psql`,
   `\password bc_app`; in the Supabase SQL editor, `ALTER ROLE bc_app WITH
   PASSWORD '<generated>'`. Store it in the password manager.
3. **Build the app URL.** Copy the current `DATABASE_URL` and change only the
   user and password. On Supabase's pooler the user is `<role>.<project-ref>`,
   so `postgres.<ref>` becomes **`bc_app.<ref>`**; host, port **5432** and
   database stay. Check it connects: `psql "<app URL>" -c "select current_user"`
   prints `bc_app`.
4. **On the Render service** (Environment): add `MIGRATION_DATABASE_URL` = the
   **current** `DATABASE_URL` value (the privileged one), then set
   `DATABASE_URL` = the app URL from step 3. **Save and deploy**. Alembic now
   migrates as the privileged role; the API runs as `bc_app`.
5. **Verify**: the boot log shows `db_connected`; `GET /health/db` → `ok`; a
   play-through writes rows; in the SQL editor `SELECT usename, count(*) FROM
   pg_stat_activity WHERE datname = current_database() GROUP BY 1` shows the API's
   connections under `bc_app`.
6. **Check the timeout through the pooler**: `psql "<app URL>" -c "SHOW
   statement_timeout"` (the prod session-pooler URL, as `bc_app.<ref>`) must
   print `5s`. That is the role-level backstop, proving the pooler hands the role
   its settings; the API's own connections additionally run `SET
   statement_timeout` themselves. Anything else (`0`, or a pooler error) — stop and
   report before relying on the bound.

Rollback: set `DATABASE_URL` back to the `MIGRATION_DATABASE_URL` value and
redeploy. The role can stay. Rotating the app password: `ALTER ROLE bc_app WITH
PASSWORD …`, then update `DATABASE_URL` only. A migration that should run as a
different role than the one in the script's `ALTER DEFAULT PRIVILEGES` leaves its
new tables without grants for `bc_app` — re-run the script as that role.

## Health checks

| Path             | Touches the DB | Used by                                                        |
| ---------------- | -------------- | -------------------------------------------------------------- |
| `GET /health`    | no             | Render's `healthCheckPath` — a DB outage must not restart-loop |
| `GET /health/db` | `SELECT 1`     | UptimeRobot (prod API, 5-minute poll, email alert; set up Sep 23 2026) |

`/health/db` returns `200 {"status":"ok"}`, or `503` with `unavailable` /
`unconfigured`; the failure detail goes to the service log only. The query is
bounded at 5 seconds, so a stalled pooler yields a prompt `503` rather than a
hung request. It is rate limited to 30/minute per IP.

## Deploys

- **Dev services deploy by hand** (auto-deploy off, to keep build costs down on
  busy `dev` days): Render dashboard → the service → Manual Deploy.
- **Prod services auto-deploy `main`**, with Render's trigger set to **After CI
  Checks Pass** (`autoDeployTrigger: checksPass` in `render.yaml`, pinned by
  `test_deploy_workflow.py`). Production changes only through a `dev` → `main`
  promotion PR, and a commit ships only once its CI is green.
- **"After CI Checks Pass" means every check on the `main` commit** — not just `ci.yml`.
  A job that is known to fail must not run on push to `main`, or prod never deploys.
  The Maestro smoke legs (#2347, #2400) are manual-only for that reason
  (`test_deploy_workflow.py` pins it).
- **Post-deploy ZAP scan:** `.github/workflows/post-deploy-scan.yml` runs when CI
  finishes on `main`, waits (up to 30 minutes) for Render to report that commit
  live on each prod service, then runs an OWASP ZAP baseline scan against
  `games-api.buffingchi.com` and `games.buffingchi.com`. Reports are run
  artifacts; findings never file public issues. It can also be run by hand
  (Actions → "Post-deploy ZAP scan" → Run workflow) to scan what is live now.
- After the ZAP scan, a **header check** fails the run if a prod host sends no
  `Strict-Transport-Security` or a `Content-Security-Policy` that starts with a
  quote. Prod headers are set in the Render dashboard (the services were created
  by hand, so `render.yaml` does not apply to them). A value pasted from
  `render.yaml` with its quotes still gets sent, but browsers ignore it. When you
  change a header in `render.yaml`, make the same change in the dashboard,
  without the quotes. The API sets its own headers in `backend/middleware/headers_and_log.py`; its CSP `connect-src` hosts follow `ENVIRONMENT` (prod hosts when `production`, dev hosts otherwise).
- The scan reads the service IDs from two **secrets**, `RENDER_PROD_API_SERVICE_ID`
  and `RENDER_PROD_FRONTEND_SERVICE_ID`, plus `RENDER_API_KEY`.
- It is `workflow_run`-triggered on purpose: a `push`-triggered job would be one of
  the checks Render waits for while itself waiting for Render — a deadlock.
- History: until Sep 23 2026 a `deploy.yml` was meant to deploy prod after CI. The
  services were created by hand with Render's default trigger (every commit), and
  the workflow read the service IDs as variables while they were stored as
  secrets, so the first prod deploy (Sep 22) shipped before CI finished and was
  never scanned.

## First production deploy — checklist

1. `dev` → `main` promotion PR merged.
2. Supabase project hardened (settings above) and schema built with
   `alembic upgrade head`; `game_types` has 12 rows.
3. Create `bc-arcade-api` and `bc-arcade-frontend` from `render.yaml`'s values
   (Oregon, branch `main`, auto-deploy trigger **After CI Checks Pass**), then
   record each `srv-…` ID as the secret named under "Deploys" above.
4. Owner pastes every dashboard secret from the table above. Confirm
   `ENTITLEMENT_DEV_OVERRIDE` is absent.
5. Cloudflare CNAMEs for `games-api` and `games`; add the custom domains in Render.
6. Verify:
   - `curl https://games-api.buffingchi.com/health/db` → `{"status":"ok"}`
   - `GET /entitlements` with a fresh `X-Session-ID` → `entitled_games` is empty
   - a play-through adds rows in Supabase and leaves the Render dev DB unchanged
   - Sentry shows the events under `production`, with a `release`
7. Point the uptime monitor at `/health/db`.
