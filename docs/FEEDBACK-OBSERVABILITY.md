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
- a `beforeSend` filter that drops simulator/emulator events from the production environment.

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

- an `Error` argument is sent with `captureException`;
- otherwise the formatted message is sent with `captureMessage(level="error")`;
- the original console call still executes.

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

| Job                    | `subsystem`               | Fingerprint                        |
| ---------------------- | ------------------------- | ---------------------------------- |
| Daily Word retention   | `daily_word.retention`    | `daily-word-retention-prune-failed` |
| App Store replay       | `purchases.apple_replay`  | `apple-notification-replay-failed`  |
| Google Play jobs       | `purchases.google_jobs`   | `google-play-jobs-failed`           |

### One reporter

Background-job failures and the dropped/rejected-result reports go through
`backend/observability/report.py`. Two plain one-line messages still call
`sentry_sdk.capture_message` directly: the missing-`GameModule` report in
`games/stats.py` and the store-misconfiguration report in
`purchases/_common.misconfigured`.

- `report_exception(exc, subsystem=..., fingerprint=...)` for a caught exception
  (the background jobs above);
- `report_event(message, *, level, fingerprint, tags, context=None, extras=None)`
  for a message, with an explicit fingerprint, tags and Sentry contexts on a
  throwaway scope that never leaks onto other events;
- `Throttle(window_s)` for a reporter that could flood during one outage:
  `allow()` is True for the first call in a window and False for the rest.

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
- stores accepted rows in Postgres `bug_logs`.

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
- Future work: the recorder (#3274) adopting `captureThrottledMessage`, and
  session tags set once (#3277).
- No Sentry event or breadcrumb per gameplay event. The unknown-game drop
  breadcrumb in `gameEventClient` is fixed text, with the id in `data`, once per
  game id per session.
- Worst case from SyncWorker: two budgets (error/fatal and warning/info) x 10
  = 20 events/hour/session, roughly 10 KB each, so about 200 KB/hour/session at
  most (an estimate), bounded regardless of games played. The in-app cap only
  bounds a single session; it is not a fleet-wide limit. The server-side dial
  is Sentry's per-key rate limit and spike protection (#3311, see the owner
  checklist below), which turn volume down without an app release.

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
