# Yacht Optimal-Play EV Oracle

**Issue:** #2243
**Scope:** Ground-truth optimal-EV table + runtime lookup API for the Yacht AI. Feeds the future Hard-difficulty tier and the AI simulator's regret metric (separate stories, not part of this one).

---

## 1. What this is

Solitaire Yacht is a solved game: a dynamic-programming pass over every reachable scorecard state produces the exact expected value of optimal play. This ships that as a precomputed lookup table plus a small runtime API, so AI strength and decision quality can be measured against ground truth instead of estimated via win rates or hand-tuned heuristics.

**Not part of this story:** wiring the oracle into the live difficulty tiers or the simulator's regret metric — those are separate epic stories that consume this API once it exists.

## 2. State model

A scorecard's _future_ value depends only on three things — not on which specific categories were filled or their exact scored values (those are sunk cost that can't affect future optimal play):

- **Fill mask** — which of the 12 non-yacht categories are still open (12 bits).
- **Yacht status** — `open` / `filled with 50` / `filled with 0`. Not a plain fill bit: whether "yacht" was filled with 50 (unlocking the Joker rule for future 5-of-a-kind rolls) or with 0 (Joker never unlocks) changes future legal-category rules and scoring formulas, so it needs 3 values, not 2.
- **Upper subtotal, capped at 63** — the bonus threshold. Capping is lossless: once the subtotal reaches 63, the exact excess never matters again for any future decision.

This is `frontend/src/game/yacht/oracle/stateKey.ts`'s `encodeKey`/`decodeKey`. Total dense table size: `4096 masks × 3 yacht statuses × 64 upper-subtotal values = 786,432` slots (not all reachable — the solver prunes upperCapped values that are provably unreachable given which upper categories are filled, and normalizes upperCapped to a canonical 0 once the upper section is complete, since it stops mattering).

## 3. Rule fidelity — the highest-risk part

`stateKey.ts` is the single source of truth for scoring transitions and Joker-rule legality, shared by **both** the offline solver and the runtime oracle — it's built directly on `engine.ts`'s real `calculateScore`/`calculateJokerScore`, not a parallel reimplementation. A rule mismatch between the solver and the shipped game shifts the optimal EV by roughly 9 points (per published cross-checks of this exact problem), which is how such a bug would be caught — hence the randomized cross-validation test (`oracle/__tests__/stateKey.test.ts`) that plays many real games through the actual engine and compares every scoring decision point against `stateKey.ts`'s output, not just a few hand-picked cases.

The Joker rule's three-tier legal-category priority (mandatory matching-upper, then open-lower-except-yacht, then any open upper) is replicated exactly in `legalCategoriesFor` — getting this restriction wrong would let the solver consider category choices that aren't actually legal in the shipped game, silently inflating the computed optimal EV.

## 4. Architecture

