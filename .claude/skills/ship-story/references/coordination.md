# Coordination: epics, parallel work, other sessions

## Claiming a story

Other sessions (yours or the owner's) may be working the same backlog. Before
starting a story:

1. Search open PRs for the issue number (`#N` in title/body) and branches
   named `*/N-*`. Either exists → it's taken; skip it.
2. Read the issue comments for a claim marker:
   `<!-- ship-story-claim -->`. A claim is live if it or the linked PR has
   activity in the last 24 hours.
3. To claim, comment on the issue:

   ```
   <!-- ship-story-claim -->
   Claimed by an automated ship-story run. Branch: `fix/123-yacht-full-house`.
   Cost tier: standard. PR will follow.
   ```

4. If you abandon a story, post a comment saying so (and why) so the claim
   doesn't block others.

A stale claim (no activity for 24h, no open PR) may be taken over; comment
that you're taking it over.

## Running an epic

1. Read the epic and all children. Build the dependency graph from each
   child's "Blocked by" / "Blocks" lines.
2. For each child, predict the files it will touch (Phase 1 scope).
3. **Parallel batches**: stories with no unmet dependencies and **no
   overlapping files** can run at the same time, each in its own worktree
   (`Agent` with `isolation: "worktree"`, `run_in_background: true`).
   Stories that overlap files run one after the other, or in the same PR if
   they meet the bundling rule.
4. Cap concurrency at about 4 implementers at once; more mostly creates merge
   conflicts.
5. A story blocked on an owner decision blocks only its dependents. Keep the
   rest moving.
6. When a story merges, re-check which stories it unblocked and dispatch them
   from a fresh `origin/dev`.

## Merge order and conflicts

When two or more of your PRs are green and would conflict with each other:

1. **Dependency order first** — a story another story depends on merges first.
2. **Then the more expensive PR first** (`cost:max` > `high` > `standard` >
   `low`), so the follow-up conflict work lands on the cheaper PR.
3. **Then the older PR first.**

Don't hold a ready cheap PR for long just because an expensive one _might_
conflict later — if the expensive PR is still in review, merge the cheap one
now. Conflict resolution is delegated by difficulty, not by who wrote the
code:

| Conflict                                              | Who resolves                                   |
| ----------------------------------------------------- | ---------------------------------------------- |
| Lockfiles, generated files                            | Regenerate with the repo's tooling (`haiku`)   |
| Docs, imports, adjacent but independent edits         | `haiku`                                        |
| Same function changed on both sides, logic must merge | `sonnet`                                       |
| Both sides changed the same behavior differently      | Owner decision — picking either loses behavior |

Resolve by merging `origin/dev` into the PR branch (no rebase or force-push on
a branch someone else may have checked out). Re-run local checks and the
test-integrity audit after resolving; post a one-line PR comment naming the
resolver tier and what conflicted.

PRs from other sessions: never push to them. If one of yours conflicts with
another session's PR, follow the merge order using that PR's `cost:*` label;
if it's ready first, let it merge and resolve on your side.

## Labels

- `cost:low` / `cost:standard` / `cost:high` / `cost:max` — highest tier
  used on the PR (create them if missing).
- `blocked:owner-decision` — on the decision issue and on each story it blocks.
- Area labels (`hearts`, `yacht`, `backend`, `ios`, ...) — copied from the story.
