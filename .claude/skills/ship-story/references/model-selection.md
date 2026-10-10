# Model selection

Goal: every piece of work runs on the cheapest model that will get it right
the first time. A cheap model that needs three CI rounds and a re-review is
not cheap, so pick honestly — but default low and escalate on evidence.

The orchestrator session (usually Opus) plans, reviews diffs, and merges.
Implementation, conflict resolution, and most review rounds go to subagents
via the `Agent` tool's `model` parameter.

## Tiers

| Cost label      | `model`  | Use for                                                                                                                                                                                                                                                                                                                     |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cost:low`      | `haiku`  | Mechanical, fully specified work: docs-only changes, copy/i18n string additions, config/label tweaks, renames, lint/format fixes, lockfile or docs merge conflicts, adding tests for a pure function whose expected outputs are given in the story.                                                                         |
| `cost:standard` | `sonnet` | **The default.** A feature or bug inside one game or one backend module with clear ACs; UI screens/components; new endpoints following an existing pattern; most bug fixes with a known or findable root cause; most review rounds; code-level merge conflicts.                                                             |
| `cost:high`     | `opus`   | Cross-cutting or subtle work: changes spanning frontend + backend + migration; offline sync / `SyncWorker` / queueing; entitlements, IAP, auth, JWT; native iOS/Android build config; concurrency, timing, or animation-state bugs whose root cause is unknown; game AI/balance where the story is about _quality_ of play. |
| `cost:max`      | `fable`  | Only after the split check below fails. Examples: a root cause that an Opus attempt investigated and could not find; a novel algorithm (solver, AI search) with tight correctness and performance constraints; an architectural change that genuinely can't be staged.                                                      |

Signals that push a story **down** a tier: ACs list exact inputs/outputs; an
existing sibling implementation to copy (e.g. another game's engine of the same
shape); diff expected under ~150 lines in 1–3 files.

Signals that push **up**: "investigate"/"unknown root cause"; touches money,
auth, or user data; touches `frontend/ios/` or `frontend/android/`; a previous
attempt on this story failed; the story's ACs are about feel or judgment.

## The Fable gate

Before assigning `fable`, write (in the PR's **Cost tier** section, or the
decision issue if you stop instead):

1. **Split attempt** — how you tried to split it (e.g. "prep refactor first,
   then behavior change", "engine change separately from UI", "spike issue to
   find root cause, then a fix story") and why each split doesn't work.
2. **Why Opus isn't enough** — concrete: an Opus attempt failed (link it), or
   the problem has a property Opus is known to struggle with here.
3. **Scope** — Fable does the hard core only. Surrounding mechanical work
   (tests for edge cases it specifies, docs, wiring, conflict fixes, review
   follow-ups that are nits) goes back to Sonnet/Haiku.

If you split instead, file the sub-issues (plan-issues conventions) and ship
them individually — usually each piece lands at `standard` or `high`.

## Escalation ladder

Start at the chosen tier. Move **up one tier** when, on the same story:

- the implementer reports it could not satisfy an AC, or
- two consecutive review rounds return the same blocking finding unfixed, or
- two consecutive CI fix attempts fail on the same check for a reason in this
  PR's code.

Record each escalation as a PR comment ("escalated standard → high: <reason>")
and update the `cost:*` label to the highest tier used. If already at `high`
and the Fable gate isn't met, escalate to the owner instead (decision issue).

Move **down** for follow-up work whenever possible: once a high/max-tier PR is
open, nits, docs, conflict resolution, and lint fixes go to `sonnet` or `haiku`.

## Reviewers

- Review rounds: `sonnet` for `cost:low`/`cost:standard` PRs; `opus` for
  `cost:high`/`cost:max` PRs. A reviewer is never cheaper than `sonnet`.
- Security review: `opus` when it touches auth, entitlements, IAP, or user
  data; otherwise `sonnet`.
- The orchestrator still reads every diff once before marking ready.
