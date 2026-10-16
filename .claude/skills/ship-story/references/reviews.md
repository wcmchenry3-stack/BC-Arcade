# Reviews

Three review sources: our code-review rounds, the Codex GitHub app, and (when
triggered) a security review. All of them happen while the PR is a **draft**,
and every round plus our response is recorded as a PR comment, so the PR is
the full record.

## Code-review loop

Run by a reviewer subagent (tier per `model-selection.md`) using the
`code-review` skill on the PR at `high` effort, plus the test-integrity audit.
The reviewer must not be the same agent instance that wrote the code.

For each round:

1. Reviewer returns findings, each with severity:
   - **blocking** — correctness bug, missing AC, missing/weak test, security,
     data loss, crash, platform breakage (iOS/Android first), test-integrity
     violation, doc that is now wrong.
   - **should-fix** — real but non-critical (edge case, error handling, a11y,
     i18n gap, perf on a hot path).
   - **nit** — style, naming, comments, micro-refactors.
2. Post the round as one PR comment (format below).
3. Fix every blocking and should-fix finding (implementer tier, or lower for
   small fixes). Nits: fix the cheap ones in the same push, decline the rest
   with a one-line reason. A finding you disagree with is answered, not
   ignored: say why it's not a bug, with the code path you traced.
4. Bugs that are real but **outside this PR's scope** → file an issue
   (`escalation.md`), link it in the response, don't fix here.
5. Post the response comment, push, and start the next round on the new head.

**Stop** when a round returns no blocking or should-fix findings.
**Cap**: if round 3 still has blocking findings, don't run round 4 — escalate
(one tier up, or owner decision if the disagreement is about intended behavior).
Repeated findings of the same kind mean fix the root cause, not the instance.

### Round comment format

```
### Review round 2 — code review (reviewer tier: standard)
| # | Severity | File:line | Finding |
| - | -------- | --------- | ------- |
| 1 | blocking | frontend/src/game/yacht/engine.ts:212 | full_house scores 25 for a yacht roll when yacht box is filled |
| 2 | nit | ... | ... |

Test-integrity audit: 1 existing test modified, listed in Test changes (AC3). OK.
Codex: no comments yet (opened 6 min ago).
```

### Response comment format

```
### Response to round 2
| # | Disposition | Detail |
| - | ----------- | ------ |
| 1 | fixed | a1b2c3d — check yacht box before full-house bonus; regression test added |
| 2 | declined | naming matches sibling engines (hearts, cascade) |
| 3 | filed #3160 | pre-existing: leaderboard retry ignores 429 Retry-After |
```

## Codex

How the Codex app is triggered here: opening a PR for review, marking a
draft ready, or a `@codex review` / `@codex security review` comment. It does
**not** review a draft on its own. It reacts 👀 while running, posts comments
only when it has findings, and reacts 👍 when a review finishes with none.

- Right after opening the draft, comment `@codex review`. Note the time.
- Give Codex up to **10 minutes** from when the draft was opened. Don't idle
  waiting — the first code-review round runs during that window. A 👍
  reaction counts as "responded, no findings". If Codex hasn't answered by
  the time our loop converges and 10 minutes have passed, proceed to ready
  without it.
- Marking the PR ready triggers a **second** Codex review automatically.
  Treat it like any late review: triage and answer before merge.
- Codex findings are triaged exactly like a round's findings and answered in
  the next response comment (prefix their numbers `C1`, `C2`...). Reply on
  each Codex inline thread with the disposition and resolve it.
- Codex sometimes posts a "Summary" comment describing a fix it made in its
  own environment ("Committed the changes as …"). Nothing was pushed to the
  branch. Treat the summary as a finding: apply the parts that hold up, say
  which parts you didn't take and why.
- When the PR needs a security review, also comment `@codex security review`
  alongside running our own (below).

## Security review

Run the `security-review` skill (tier per `model-selection.md`) after the
code-review loop converges and before marking ready, when the diff touches any
of:

- `backend/` auth, sessions, tokens, entitlements/JWT signing or verification
- IAP, receipts, purchases, pricing, premium gating (`docs/IAP.md`,
  `docs/ARCHITECTURE.md §10`)
- New or changed HTTP endpoints, request validation, rate limits
- Database queries/migrations that take user input, or that delete/alter user
  data
- User data collection, analytics, logging of identifiers, privacy policy
  (`docs/DATA-INVENTORY.md`)
- Network client, URLs/deep links, WebViews, file or asset loading from
  outside the bundle
- New third-party dependencies or native modules
- Secrets, env vars, CI workflows, GitHub Actions permissions (supply chain)
- External API integrations (`.claude/policies/`)

Skip it for: game logic and AI, UI layout/styling, animations, audio, copy and
i18n strings, docs-only, test-only. If unsure, run it — it's cheap relative to
a shipped vulnerability.

Post it as its own comment (`### Security review`) with findings and
dispositions in the same table format. Security findings are never "nit":
each is fixed or explicitly accepted by the owner via a decision issue.
