/**
 * #2788 — Blackjack's arcade economy contract.
 *
 * Chips are a run-local, fictional resource: they can't be bought, restored,
 * sold or redeemed, and nothing offers paid continuation. Premium grants access
 * to the game only. See docs/games/blackjack.md.
 */
import * as fs from "fs";
import * as path from "path";
import { newGame, placeBet, stand, EngineState } from "../engine";
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
      const imports = text.match(/^\s*import[^;]*from\s+["'][^"']+["']/gm) ?? [];
      for (const line of imports) {
        expect(line).not.toMatch(/purchase|iap|revenuecat|storekit|billing|paywall/i);
        // premiumLevels is the per-level "coming soon" lock (#1129), never a chip source.
        if (/entitlement/i.test(line)) expect(line).toMatch(/premiumLevels/);
      }
    }
  );

  it("no source offers buying, refilling, restoring or redeeming chips or a continue", () => {
    const banned =
      /(buy|purchase|refill|restore|redeem|top[- ]?up|revive|extra[_ ]life)[A-Za-z_ ]{0,12}chips|chips[A-Za-z_ ]{0,12}(purchase|refill|redeem)|continueRun|buyContinue|secondChance/i;
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
      const first = newGame(undefined, cfg);
      expect(first.chips).toBe(table.startingChips);
      // A previous run's outcome never carries into the next one.
      const broke: EngineState = { ...first, chips: 0, phase: "result" };
      const rich: EngineState = { ...first, chips: table.runGoal * 10, phase: "victory" };
      for (const prev of [broke, rich]) {
        expect(prev.chips).not.toBe(table.startingChips);
        const next = newGame(undefined, cfg);
        expect(next.chips).toBe(table.startingChips);
        expect(next.phase).toBe("betting");
      }
    }
  );

  it("only a hand's settlement changes chips: betting and dealing never add any", () => {
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

  it("a busted run has no way forward in the engine: no bet, no stand, no refill", () => {
    const base = newGame(undefined, { startingChips: 100, betMin: 5, betMax: 100, runGoal: null });
    const s: EngineState = { ...base, chips: 0, phase: "result" };
    expect(() => placeBet(s, 5)).toThrow();
    expect(() => stand(s)).toThrow();
    expect(s.chips).toBe(0);
  });

  it("the engine exposes no purchase-shaped API", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = Object.keys(require("../engine"));
    expect(
      api.filter((k) => /buy|purchase|refill|restore|redeem|continue|revive/i.test(k))
    ).toEqual([]);
  });
});
