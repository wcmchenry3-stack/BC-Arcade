# Player Feedback and Observability

BC Arcade has three related but distinct diagnostic channels. Keeping them separate is important for implementation, privacy declarations, and incident triage.

1. **Player-submitted feedback** → Sentry User Feedback.
2. **Automatic crash/error/performance diagnostics** → Sentry.
3. **Internal game bug logs** → the BC Arcade API / Postgres through the shared offline event queue.

None of these is the gameplay/session result pipeline itself. Game sessions and gameplay events are documented in [GAME-CONTRACT.md](GAME-CONTRACT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Player-submitted feedback

### Entry and categories

The in-app Feedback widget lets a player submit one of two types:

- **Bug**
- **Feature**

The player supplies:

- a required description, maximum 2,000 characters.

The form does **not** ask for:

- name;
- email address;
- screenshot;
- contact information.

The feedback category is attached as the Sentry tag `feedback.type`.

### Destination

Feedback is sent with `Sentry.captureFeedback()` to **Sentry User Feedback**.

The payload contains:

- `message`: the description alone (there is no title field; Sentry derives the issue title from the message);
- `source = "in_app_feedback"`;
- `feedback.type` tag;
- a `session-logs.txt` attachment when the local session-log buffer is non-empty.

There is no BC Arcade `/feedback` API endpoint and no GitHub-issue creation path in the current implementation.

The old shared Cloudflare-worker/GitHub path is historical and must not be described as current behavior.

### Session log attachment

`SessionLogger` wraps `console.warn` and `console.error` at app startup and keeps an in-memory circular buffer of the latest **200** warning/error entries.

Each entry records:

- ISO timestamp;
- warn/error level;
- formatted console message.

Those recent logs are attached only when the player chooses to submit feedback.

The buffer is diagnostic context, not a general telemetry upload stream.

### Feedback throttling

Feedback has a client-side per-install throttle:

- maximum **5 successful submission attempts per 10 minutes**;
- rate-limit state is in memory and resets when the process restarts.

There is no separate server-side BC Arcade feedback rate limit because the submission goes directly through the Sentry SDK.

### Offline / unavailable behavior

The Sentry SDK owns delivery/retry of the feedback envelope.

The form reports feedback as unavailable when:

- Sentry is not initialized in the current build; or
- the capture call throws.

Test-hooks builds and Expo Web do not initialize Sentry, so feedback delivery is unavailable there under the current configuration.

## 2. Automatic frontend Sentry diagnostics

Sentry is initialized on supported native builds when:

- the build is not a test-hooks build;
- the platform is not Expo Web;
- `EXPO_PUBLIC_SENTRY_DSN` is present.

The app sets:

- `sendDefaultPii: false`;
- environment from `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, otherwise development for debug/pre-launch builds and production for store/prod-API builds;
- App Hang tracking off in debug builds;
- a `beforeSend` filter that drops simulator/emulator events from the production environment;
- the server-side Sentry dial (#3437) in `beforeSend` and `beforeSendMetric`: see
  [§5a, Server-side dial](#server-side-dial-3437).

The app does **not** call `Sentry.setUser()` in the current observability setup.

### What is captured

Automatic Sentry diagnostics can include:

- explicitly captured exceptions;
- selected handled warnings/errors;
- `console.error` messages through the app's manual Sentry console-error bridge;
- Sentry breadcrumbs;
- native crash/App Hang diagnostics where enabled;
- performance/metric events explicitly emitted by the app (for example cold-start and screen-mount measurements).

The exact native SDK envelope can include normal device/app/runtime diagnostic context supplied by Sentry. Privacy declarations should be based on the SDK/config actually shipped, not on this summary alone.

### Console errors

After Sentry initialization, BC Arcade wraps `console.error`:

- an `Error` argument is sent with `captureException` (grouped by its stack);
- otherwise `captureMessage(level="error")` with the title
  `console.error: <template>` and the fingerprint `[console.error:<template>]`,
  where `<template>` is the **first** argument (the printf template for
  React warnings), with UUIDs, hex ids and numbers replaced by `#` (a 3-digit
  HTTP status right after `HTTP`/`status`/`code` is kept, so `HTTP 404` and
  `HTTP 500` stay apart) and cut to 120 characters. When the first argument is
  not a message (an object, a number) or is only format specifiers (`%s`,
  `%o`), the template is its type (for a plain object, up to 5 of its key
  names, never values) plus a short label of the second argument (its
  normalised text cut to 40 characters, or its type). The full formatted text
  goes in `extra.message`, cut to 1,000 characters;
