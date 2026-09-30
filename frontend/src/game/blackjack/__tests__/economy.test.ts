/**
 * #2788 — Blackjack's arcade economy contract.
 *
 * Chips are a run-local, fictional resource: they can't be bought, restored,
 * sold or redeemed, and nothing offers paid continuation. Premium grants access
 * to the game only. See docs/games/blackjack.md.
 *
 * The source scans are a tripwire against accidental regressions, not a
 * security boundary: they can't catch every way to wire up a purchase.
 */
import * as fs from "fs";
import * as path from "path";
import { newGame, newHand, placeBet, stand, EngineState } from "../engine";
import { TABLE_CONFIGS } from "../tables";

const SRC = path.resolve(__dirname, "../../..");

function listFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      listFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const blackjackSources = [
  ...listFiles(path.join(SRC, "game/blackjack")),
  ...listFiles(path.join(SRC, "components/blackjack")),
  ...fs
    .readdirSync(path.join(SRC, "screens"))
    .filter((f) => /^Blackjack.*\.tsx$/.test(f))
    .map((f) => path.join(SRC, "screens", f)),
];

describe("Blackjack economy — no purchase path (#2788)", () => {
  it("finds the blackjack sources", () => {
    expect(blackjackSources.length).toBeGreaterThan(8);
  });

  it.each(blackjackSources.map((f) => [path.relative(SRC, f), f]))(
    "%s imports no purchase, IAP or entitlement-check module",
    (_name, file) => {
      const text = fs.readFileSync(file as string, "utf8");
      const imports =
        text.match(
          /^\s*(?:import|export)\b[^;]*?\bfrom\s+["'][^"']+["']|\brequire\(\s*["'][^"']+["']\s*\)|\bimport\(\s*["'][^"']+["']\s*\)/gm
        ) ?? [];
      for (const line of imports) {
        expect(line).not.toMatch(/purchase|iap|revenuecat|storekit|billing|paywall/i);
        // premiumLevels is the per-level "coming soon" lock (#1129), never a chip source.
        if (/entitlement/i.test(line)) expect(line).toMatch(/premiumLevels/);
      }
    }
  );

  it("no source offers buying, refilling, restoring or redeeming chips or a continue", () => {
    const banned =
      /(buy|purchase|refill|restore|redeem|top[-_]?up|revive|extra[_]?life)[A-Za-z_]{0,12}chips|chips[A-Za-z_]{0,12}(purchase|refill|redeem)|continueRun|buyContinue|secondChance/i;
    for (const file of blackjackSources) {
      expect({ file, hit: banned.test(fs.readFileSync(file, "utf8")) }).toEqual({
        file,
        hit: false,
      });
    }
  });
});

describe("Blackjack economy — chips are run-local (#2788)", () => {
  it.each(TABLE_CONFIGS.map((t) => [t.id, t]))(
    "%s: a new run always opens with the table's configured stack",
    (_id, t) => {
      const table = t as (typeof TABLE_CONFIGS)[number];
      const cfg = {
        startingChips: table.startingChips,
        runGoal: table.runGoal,
        betMin: table.betMin,
        betMax: table.betMax,
      };
      const run = newGame(undefined, cfg);
      expect(run.chips).toBe(table.startingChips);
      expect(run.phase).toBe("betting");
    }
  );

  it("betting and dealing never add chips beyond a hand's own settlement bounds", () => {
    const start = newGame(undefined, { startingChips: 100, betMin: 5, betMax: 25, runGoal: 250 });
    expect(start.chips).toBe(100);
    const dealt = placeBet(start, 25);
    // Chips never exceed the bankroll + the maximum possible 3:2 payout on that bet.
    expect(dealt.chips).toBeLessThanOrEqual(100 + Math.ceil(25 * 1.5));
    expect(dealt.chips).toBeGreaterThanOrEqual(100 - 25);
  });

  it("a wager the stack can't cover is rejected rather than topped up", () => {
    const s = newGame(undefined, { startingChips: 100, betMin: 5, betMax: 500, runGoal: null });
    expect(() => placeBet(s, 400)).toThrow("Insufficient chips.");
    expect(s.chips).toBe(100);
  });

  it("a busted run has no way forward in the engine: no bet, no zero bet, no stand, no refill", () => {
    const base = newGame(undefined, { startingChips: 100, betMin: 5, betMax: 100, runGoal: null });
    const result: EngineState = { ...base, chips: 0, phase: "result" };
    expect(() => stand(result)).toThrow();
    // newHand reaches the betting phase with no chips; betting must still be refused.
    const betting = newHand(result);
    expect(betting.phase).toBe("betting");
    expect(betting.chips).toBe(0);
    expect(() => placeBet(betting, 0)).toThrow();
    expect(() => placeBet(betting, 1)).toThrow();
    expect(() => placeBet(betting, 5)).toThrow();
    expect(betting.chips).toBe(0);
  });

  it("a short stack (below the table minimum) may still go all-in, but never bet zero", () => {
    const base = newGame(undefined, { startingChips: 3, betMin: 5, betMax: 25, runGoal: null });
    expect(() => placeBet(base, 0)).toThrow();
    expect(placeBet(base, 3).bet).toBe(3);
  });

  it("the engine exposes no purchase-shaped API", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = Object.keys(require("../engine"));
    expect(
      api.filter((k) => /buy|purchase|refill|restore|redeem|continue|revive/i.test(k))
    ).toEqual([]);
  });
});

describe("Blackjack economy — English copy (#2788)", () => {
  it("no English blackjack string offers buying, restoring or continuing for money", () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(SRC, "i18n/locales/en/blackjack.json"), "utf8")
    ) as unknown;
    const values: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") values.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(en);
    expect(values.length).toBeGreaterThan(20);
    const banned =
      /\b(buy|purchase|refill|restore|redeem|top[- ]?up|revive)\b[^.]{0,20}\bchips?\b|\bchips?\b[^.]{0,20}\b(purchase|refill|redeem)\b|continue for|extra lives?|second chance|\$\s?\d/i;
    expect(values.filter((v) => banned.test(v))).toEqual([]);
  });
});