| Module                            | Shipped?        | Purpose                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oracle/stateKey.ts`              | Yes             | State encoding + engine-faithful scoring transitions (§3).                                                                                                                                                                                                                                                       |
| `oracle/multisetIndex.ts`         | Yes             | Dice-multiset indexing + hold/reroll transition tables. Pure combinatorics, no rule-drift risk — reused by both the offline solver and live hold-EV queries.                                                                                                                                                     |
| `oracle/microDp.ts`               | Yes             | The per-turn micro-DP (`solveStateVTG`, `computeArr0`, `computeHoldLayer`) — the SAME core computation used both by the offline solver (wrapped in the full retrograde sweep) and by live `optimalHoldEVs`/`optimalCategoryEVs` queries (evaluated for one specific dice roll instead of averaged over all 252). |
| `oracle/oracle.ts`                | Yes             | Public API: `optimalStateEV`, `optimalCategoryEVs`, `optimalHoldEVs`. Lazy-loads the generated table.                                                                                                                                                                                                            |
| `oracle/oracleTable.generated.ts` | Yes             | Generated data asset — committed, not hand-edited. See §5.                                                                                                                                                                                                                                                       |
| `oracleBuild/solver.ts`           | No (build-only) | The outer retrograde loop over all ~786K states. Takes tens of minutes; must never run on-device. Not imported by any app screen/component, so Metro never bundles it.                                                                                                                                           |
| `scripts/build-yacht-oracle.ts`   | No (build-only) | CLI entry point: `npx tsx scripts/build-yacht-oracle.ts`. Regenerate after any change to `stateKey.ts`'s scoring/transition rules.                                                                                                                                                                               |

**Why `oracleBuild/` lives under `frontend/src/` despite being build-only:** so it's covered by the same Jest config/conventions as the rest of the codebase (describe/it, `setRng`/`createSeededRng`, etc.) rather than a second, differently-configured test setup. It's kept out of the shipped bundle by construction — nothing under `oracle/` or any app screen ever imports it, only the standalone script does.

## 5. Generated table format

- **Encoding**: `Float32Array` of `ORACLE_TABLE_SIZE` (786,432) entries, base64-encoded, embedded in a generated TypeScript module. Index `i` is `VTG(i)` — expected _additional_ score ("value to go") for scorecard-state key `i`, not including points already scored.
- **Why a TS module, not a binary asset file**: avoids Metro's native-asset resolution pipeline (and its web/native platform-split complexity) entirely — it's just a plain JS string constant, resolved identically by Jest/Node and Hermes/React Native.
- **Why base64, not raw binary**: the acceptance criteria explicitly allows either; a TS-module string constant only supports the former without extra tooling.
- **Why Float32, not Float64**: halves the raw table size (3.0 MB vs 6.3 MB) with no observed precision cost for this use case — EV values in the 0-300ish range need nowhere near Float32's ~7 significant digits.
- **Lazy loading**: `oracle.ts`'s `loadTable()` uses a lazy `require()` inside the function body (not a top-level import, and not dynamic `import()` — see §6) so the multi-MB payload is never parsed during app startup, only on first actual oracle query.

**Build results** (this table's actual build, `oracleTable.generated.ts`'s header has the full record):

|                                                               |                                                                                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| States computed                                               | 579,262 (of 786,432 dense slots — the rest pruned as unreachable)                                                                                                                        |
| Build time                                                    | 2,182s (~36.4 min)                                                                                                                                                                       |
| Generated file size                                           | 4.00 MB as source text                                                                                                                                                                   |
| Optimal EV at game start                                      | 254.4848                                                                                                                                                                                 |
| Published reference (Verhoeff / Glenn 2006, joker+bonus rule) | 254.5896                                                                                                                                                                                 |
| Difference                                                    | 0.105 (0.04% relative) — Float32 quantization + accumulated floating-point error across ~579K states, not a rule gap; see §9 for how this was caught the first time it _was_ a rule gap. |

## 6. Why `require()`, not dynamic `import()`

Dynamic `import()` needs `--experimental-vm-modules` under this project's Jest/Babel setup, which isn't configured (and changing global Jest config for one feature wasn't worth the blast radius). A lazy `require()` call inside `loadTable()`'s function body defers module evaluation identically — the table isn't parsed/decoded until the function actually runs — while working unmodified in both Jest (no flags needed) and Metro (which resolves `require()` calls with a static string argument, satisfied here, without needing dynamic-import bundling support).

## 7. Performance

Measured on dev hardware (Node/tsx, not on-device — same dev-vs-mobile caveat as any Node benchmark in this codebase):

| Operation                         | Mean     | p95      |
| --------------------------------- | -------- | -------- |
| Table load (first call, one-time) | 242ms    | —        |
| `optimalStateEV`                  | 0.0011ms | 0.0019ms |
| `optimalCategoryEVs`              | 0.053ms  | 0.31ms   |
| `optimalHoldEVs`                  | 2.5ms    | 6.4ms    |

`optimalStateEV` is genuinely O(1) (direct array index) — the sub-microsecond numbers confirm it. `optimalCategoryEVs`/`optimalHoldEVs` evaluate a fresh per-roll micro-DP (§4) and are bounded but not O(1); both are comfortably sub-10ms even at the high end, nowhere near a perceptible UI delay for a per-turn decision.

**In-memory footprint**: ~19 MB heap delta after the table (Float32Array, ~3 MB) and hold-options structure (~254K precomputed transitions across 252 multisets) are both loaded — a one-time cost paid on first oracle use, not accumulated per query.

## 8. Regenerating the table

```
npx tsx scripts/build-yacht-oracle.ts
```

Takes tens of minutes on typical dev hardware — this matches published implementations of the same problem (Verhoeff, Glenn 2006, and others solving the same joker/bonus-score variant), not a performance bug in this implementation. Necessary whenever `stateKey.ts`'s scoring/transition logic changes; the generated file's header records when it was last built and from what state, so a stale table is at least detectable by inspection.

## 9. A real bug this table caught: the missing yacht/joker bonus

Worth recording, since it's exactly the kind of rule-fidelity failure mode #2243's acceptance criteria warned about. The first full solve (before this fix) computed an optimal EV of **245.966** — suspiciously close to the _no-joker-rule_ published figure (245.87), not the joker+bonus figure (254.59) this engine actually implements.

Root cause: `successorAfterScore` computed each category's own scored value (joker-aware via `calculateJokerScore` where applicable) but never added the separate **+100 yacht/joker bonus** (`engine.ts`'s `yacht_bonus_count × YACHT_BONUS_VALUE`, a component of `total_score` independent of the category's own recorded value) that the real engine awards on _every_ joker-active scoring action, not just when scoring "yacht" itself. The category-legality logic (which categories you're _allowed_ to pick during Joker) was correct; the _bonus points_ for exercising that rule were silently missing.

This shipped past the randomized 60-game cross-validation in `stateKey.test.ts` because joker-active scoring decisions are rare enough that the fuzz test's semi-random play didn't happen to hit one in that run — a reminder that a fuzz test's coverage of a rare rule branch isn't guaranteed, and a dedicated deterministic test for that branch (added alongside the fix) is what actually pins it down. After the fix, the full solve reproduced the published EV within 0.04% (§7).