- the original console call still executes, always.

Throttle (#3313): the forwarder has its own `SentryThrottle` (not the shared
one, so console noise cannot starve other reporters' error budget): at most
one event per template (or per error name + message) per app session, and at
most 10 in any rolling hour (`CONSOLE_ERROR_MAX_PER_HOUR`). Drops ride as
`extra.sentryThrottleDropped` on the next event sent. The throttle is checked
before any argument is formatted. A dropped call costs an `instanceof` scan of
the arguments, a slice of at most 512 characters of the first argument (and of
the second, for a non-message first argument) and the normalise regex passes
over that slice: never a `JSON.stringify` or the full message.

This wrapper composes with `SessionLogger`, so a console error can both:

- enter the local feedback attachment buffer; and
- be reported automatically to Sentry.

That is intentional; the two channels have different purposes.

## 3. Backend Sentry diagnostics

The FastAPI backend initializes Sentry only when `SENTRY_DSN` is configured.

Current options include:

- FastAPI/Starlette integrations;
- `traces_sample_rate = 0.1`;
- environment from `ENVIRONMENT`, defaulting to `development`;
- release from Render's `RENDER_GIT_COMMIT`;
- `send_default_pii = False`.

The backend explicitly scrubs:

- `X-Session-ID`;

from Sentry events through its event scrubber.

The pseudonymous session id can exist in BC Arcade's own database/logging systems, but it should not be forwarded as a Sentry request header.

### Background-job failures

A failed run of a background job (`backend/jobs/periodic.py`) is reported by one
helper, `observability.report.report_exception(exc, subsystem=..., fingerprint=...)`:
one event per failure, tagged `subsystem` and grouped by a fixed fingerprint.
The jobs log the failure at WARNING, never ERROR, because the Sentry logging
integration would turn an ERROR record into a second, untagged event.

| Job                  | `subsystem`              | Fingerprint                         |
| -------------------- | ------------------------ | ----------------------------------- |
| Daily Word retention | `daily_word.retention`   | `daily-word-retention-prune-failed` |
| App Store replay     | `purchases.apple_replay` | `apple-notification-replay-failed`  |
| Google Play jobs     | `purchases.google_jobs`  | `google-play-jobs-failed`           |

### One reporter

Background-job failures and the dropped/rejected-result reports go through
`backend/observability/report.py`, and so do (since #3313) the
missing-`GameModule` report in `games/stats.py` and the store-misconfiguration
report in `purchases/_common.misconfigured`. Both run per request, so each has
its own `KeyedThrottle`: one event per key per hour and at most 10 an hour
across that reporter's keys, per process (one uvicorn worker per Render
service), with the held-back count sent as `extras.suppressed` on the next
event. The two reporters together send at most 20 an hour (480 a day) per
process: about 2.4 MB a day at 5 KB an event, worst case.

| Reporter                       | Key                | Fingerprint                                                        |
| ------------------------------ | ------------------ | ------------------------------------------------------------------ |
| `stats._report_missing_module` | game type name     | `stats-missing-game-module`                                        |
| `_common.misconfigured`        | (platform, reason) | `apple_iap_misconfigured` or `google_play_misconfigured`, `reason` |

- `report_exception(exc, subsystem=..., fingerprint=...)` for a caught exception
  (the background jobs above);
- `report_event(message, *, level, fingerprint, tags, context=None, extras=None)`
  for a message, with an explicit fingerprint, tags and Sentry contexts on a
  throwaway scope that never leaks onto other events;
- `Throttle(window_s)` for a reporter that could flood during one outage:
  `allow()` is True for the first call in a window and False for the rest.
- `KeyedThrottle(window_s, max_per_hour)` for a reporter with several keys:
  `allow(key)` returns `None` (drop) or the count held back for that key since
  its last event. `reset_keyed_throttles()` is the test hook (autouse in
  `tests/conftest.py`).

The "dropped/rejected result" reporters are all `report_event` calls. They send
field paths and error types only, never values or a session id.

| Reporter                                       | Level   | Fingerprint                                                       | Tags                            |
| ---------------------------------------------- | ------- | ----------------------------------------------------------------- | ------------------------------- |
| `games.sessions._report_rejected_result` (400) | error   | `games-complete-result-rejected`, game type, reason               | `game_type`                     |
| `yacht.models._report_dropped_card`            | error   | same as above, game type `yacht`, reason `<field> dropped`        | `game_type`                     |
| `hearts.models._report_dropped_breakdown`      | warning | `hearts-result-breakdown-dropped`, reason                         | `game_type`                     |
| `starswarm.models._report_dropped_breakdown`   | warning | `starswarm-result-breakdown-dropped`, reason                      | `game_type`, `reason`           |
| `daily_word.router._report_degraded_guess`     | warning | `daily-word-guess-state-unavailable` (one event per 600 s window) | `subsystem=daily_word.progress` |

## 4. Session replay

**BC Arcade does not currently enable Sentry Session Replay in app initialization.**

Sentry replay-related packages may appear in bundle analysis as transitive SDK content, but there is no `Sentry.replayIntegration()` call in the application.

Do not describe session replay as an active data flow unless runtime configuration changes.

## 5. Internal game bug logs

This is separate from Sentry User Feedback.

Game/shared code can call:

`gameEventClient.reportBug(level, source, message, context?)`

with level:

- `warn`;
- `error`;
- `fatal`.

### Local queue

A bug report is converted into a `bug_log` row containing:

- generated bug UUID;
- level;
- source;
- message;
- context.

It enters the same local AsyncStorage-backed event queue used by the shared sync infrastructure.

The context payload is capped at **16 KB** on enqueue.

### Client runaway protection

`reportBug` uses an in-memory token bucket per `source`:

- refill: **10 reports/minute/source**;
- burst capacity: **20/source**.

A dropped report adds a Sentry breadcrumb so a runaway source is visible without flooding the local queue.

This rate limiter is a safety valve, not user-facing priority or escalation.

### Backend delivery

The SyncWorker sends bug-log batches to:

`POST /logs/bug`

The route:

- is keyed to the current `X-Session-ID`;
- accepts up to 50 logs per batch;
- is rate-limited per session (30 requests/minute) and, more loosely, per IP (`LOGS_IP_RATE_LIMIT`);
- de-duplicates by bug UUID;
- drops (2xx, counted in `dropped`) a log whose `context` exceeds `MAX_BUG_LOG_CONTEXT_BYTES` (16 KiB, matching the client's own cap) and any log past `MAX_BUG_LOGS_PER_SESSION` (500) stored for the session, so one bad log never dead-letters its batch;
- stores accepted rows in Postgres `bug_logs`, pruned after `BUG_LOG_RETENTION_DAYS` (90) by a daily job.

Stored fields include:

- bug id;
- session id;
- logged timestamp;
- level;
- source;
- message;
- context.

These logs are therefore **session-linked diagnostic data**, unlike player feedback sent to Sentry without a name/email field.

For queue capacity, TTL, retry, and eviction rules, see [ARCHITECTURE.md](ARCHITECTURE.md) and `eventStore.ts`; do not duplicate that full queue contract here.

## 5a. Sentry volume guardrails (#3293, epic #3273)

Sentry quota is a cost (CLAUDE.md priority order). Recording and any outage
around it must never flood Sentry or bury real errors.

### Client

- `frontend/src/game/_shared/sentryThrottle.ts` is the one client throttle.
  `captureThrottledMessage(key, message, {level, tags, extra})` sends at most
  one event per `key` per app session and at most 10 in any rolling hour
  (`DEFAULT_MAX_PER_HOUR`; a sliding window of send timestamps). `error`/`fatal`
  have their own 10/hour budget, so warnings cannot starve a new error. A drop bumps a counter, never an event; the count
  rides as `extra.sentryThrottleDropped` on the next event that gets through;
  it is lost if no event follows.
  State is in memory only (no storage writes), so "per device per hour" means
  per app session per hour; a relaunch resets it.
- The `key` is also the fixed Sentry fingerprint (`[key]`). Message text is
  fixed: **no game id, session id or other interpolated id**. Ids go in
  `tags` (low cardinality) or `extra`. A source-scan test
  (`sentryThrottle.test.ts`) fails if a `captureMessage` template
  interpolates an id.
- `SyncWorker` routes every `captureMessage` through it. Its keys are
  `syncWorker.{post_games|events|complete|logs_bug}.<status>` (plus
  `events.unknown_event_type`, `events.413_single`, `events.404`).
  `syncWorker.logs_bug.<status>` is the bug-log upload path. `reportBug`
  itself only adds the `reportBug.dropped` breadcrumb, which has no id; it is
  left as is (breadcrumbs carry no quota cost).
- `GameEventClientImpl.fireAndForget` (a rejected queue operation) keeps
  `captureException` so the stack survives, but gates it with
  `sentryThrottle.allow("gameEventClient.<op>", "error")` and the fixed
  fingerprint `["gameEventClient", <op>]` (#3351). So at most one event per op
  per session, inside the shared 10/hour error budget. `subsystem`, `op` and
  `game.id` are tags only. Same pattern as `eventStore.commit.tier<N>`.
- Future work: the recorder (#3274) adopting `captureThrottledMessage`, and
  session tags set once (#3277).
- No Sentry event or breadcrumb per gameplay event. The unknown-game drop
  breadcrumb in `gameEventClient` is fixed text, with the id in `data`, once per
  game id per session.
- Worst case from SyncWorker: two budgets (error/fatal and warning/info) x 10
  = 20 events/hour/session, roughly 10 KB each, so about 200 KB/hour/session at
  most (an estimate), bounded regardless of games played. The in-app cap only
  bounds a single session; it is not a fleet-wide limit. The no-release dials
  are the app's server-side Sentry dial (#3437, below) and Sentry's per-key
  rate limit and spike protection (#3311, see the owner checklist below).

### Server-side dial (#3437)

The apps' Sentry volume can be turned down or off without an app release.

- **Source.** Backend env vars on Render: `CLIENT_SENTRY_ENABLED` (default
  `true`) and `CLIENT_SENTRY_SAMPLE_RATE` (default `1.0`, 0–1; a value outside
  the range fails `Settings` validation, so the deploy fails and the running
  instance keeps serving). Read lazily by
  `backend/observability/client_sentry_dial.py`. How to flip it:
  [RENDER.md runbook](RENDER.md#environment-variables).
- **Carrier.** `GET /games/catalog` serves
  `client_sentry: {enabled, sample_rate}` beside the per-game replay dials. The
  app already fetches it at launch and at most once an hour on a return to the
  foreground (`replayDialSync.ts`). No new endpoint, no new poll, no request
  while a game is played, no table, no migration. The entitlement JWT is not
  touched.
- **Client.** `frontend/src/utils/sentryDial.ts` holds it: a valid fetched
  value wins; else the last good one, stored in AsyncStorage `sentryDial.v1`
  as `{e, r, t}` (read once per launch; written when a fetched value differs,
  or to refresh `t` when the same value's confirmation is over a day old);
  else the default, **today's behaviour (on, rate 1)**. A missing
  `client_sentry`, a non-boolean `enabled`, a rate that is not a finite number
  in 0–1, a non-2xx, a failed fetch or no network keeps the dial held but does
  not confirm it. Events captured before the stored value is read at launch
  get the default.
- **Expiry (7 days).** A held dial that no valid fetch has confirmed for 7
  days (`SENTRY_DIAL_MAX_AGE_MS`), or whose `t` is in the future (clock moved
  back), falls back to the default. So an "off" cannot outlive the server's
  word: an older backend without `client_sentry`, a rollback or a device that
  stays offline returns to today's behaviour within 7 days. A stored value
  without `t` (the `{e, r}` shape of the first #3437 build) is treated as
  expired.
- **Applied** in `App.tsx`'s `Sentry.init` hooks, so it covers every JS
  reporter at once: `beforeSend` (after the simulator filter) drops the event
  while the dial is off and keeps it with probability `sample_rate` otherwise
  (`captureException`, `captureMessage`, `captureThrottledMessage`, the
  `console.error` forwarder, httpClient's sampled 5xx warnings);
  `beforeSendMetric` does the same for `cold_start_ms` / `screen_mount_ms`. An
  error the dial drops does not upgrade the open game's replay (#3279).
- **Kept when off (keep-list).** Fatal-level events (JS events at level
  `fatal`), and what never passes the JS hooks: native crashes and App Hangs
  (native SDK), player-sent feedback (`captureFeedback`, its own
  5-per-10-minutes limit) and release-health session updates. Breadcrumbs have
  no cost of their own: they leave the device only inside an event, so a
  dropped event drops them.
- **Release health reads better than reality below 1.** An error the dial
  drops never marks its release-health session as errored, so the errored
  and crash-free session numbers in Sentry look better than they are while
  the rate is below 1 or the dial is off. Crashed sessions still count:
  fatal-level events and native crashes are kept.
- **Order.** The dial runs after the in-app throttles above, so it can only
  lower volume below their caps, never raise it.
- **Cost of the dial itself.** About 50 bytes more per catalog response, one
  AsyncStorage read per launch, a ~40-byte write when the value changes or at
  most once a day to refresh its confirmation, and per Sentry event one comparison and at most one `Math.random()`. Nothing
  on the frame or gesture path.
- **Volume (estimate, per device per day).** The throttled JS reporters are
  capped at 30 events per rolling hour per session (console.error 10, shared
  throttle 10 error/fatal + 10 warning/info); at roughly 10 KB each that is a
  ceiling of about 300 KB per foreground hour, ~7 MB if a session ran 24 hours.
  A typical day is a few events (tens of KB). Unthrottled `captureException`
  call sites and the 10 %-sampled 5xx warnings fire on real failures only. With
  the dial at rate `r` every one of these scales by `r`; off, only the
  keep-list remains (normally zero, a few KB per fatal-level event). Metrics: one
  `cold_start_ms` per launch plus one `screen_mount_ms` per screen opened, a
  few hundred bytes each, also scaled by `r`.

### Backend

- `observability.report.report_rejected_result` (the replay-adjacent
  completion-rejection report) is throttled per (game type, reason) to one
  event per 300 s per process, with its existing fixed fingerprint. The next
  event sent carries `suppressed: n`, the count held back since the last one. The
  events-append path (`POST /games/{id}/events`) reports nothing to Sentry
  (`unknown_event_type` is a 400 response only).

### Sentry project settings (to be applied by the owner)

Not changeable from code. Recommended settings for the frontend and backend
Sentry projects (Project Settings):

- [ ] Spike protection: on (Settings, Quotas / Spike Protection).
- [ ] Per-project rate limit on the client keys (Client Keys, Configure):
      start at 60 events/hour per key; tune after a week of data.
- [ ] Quota alerts: notify at 50%, 80% and 100% of the monthly error quota
      (Org Settings, Subscription / Quota notifications), to the owner email.
- [ ] Verify afterwards: one issue per `syncWorker.*` fingerprint, none with a
      game id in the title.

## 5b. Game session tags and the replay script (#3277, epic #3273)

Goal: from any Sentry issue, or any `reportBug` record, get to the game's recorded events.

### Client

- `frontend/src/game/_shared/sessionTags.ts`, called from `gameEventClient`, so
  it covers `useGameSync` and `useGameRecorder` (which wraps it) and every
  screen. `startGame` and a successful `resumeGame` call
  `Sentry.setTag` for `game.id`, `game.type` and `game.difficulty`;
  `completeGame` (which `close`, the unmount and the abandon path all reach) and
  `discardGame` clear them (`completeGame` in a `finally`, so a throw cannot leave
  stale tags), and so do Settings > Clear logs (`clearAll()`) and Delete My Data
  (`forceClearSessionTags()`), whose stores no longer hold the tagged game.
  The Sentry SDK has no tag removal that reaches native (`setTag(k, undefined)`
  is forwarded as the string `"undefined"`), so a cleared tag holds the sentinel
  `"none"`: filter with `!game.id:none`. Once per session start or end: never per event,
  nothing on the gameplay path, no storage, no network.
- `game.difficulty` is read from the session's start metadata: `difficulty`
  (Yacht vs, Sudoku), `ai_difficulty` (Hearts) or `difficulty_tier` (Star Swarm).
  Games with none (Solitaire, Sort, Blackjack, ...) never get the tag; it is
  reset to `"none"` when a game without one follows a game that had one.
- One session is open per screen, but the hook can replace one with another (a
  restart) and the killed-process sweep completes old sessions in the background.
  The tags follow the most recently started session, and a clear only applies
  when its id is the tagged one, so an older session ending (or the sweep) cannot
  strip a newer session's tags.
- `reportBug` adds `game_id` to the record's `context` when a session is open
  (a `game_id` the caller passes wins). It is a few bytes inside the existing
  16 KB context cap, so the bug-log volume is unchanged.
- `PendingGamesStore` write failures (#3338) tag `game.id` when one game is
  covered. The coalesced counter write and `batch()` cover several, so with
  more than one id the report sets `game.id` to `none` (left out, Sentry would
  fill it from the scope with the game being played) and lists up to 5 ids in
  `extra.game_ids` (game UUIDs, same data class as `game.id`). Message text and
  fingerprint stay fixed. The pending ids are a small in-memory set (an insert
  per bump, no extra writes); it holds only open games' ids and is trimmed when
  a write lands or the game is forgotten.
- SyncWorker and recorder Sentry messages keep their fixed text (5a); the tags
  are in addition to the ids they already carry in `extra`.
- Cost: `setTag` is in-memory scope state. It adds about 100 bytes (three short
  tags) to each Sentry event sent while a game is open, and creates no events.
  No new dial is needed: event volume is still bounded by 5a's throttle and its
  Sentry-side rate limits.

### Replay script

`backend/scripts/replay_game.py <game_id>` (run from `backend/`) prints the game's
row (type, timestamps, outcome, score, duration, metadata) and its events in
`event_index` order as plain text, each marked `lifecycle` (`game_started`,
`game_ended`, `hand_resolved`) or `replay`, with a `GAP` line wherever
`event_index` skips and a summary (counts, gaps, whether `game_started` /
`game_ended` are present). `--max-chars N` sets the payload truncation (0 =
full). It reads `DATABASE_URL` as the app does, issues SELECTs only (and sets the
Postgres transaction `READ ONLY`), and never prints the install ID. Exit 1: no
such game. A game with a gap was not fully recorded: a batch dropped by a cap,
events still on the device, or a game cut short. Trailing loss (the last events
never arrived) cannot show as a GAP, since the indexes that did arrive are
contiguous: it shows only as `game_ended` absent. A Star Swarm game also gets
its per-wave summaries, decoded `wave_timeline` rows and the reconciliation
between them (#3395, `backend/starswarm/replay.py`; a sampled diagnostic, not a
frame-by-frame replay). Tests: `backend/tests/test_replay_game.py`,
`backend/tests/test_replay_game_starswarm_timeline.py`.

### Privacy notes

- `game.id` is a random UUID generated on the device (`generateUUID`). It is not
  derived from the install ID, device or person; `game.type` and
  `game.difficulty` are fixed game vocabulary. No personal data is added.
- It does let someone with database access join a Sentry event to a `games` row
  and so to that row's install ID. Sentry events stay unjoinable from the install
  ID on their own (still never sent to Sentry); the join exists only inside our
  own database, and Delete My Data removes the rows, leaving the tag a dead
  reference. The Sentry 90-day retention is unchanged.
- Re-check `docs/privacy-policy.html` and `docs/STORE-PRIVACY-ANSWERS.md` as §8
  asks; no new data category is collected (diagnostics are already declared as
  linked to a device-level ID).

## 6. Triage distinction

BC Arcade should not treat these channels as equivalent signals.

- **Unhandled crash/error/hang**: automatic operational failure signal.
- **Internal `reportBug` log**: application-generated diagnostic record tied to the BC Arcade session.
- **Player feedback / bug report**: user-authored support/product signal; useful evidence, but not proof of severity by itself.

The player does not choose an engineering severity.

## 7. Environment and test behavior

### Frontend

- Debug builds → development Sentry environment.
- Pre-launch/dev-API builds → development unless explicitly overridden.
- Production/store/prod-API builds → production unless explicitly overridden.
- Test-hooks builds → Sentry not initialized.
- Expo Web → Sentry not initialized under the current configuration.
- Simulator/emulator events are filtered out of production.

### Backend

- `ENVIRONMENT` controls the Sentry environment.
- Missing `ENVIRONMENT` defaults to development.
- Missing `SENTRY_DSN` means Sentry is disabled.

This separation matters for launch-health metrics: development/test noise must not be interpreted as production stability.

## 8. Privacy and disclosure coupling

Changes to any channel in this document require a privacy/disclosure review.

At minimum cross-check:

- `docs/privacy-policy.html`;
- `docs/STORE-PRIVACY-ANSWERS.md`;
- `docs/LEGAL-REVIEW-NOTES.md`;
- iOS `PrivacyInfo.xcprivacy`;
- `ATT-AUDIT.md` where tracking implications change.

Examples that require re-review:

- adding screenshots to feedback;
- asking for email/name in feedback;
- attaching the session id to Sentry;
- enabling Session Replay;
- enabling a third-party analytics SDK;
- changing retention or diagnostic context;
- making feedback public or routing it through a new processor.

### Current separate privacy backlog

The broader privacy declarations are owned by their dedicated legal/privacy workstream. This document describes the technical flows; it does not replace the public Privacy Policy or store declarations.

## 9. Ownership and change rules

- Feedback form/payload → `FeedbackWidget/` and `useFeedbackSubmit.ts`.
- Feedback log attachment → `SessionLogger.ts`.
- Frontend Sentry initialization → `App.tsx` + `utils/sentryConfig.ts`.
- Console-error forwarding → `utils/sentryConsoleError.ts`.
- Internal bug logging → `gameEventClient.ts`, `eventStore.ts`, SyncWorker.
- Backend bug-log API/storage → `backend/logs/`.
- Backend Sentry initialization/scrubbing → `backend/observability/sentry.py` (called from `create_app()` in `backend/main.py`).

When changing one of these flows:

1. update code/tests;
2. update this document;
3. re-check privacy/store/legal declarations;
4. keep release-plan findings as dated history rather than copying them into the current contract.
