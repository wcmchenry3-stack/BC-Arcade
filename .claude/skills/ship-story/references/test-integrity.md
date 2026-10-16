# Test integrity

The rule in one line: **a failing test is evidence about the code until proven
otherwise.** Changing a test is allowed when the _intended behavior_ changed,
never to make _unintended behavior_ pass.

## What counts as "existing" vs "new"

- **New test**: added in this PR. You may change, rewrite, or delete it freely
  while the PR is open — including fixing your own flaky new test.
- **Existing test**: present on `origin/dev` when the branch was cut. Changes
  to these are what this policy governs.

## Decision table for existing tests

| Situation                                                                                                   | Allowed?                         | What to do                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Story intentionally changes the behavior the test asserts (an AC says so, or it follows directly from one)  | Yes — **update** the assertion   | Change only what the AC changes. Add a row to **Test changes** citing the AC.                                                                                                                                |
| Story removes the feature the test covers                                                                   | Yes — **delete**                 | Add a row citing the AC that removes the feature.                                                                                                                                                            |
| Test breaks because of a refactor that should preserve behavior (renamed export, moved file, new signature) | Yes — **mechanical update** only | Imports, names, fixtures shape. The expected _values_ must not change. Add a row marked "mechanical".                                                                                                        |
| Test fails and no AC explains the behavior change                                                           | **No**                           | Treat it as a bug in this PR. Fix the code. If you believe the old expectation is wrong, that is an owner decision (see escalation.md) — don't edit the test.                                                |
| Unclear whether the behavior change is intended                                                             | **No** until decided             | Owner decision issue. Work on other stories meanwhile.                                                                                                                                                       |
| Test is flaky and unrelated to this PR's code                                                               | **No** changes in this PR        | Re-run once to confirm. File a `bug` issue with the failing run link and the failure output; reference it on the PR. Don't skip, retry-wrap, or delete it.                                                   |
| Test is flaky and this PR touched the code or test it covers                                                | Yes — fix the **cause**          | Make the test deterministic (fake timers, seeded RNG, awaited state, stable selectors — see TESTING.md's Playwright rules). Not allowed: longer timeouts or retries as the only change. Row in Test changes. |

## Always treated as weakening (needs an explicit owner-approved reason)

- `.skip`, `xit`, `xdescribe`, `it.only`/`describe.only` left in, `test.fixme`,
  `@pytest.mark.skip`/`skipif` added, `xfail`, `pytest.importorskip` added.
- Removing an `expect`/`assert`, or replacing a precise matcher with a looser one
  (`toEqual` → `toBeDefined`/`toBeTruthy`, exact number → `toBeGreaterThan`).
- Updating snapshots (`-u`) without saying which snapshots and why each changed.
- Raising tolerances, timeouts, or retry counts; lowering coverage thresholds;
  editing sim gate thresholds (`hearts-sim-gate`, `yacht-sim-gate`).
- Editing fixtures/golden files so they match new output.
- Adding paths to test/coverage/lint ignore lists.

If one of these is genuinely right for an AC-driven change (e.g. a snapshot
of a screen the story redesigns), it is allowed — with a Test changes row that
names the AC. Without an AC, it needs an owner decision.

## The Test changes table (required in every PR body)

```
## Test changes
| Existing test | Change | Why (AC / mechanical / flaky-fix) |
| --- | --- | --- |
| frontend/src/game/hearts/__tests__/engine.test.ts › "passes left on round 1" | expected direction left → right | AC2: pass direction rotates starting right |
```

Write `None — only new tests added.` when no existing test was touched.

## Audit (orchestrator, Phase 3, and after every later push that touches tests)

1. List existing test files the PR changed or deleted:
   ```bash
   git diff --name-status origin/dev...HEAD -- \
     'frontend/**/__tests__/**' 'frontend/**/*.test.*' 'e2e/**' 'backend/tests/**' 'tools/**/test*'
   ```
   (`M`/`D`/`R` entries are existing tests; `A` are new.)
2. Grep the diff for the weakening patterns above:
   ```bash
   git diff origin/dev...HEAD | grep -nE '^\+.*(\.skip\(|\bxit\(|\bxdescribe\(|\.only\(|test\.fixme|mark\.skip|xfail|importorskip)'
   ```
   and read the `-` lines of each modified existing test for removed asserts
   or loosened matchers.
3. Every modified/deleted existing test and every weakening hit must have a
   matching Test changes row with a valid reason. Missing row or no valid
   reason → blocking finding; send it back to the implementer.
4. Post the audit result as part of the review-round comment.

## Brief for implementers (paste into the subagent prompt)

> Tests: add tests that fail without your change — every AC gets coverage and
> every bug fix gets a regression test. You may freely edit tests you added in
> this branch. For tests that existed before your branch: you may update one
> only when an AC intentionally changes the behavior it asserts, delete one
> only when an AC removes the feature, or make a mechanical update (imports,
> renames) that keeps the expected values. If an existing test fails and no AC
> explains it, assume your code is wrong and fix the code. Never skip, xfail,
> `.only`, delete, loosen, or raise timeouts on an existing test to make it
> pass. If you think an existing test's expectation is itself wrong, stop and
> report it instead of changing it. Report every existing test you modified,
> with the AC or reason, so it can go in the PR's Test changes table.
