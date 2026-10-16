---
name: ship-story
description: Take one or more GitHub stories (or a whole epic) from issue to merged PR with as little owner involvement as possible. Picks the subagent and the cheapest model that can do each story, works in a clean worktree off the latest dev, opens a draft PR, runs code review / Codex review / security review loops with every round documented on the PR, drives CI green, merges, and closes the issues. Use when the user says "work on story #N", "ship #N", "work the epic #N", or "/ship-story".
---

# ship-story

You are the **orchestrator**. You plan, dispatch, review, and merge. You do not
write feature code yourself unless the story is trivial (docs typo, one-line
config) — implementation goes to a subagent on the cheapest model that can do it.
Your job is to keep many stories moving in parallel, never lose a question the
owner has to answer, and never trade test integrity for a green check.

Input: one or more issue numbers, or an epic number. If none is given, ask.

Reference files (read when you reach that phase, not all up front):

| File                                                           | When                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| [references/model-selection.md](references/model-selection.md) | Phase 1 — choosing agent + model for each story       |
| [references/test-integrity.md](references/test-integrity.md)   | Phase 2 brief, Phase 3 audit — any test change        |
| [references/reviews.md](references/reviews.md)                 | Phase 3 — review loop, Codex, security, PR comments   |
| [references/coordination.md](references/coordination.md)       | Epics, parallel work, other sessions, merge order     |
| [references/escalation.md](references/escalation.md)           | Any time you need the owner, or find an unrelated bug |

---

## Hard rules (never)

- Never push to `main` or `dev` directly. Never target `main` with a story PR.
- Never skip, delete, `xfail`, `.skip`, quarantine, or loosen an existing test
  to get green, except as allowed in `test-integrity.md`, and then only with
  the change listed in the PR's **Test changes** table.
- Never bury a question for the owner in chat. Decisions go in a
  `blocked:owner-decision` issue (see `escalation.md`).
- Never put two unrelated changes in one PR (see "Bundling" below).
- Never use the max tier (Fable) without first trying to split the story and
  writing down why it can't be split (see `model-selection.md`).
- Never mark a PR ready while known blocking review findings are open.
- Never merge a PR touching purchases/money or database migrations without
  the owner's approval (Phase 4).
- Never use `eas build` / `eas submit` / Expo Go as a release path (CLAUDE.md).

---

## Phase 0 — Intake (orchestrator)

1. Read each issue in full, plus its epic and anything it links. Note the
   acceptance criteria (ACs), "Test coverage", "Documentation to update",
   "Dependencies", and "Out of scope" sections.
2. **Platform.** If the story doesn't say which platform(s) it affects and the
   answer changes the work, raise an owner decision (CLAUDE.md requires this);
   don't assume web.
3. **Claim check.** Before starting, make sure nobody else is on it — open PRs
   that reference the issue, a live claim comment, or a branch named for it.
   Details in `coordination.md`. If claimed, skip it and say so in the report.
4. **Ready check.** A story is ready when its ACs are testable and nothing in
   "Blocked by" is still open. Not ready → escalate (decision issue) and move
   on to the next ready story; don't guess at product behavior.
5. **Claim it**: post the claim comment from `coordination.md`.

## Phase 1 — Plan (orchestrator)

For each ready story, write a short plan. It is posted later as the first
section of the PR description, so write it once.

1. **Scope** — files/areas you expect to touch (read the code; don't guess).
2. **Split?** — if the story is large or mixes concerns, split it into
   sub-issues with the `plan-issues` agent's conventions before coding.
3. **Tests** — what unit / integration / e2e / sim tests prove each AC. A
   story that doesn't list tests still gets them: every new behavior needs a
   test that fails without it; every bug fix needs a regression test that
   reproduces the bug.
4. **Docs** — grep `docs/`, `README.md`, `CLAUDE.md`, and `docs/games/` for the
   area. List each doc to update and why, or write "None — <reason>". This
   applies even when the story doesn't mention docs.
5. **Security review needed?** — decide now using the trigger list in
   `reviews.md`.
6. **Agent + model** — pick per `model-selection.md`. Record the tier and the
   one-line reason.

Bundling: you may put several stories in one PR only if they change the same
feature in the same area and would be reviewed together anyway (e.g. two
Hearts AI stories that touch the same engine). Two games, or a game plus an
unrelated infra fix, are always separate PRs. When in doubt, separate.

## Phase 2 — Implement (subagent)

1. **Clean base.** `git fetch origin dev`, then create the branch from
   `origin/dev` — never from the current branch or a stale local `dev`.
   Branch name: `feat|fix|chore|docs/<issue#>-<slug>` (CONTRIBUTING.md). If the
   session was given a designated branch, use that for a single story and
   reset it to `origin/dev` first if it carries only merged history. For
   parallel stories, each subagent gets its own worktree
   (`Agent` with `isolation: "worktree"`).
2. **Dispatch** with `subagent_type: "story-implementer"` and `model` set to
   the chosen tier. The brief must include: the issue body, the plan from
   Phase 1, the branch name, the test plan, the docs list, and the
   test-integrity rules (paste the "Brief for implementers" section of
   `test-integrity.md`).
3. The implementer commits with Conventional Commit messages, runs the repo's
   local checks (lint, typecheck, the tests for changed packages), and reports
   back: what changed, tests added, existing tests it modified and why, docs
   updated, anything it couldn't resolve, and any unrelated bugs it noticed.
4. **Orchestrator sanity read.** Skim the diff before opening the PR. If the
   implementer went off-scope, send it back rather than opening the PR.

## Phase 3 — Draft PR and review loop

1. Open the PR **as a draft** into `dev`. Title: Conventional Commit format.
   Body: fill `.github/pull_request_template.md` and add these sections:
   - **Plan** (from Phase 1), **Closes #N** lines (one per story;
     use "Part of #EPIC" for the epic, never "Closes #EPIC").
   - **Test changes** table (required even if empty — see `test-integrity.md`).
   - **Docs** — what was updated, or "None — <reason>".
   - **Assumptions** — implementation choices made without asking.
   - **Cost tier** — tier used and why (no model IDs; tier names only).
     Add labels: story's area label(s) and the `cost:*` label.
