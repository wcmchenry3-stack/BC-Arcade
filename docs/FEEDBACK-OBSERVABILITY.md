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
- `X-Admin-Token`;

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
- is rate-limited to **30 requests/minute per session**;
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
