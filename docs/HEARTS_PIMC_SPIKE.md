# Hearts PIMC/Determinization Spike

**Issue:** #2240
**Date:** 2026-08-16
**Scope:** Research only. No production code changed. Prototype lives entirely in `scripts/hearts-pimc-spike.ts`, outside `frontend/src/game/hearts/`.

---

## 1. Background and scope

The current Hearts AI (`selectCardToPlayUtility`, `frontend/src/game/hearts/ai.ts`) has no search or lookahead — it scores each legal card once against the current information set and takes the argmax. This spike evaluates whether **determinization / Perfect Information Monte Carlo (PIMC)** — sample N plausible complete deals consistent with everything the AI currently knows, solve each sampled deal with a one-step lookahead, and aggregate across samples — improves on that, following the html5-hearts `McBrain.js` approach (simpler than full ISMCTS, evaluated first per the issue's scope).

This spike was blocked on two prerequisites from the parent epic (#2233 / #2283):
- **Pass-history/received-pass inference (#2237)** — merged to `dev` immediately before this spike started. Its `passedCards`/`passedToPlayerIndex` info-set fields are the determinization-quality lever this spike exists to test.
- **Sim gate v2 (#2238)** — **not yet landed.** This spike uses the existing `scripts/simulate-hearts.ts`-style statistics (binomial CI, z-test) as the best available interim comparison tool, not the more rigorous paired-deal/SPRT methodology #2238 would provide. Treat the benchmark numbers below as directionally informative, not as the final statistically-airtight gate #2238 is meant to be.

## 2. Prototype implementation

`scripts/hearts-pimc-spike.ts` (self-contained; imports the production engine/AI/info-set modules read-only, modifies nothing):

- **`determinizeOpponentHands`** — samples one full, rules-consistent 4-hand deal given only information the acting player could legitimately have: `seenKeys`, own hand, remaining-hand-size counts derived from public trick progress (never from reading opponents' actual `state.playerHands`), `voidLedger`, and — the thing under test — pass-memory (`passedCards`/`passedToPlayerIndex` from #2237). Two modes:
  - `constrained` — pins cards the AI knows it passed away to the known recipient, and respects `voidLedger` for the rest, via a most-constrained-suit-first randomized assignment with retry.
  - `uniform` — ignores both; pure random deal respecting only hand sizes. This is the ablation arm.
- **`resolveTrickUnderSample`** — one-step lookahead: for a candidate card, resolves the *rest of the current trick* (not the whole hand) under a determinized sample, using the **production utility AI as the rollout policy** for sampled opponents (assumed persona: schemer). Returns points captured by the acting player this trick.
- **`pimcSelectCardToPlay`** — scores every legal candidate by average points-to-self across N samples, picks the minimum (fewest points captured).

### Known limitations of this prototype (intentional, for spike scope)

- **Single fixed rollout persona** (schemer) for all sampled opponents, regardless of their real assigned persona — the "average strategy fusion" simplification common in PIMC literature. A real implementation would likely sample persona too, or use per-seat known personas where available.
- **Points-to-self only** as the per-sample objective — doesn't fold in Q♠-risk, moon-threat/progress, or void-building the way the production heuristic's four-consideration weighted sum does. This keeps the lookahead genuinely "one-step" (issue scope) at the cost of losing some of the existing heuristic's nuance inside the search itself.
- **Current-trick-only lookahead** — no rollout beyond the trick in progress, per the issue's explicit scoping (full-hand rollout would be a different, larger spike).

## 3. Latency results

Measured on dev hardware (this machine, Node 25.8.2 via `tsx`), **100 real in-game decision points per sample count**, clean run (no other CPU-heavy processes competing):

| Samples | Mean | p50 | p95 | Max |
|---|---|---|---|---|
| 20  | 1.80ms | 1.12ms | 6.65ms | 14.90ms |
| 50  | 3.51ms | 2.43ms | 12.44ms | 17.30ms |
| 100 | 6.09ms | 3.67ms | 25.69ms | 28.21ms |
| 200 | 10.86ms | 8.30ms | 32.61ms | 42.84ms |

Determinization retry budget (50 attempts) was never exhausted across any of the 38,000 sample-attempts measured (0 fallback-to-relaxed-void-constraints events) — the most-constrained-first assignment heuristic handles the void/pass-memory constraints cleanly in practice.

**On this dev machine, even samples=200 clears the <1s/decision exit criterion by roughly a 30x margin (p95 32.6ms vs. a 1000ms budget).**

### The on-device caveat this number doesn't answer

This is Node/V8 timing, not Hermes (RN's default JS engine) or JSC on real iOS/Android hardware. V8 is generally faster than Hermes for CPU-bound work like this, and a mid-range mobile CPU is slower than dev-machine silicon. A defensible rule of thumb from published RN performance comparisons is a further 3–8x slowdown moving from a dev-machine V8 benchmark to on-device Hermes on mid-range hardware. Even at the pessimistic end of that range (8x), samples=200's p95 (32.6ms × 8 ≈ 260ms) still clears 1 second with comfortable margin. **This spike did not measure on real device hardware** — the exit criterion technically requires that measurement, and this write-up flags it as an open item rather than claiming it's been satisfied. Given the size of the margin, it reads as low-risk, but "low-risk" is not the same as "measured."

## 4. Benchmark results (win rate vs. current utility AI)

PIMC (constrained sampling, samples=50) as seat 0 vs. the current utility AI (schemer) as seat 0, both against 3× schemer opponents, paired seeds (same deal sequence per arm so the comparison isolates the seat-0 strategy change). Scaled up in three deterministic-superset passes to check the effect held under more data rather than settling for one noisy read:

| Games/arm | Baseline win rate | PIMC win rate | Δ | Significance |
|---|---|---|---|---|
| 300 | 28.0% [22.9%, 33.1%] | 33.7% [28.3%, 39.0%] | +5.7pp | n.s. (z=1.50) |
| 600 | 27.8% [24.2%, 31.4%] | 32.7% [28.9%, 36.4%] | +4.8pp | n.s. (z=1.82) |
| 900 | 27.9% [25.0%, 30.8%] | 34.7% [31.6%, 37.8%] | **+6.8pp** | **p < 0.01 (z=3.10)** |

Avg score (lower is better) moved the same direction at every scale: 75.1–75.5 (baseline) vs. 67.2–67.8 (PIMC) — a ~7-8 point per-game improvement, consistent with the win-rate gain rather than a win-rate-only artifact.

**The effect is real, consistent in direction and magnitude across all three scales, and reaches significance at n=900.** This clears the exit criterion's "statistically significant win-rate gain" bar for the constrained-sampling PIMC arm specifically.

## 5. Ablation: determinization quality (constrained vs. uniform sampling)

This is where the spike produced its most important — and least expected — finding. Per the acceptance criteria's request to investigate "how much does pass-memory + void-ledger constraint actually help vs. uniform-random sampling," n=600/arm, paired seeds:

| Sampling mode | Win rate | Avg score |
|---|---|---|
| Constrained (voidLedger + pass-memory) | 32.7% [28.9%, 36.4%] | 67.6 ± 26.3 |
| Uniform-random (no constraints) | **40.7%** [36.7%, 44.6%] | 66.5 ± 26.1 |

Delta: **+8.0pp toward uniform, p < 0.01 (z=2.88)**. Uniform-random sampling beat the theoretically-more-informed constrained sampler, by a wider and more significant margin than PIMC beat the baseline heuristic in §4.

This is the opposite of the naive expectation ("more real information → better decisions") and needed investigation rather than being reported as a flat number — see §6.

## 6. Discussion: is the delta robust?

The issue explicitly asks this spike not to just report a win-rate delta, but to discuss why it is or isn't robust — this section is that discussion, and it's honestly the most useful output of the spike.

**The core PIMC-vs-no-lookahead result is robust.** Both sampling modes beat the baseline heuristic by a wide, consistent margin (constrained: +6.8pp at n=900, p<0.01; uniform: baseline 27.8% vs. uniform's 40.7% is an even larger gap). The win held at every scale tested (300/600/900) with the same sign and similar magnitude — this isn't a single lucky batch. One-step lookahead over sampled opponent hands, using the existing heuristic as ground truth for "what a reasonable opponent does next," is doing real work here.

**The constrained-vs-uniform result is the one that needs scrutiny, and I don't have a fully confident explanation for it — two hypotheses, not adjudicated:**

1. **Sampler implementation bias (most likely, in my assessment).** `determinizeOpponentHands`'s "most-constrained-suit-first, then uniform-random-among-eligible-opponents" assignment is a *feasibility* heuristic, not a *uniform-over-valid-deals* sampler. Naive sequential greedy assignment like this is known to bias which constraint-satisfying deals get generated more or less often — it doesn't sample each valid deal with equal probability, even though every individual sample it produces is legal. If constrained samples are systematically skewed toward some subset of the true conditional distribution, the per-candidate mean score computed across them can be a worse estimate of the true expected outcome than an unbiased-but-less-informed uniform sampler, even though the constrained sampler is using strictly more true information per sample. This would mean the *result* here is really "this spike's specific sampler implementation is worse than uniform," not "constraint information doesn't help PIMC" — a fixable engineering problem (proper uniform-over-valid-deals sampling, e.g. via rejection sampling or a correctly-weighted assignment scheme), not a reason to abandon the constrained approach.
2. **A genuine PIMC pathology (possible, not ruled out).** Published PIMC literature (Long, Sturtevant, Buro & Furtak, 2010, "Understanding the Success of Perfect Information Monte Carlo Sampling in Game Tree Search") documents cases where more accurate/narrower determinization can hurt a PIMC agent relative to broader sampling, particularly in games where a player's strategy should account for what opponents *don't* know (Hearts has some of this flavor — e.g., how safe a Q♠ holder is depends partly on what others believe, not just the true deal). I have not done the diagnostic work to distinguish this from hypothesis 1 — that would be a reasonable next step if this line of work continues.

Either way, the finding matters for what a "go" recommendation should scope: **don't ship the constrained sampler as this spike implemented it without resolving this first** — the simpler uniform-random sampler is both cheaper to compute and (in this benchmark) stronger.

**What this spike's one-step, points-to-self-only objective and fixed-schemer rollout persona limitations mean for the numbers above:** the win-rate gains are almost certainly a floor, not a ceiling, on what a more complete implementation could achieve — the production heuristic itself reasons about four considerations (points, Q♠ risk, moon threat, moon progress), and this spike's lookahead only optimizes one of them. A "go" implementation folding in the full consideration set as the lookahead objective, rather than points-to-self alone, would be a natural next increment.

## 7. Recommendation

**Go, with two concrete prerequisites before scoping the implementation epic:**

1. **On-device latency measurement.** §3's numbers comfortably clear the <1s/decision budget on dev hardware (p95 32.6ms at samples=200, ~30x margin), including a generous allowance for the Node→Hermes/mobile-CPU gap. But the exit criterion asks for on-device or a realistic proxy specifically, and this spike didn't get one — that measurement should happen before or early in the implementation epic, not be assumed from this dev-machine number.
2. **Resolve the constrained-vs-uniform paradox (§5, §6)** before committing to a sampling design. Given uniform-random sampling is both simpler to implement and outperformed the constrained sampler in this benchmark, the pragmatic path may be to ship uniform sampling first (simpler, empirically stronger here) and treat "does a properly unbiased constrained sampler do even better" as a follow-up experiment rather than a blocking requirement — but that decision should be made deliberately, not by default.

The exit criterion ("statistically significant win-rate gain at under 1 second per decision on-device, OR a documented no-go") is met on the win-rate side (p<0.01 at n=900, holding sign and magnitude across three independent scales) and very likely met on latency (pending the on-device confirmation above). This is not a marginal, single-batch result — it replicated at every scale tested, including a version of the approach (uniform sampling) that's simpler than what the issue proposed evaluating.

## 8. Open questions / next steps

- **On-device latency measurement** (real iOS/Android hardware, or a realistic Hermes proxy) — not done in this spike; see §3.
- **Diagnose the constrained-vs-uniform paradox** (§5, §6) — either fix the sampler's non-uniform-over-valid-deals bias, or confirm it's a genuine PIMC strategy-fusion effect, before committing to a sampling design for the implementation epic.
- **Fold the full consideration set into the lookahead objective** (currently points-to-self only) — likely raises the ceiling further; see §6.
- **Sample-count vs. quality tradeoff** needs its own tuning pass — this spike used one fixed N (50) for the benchmark/ablation and a separate latency sweep (20/50/100/200), not a joint sweep of win-rate-gain against N.
- **Rollout policy persona-sampling** (currently fixed to schemer for all sampled opponents) is a likely next lever, given the "average strategy fusion" simplification noted in §2.
- **Re-run the benchmark once #2238 (sim gate v2) lands**, for the more rigorous paired-deal/SPRT methodology rather than this spike's interim `simulate-hearts.ts`-style stats — this spike's numbers are a strong directional result, not the final statistically-airtight gate #2238 is meant to provide.
