/**
 * Seeded simulator run for the principle checker (#3161): plays games with
 * one persona in all four seats (harness.ts `playGame`), captures every
 * decision — each pass with the 13 cards dealt, each card play with the
 * completed tricks so far — and checks it with `checkDecision`
 * (principles.ts). The sim gate requires zero violations for the
 * conservative CPU (docs/TESTING.md).
 *
 * Games are dealt from (seed, game) streams exactly as the sim gate's are, so
 * a run is repeatable; the first `hands` hands are checked and the rest of
 * the last game is played but not checked.
 */

import { playGame, personaPolicy, type Policies } from "./harness";
import {
  CHECKS,
  checkDecision,
  legalCards,
  toRulebookYaml,
  type CheckId,
  type CompletedTrick,
  type PrincipleId,
  type Violation,
} from "./principles";
import type { AiPersona } from "../../src/game/hearts/types";

/** Default seed of the principle check (the story number). */
export const PRINCIPLE_SEED = 3161;

export interface PrincipleRunOptions {
  readonly persona: AiPersona;
  readonly hands: number;
  readonly seed?: number;
  /** Example positions kept per principle (default 5). */
  readonly examples?: number;
}

export interface PrincipleRunReport {
  readonly persona: AiPersona;
  readonly seed: number;
  readonly hands: number;
  readonly games: number;
  /** Decisions captured (passes + card plays). */
  readonly decisions: number;
  /** Decisions with more than one legal option, i.e. ones a principle can judge. */
  readonly judged: number;
  readonly violations: number;
  readonly byPrinciple: Readonly<Partial<Record<PrincipleId, number>>>;
  readonly byCheck: Readonly<Partial<Record<CheckId, number>>>;
  /** The first `examples` violations of each principle, in play order. */
  readonly examples: Readonly<Partial<Record<PrincipleId, readonly Violation[]>>>;
}

/** Plays `hands` hands of `persona` x4 and checks every decision. */
export function runPrincipleCheck(options: PrincipleRunOptions): PrincipleRunReport {
  const { persona, hands } = options;
  if (!(Number.isInteger(hands) && hands >= 1)) {
    throw new RangeError(`hands must be a positive integer (got ${hands})`);
  }
  const seed = options.seed ?? PRINCIPLE_SEED;
  const keep = options.examples ?? 5;
  const policy = personaPolicy(persona);
  const policies: Policies = [policy, policy, policy, policy];

  let handsSeen = 0;
  let decisions = 0;
  let judged = 0;
  let violations = 0;
  const byPrinciple: Partial<Record<PrincipleId, number>> = {};
  const byCheck: Partial<Record<CheckId, number>> = {};
  const examples: Partial<Record<PrincipleId, Violation[]>> = {};

  let game = 0;
  let handKey = "";
  let checking = false;
  let played: CompletedTrick[] = [];

  /** Called with each decision's hand number: counts hands and stops after `hands`. */
  const enterHand = (handNumber: number) => {
    const key = `${game}:${handNumber}`;
    if (key === handKey) return;
    handKey = key;
    played = [];
    checking = handsSeen < hands;
    if (checking) handsSeen++;
  };

  const record = (v: Violation | null, forced: boolean) => {
    decisions++;
    if (!forced) judged++;
    if (!v) return;
    violations++;
    byPrinciple[v.principleId] = (byPrinciple[v.principleId] ?? 0) + 1;
    byCheck[v.check] = (byCheck[v.check] ?? 0) + 1;
    const list = (examples[v.principleId] ??= []);
    if (list.length < keep) list.push(v);
  };

  while (handsSeen < hands) {
    playGame(policies, seed, game, {
      onPass: (state, seat, cards) => {
        enterHand(state.handNumber);
        if (!checking) return;
        const decision = {
          kind: "pass" as const,
          seat,
          direction: state.passDirection,
          hand: [...state.playerHands[seat]!],
          chosen: [...cards],
        };
        record(checkDecision(decision), false);
      },
      onPlay: (state, seat, card) => {
        enterHand(state.handNumber);
        const trick = [...state.currentTrick];
        if (checking) {
          const decision = {
            kind: "play" as const,
            seat,
            trickNumber: state.tricksPlayedInHand + 1,
            hand: [...state.playerHands[seat]!],
            played: [...played],
            trick,
            heartsBroken: state.heartsBroken,
            points: [...state.handScores],
            chosen: card,
          };
          const v = checkDecision(decision);
          // checkDecision returns null for forced plays too; count those apart.
          record(v, legalCards(decision).length <= 1);
        }
        if (trick.length === 3) {
          played = [
            ...played,
            { lead: trick[0]!.playerIndex, cards: [...trick.map((t) => t.card), card] },
          ];
        }
      },
    });
    game++;
  }

  return {
    persona,
    seed,
    hands: handsSeen,
    games: game,
    decisions,
    judged,
    violations,
    byPrinciple,
    byCheck,
    examples,
  };
}

/** Human-readable report: counts per principle and check, then example positions. */
export function formatPrincipleReport(r: PrincipleRunReport): string {
  const out: string[] = [];
  out.push(
    `Hearts principle check — ${r.persona} x4, seed ${r.seed}: ${r.hands} hands (${r.games} games), ` +
      `${r.decisions} decisions, ${r.judged} with a choice`
  );
  out.push(`Violations: ${r.violations}`);
  const principles = Object.keys(r.byPrinciple).sort() as PrincipleId[];
  for (const p of principles) {
    out.push(`  ${p}: ${r.byPrinciple[p]}`);
    const checks = (Object.entries(r.byCheck) as [CheckId, number][]).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    for (const [check, n] of checks) {
      if (CHECKS[check].principle === p) out.push(`    ${check} (${CHECKS[check].kind}): ${n}`);
    }
  }
  for (const p of principles) {
    const list = r.examples[p] ?? [];
    out.push("", `--- ${p}: first ${list.length} example position(s) (rulebook yaml) ---`);
    list.forEach((v, i) => {
      out.push("```yaml", toRulebookYaml(v, `SIM-${p.slice(0, 2)}-${i + 1}`), "```", "");
    });
  }
  return out.join("\n");
}