2. Post `@codex review` as a PR comment immediately, and note the time.
3. Run the **review loop** in `reviews.md` (rounds until only nits remain,
   max 3 before escalating). Codex findings are merged into whichever round
   is current when they arrive. Every round and every response is a PR comment.
4. Run the **test-integrity audit** in `test-integrity.md`.
5. Run **security review** if Phase 1 said so (`reviews.md`).
6. Merge `origin/dev` into the branch (not rebase) so the PR is current, and
   re-run local checks.
7. Wait until at least 10 minutes have passed since the draft was opened, or
   Codex has responded, whichever comes first.
8. Mark the PR **ready for review**. CI skips its jobs while a PR is a draft
   (see `docs/CI-CHECKS.md`), so this is what starts the full CI run. Don't
   mark ready early just to see CI; run the local checks instead.

## Phase 4 — CI, conflicts, merge

1. Watch CI on the head commit. Prefer `subscribe_pr_activity` (cloud) or a
   `Monitor`/`ScheduleWakeup` check-in (local); never `sleep`-poll.
2. **Red CI** → root-cause and fix with the implementer tier (or one tier
   lower for mechanical fixes like lint, snapshot paths, lockfiles). Each fix
   gets a short PR comment: check name, cause, commit. A failure that is red on
   `dev` too is not this PR's: say so on the PR and file/link an issue. Two
   consecutive failed fix attempts on the same check → escalate (owner issue
   or one tier up, per `model-selection.md`).
3. **Late review comments** (Codex or human) after ready → handle exactly like
   a review round; document on the PR.
4. **Merge conflict** → merge `origin/dev` in and resolve with the cheapest tier
   that can (`coordination.md`), re-run local checks, push.
5. **Owner-approval gate.** If the PR touches purchases or money (IAP,
   receipts, pricing, premium gating/entitlements — `docs/IAP.md`,
   `docs/ARCHITECTURE.md §10`) or adds/changes a database migration
   (`backend/alembic/`), **don't merge it yourself.** Once it is otherwise
   ready, add the `owner-approval-required` label, post a PR comment summarizing
   what to check, and list it under **Needs you**. Merge only after the owner
   approves on GitHub or says so in chat; then remove the label. Keep working
   other stories meanwhile.
6. **Merge** when: CI green on the head commit, no conflicts, no open blocking
   findings, required reviews satisfied, and the owner-approval gate passed if
   it applies. Squash-merge (PR title becomes the commit). If several of your
   PRs are ready and overlap, use the merge order in `coordination.md`.
7. **After merge**:
   - Confirm each `Closes #N` issue closed (dev is the default branch, so it
     should auto-close). If not, close it with `state_reason: completed` and a
     comment linking the PR.
   - Tick the story in the epic's child list. If every child is closed, run
     the epic's success metrics check and close the epic.
   - Delete the branch / worktree.
   - Watch the post-merge `dev` CI run. If the merge broke `dev`, that is now
     the top priority: fix forward fast or open a revert PR.

## Phase 5 — Report

End every run (and every long pause) with this report, in this order — the
first section is never omitted, even when empty:

```
## Needs you
- #123 decision: <one-line question> (blocks #124, #125)
- PR #142 approval: in-app purchase change, ready for your review
- (or "Nothing — no open decisions or approvals.")

## Shipped
- #101 → PR #140 merged (cost: standard) — <one line>

## In flight
- #102 → PR #141, waiting on CI (android-build-check)

## Filed during this run
- #150 bug: <title> (found in review of #140)

## Skipped
- #103 — claimed by another session (PR #139)
```
