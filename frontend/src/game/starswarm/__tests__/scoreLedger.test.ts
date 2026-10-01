/**
 * #2837: the per-wave score ledger — every award path credits the right source, the ledger
 * always reconciles to the score, it survives a save/restore, and its result block stays bounded.
 */
import {
  CANVAS_H,
  CANVAS_W,
  _resetIds,
  applyPowerUp,
  difficultyMultiplier,
  initStarSwarm,
  seedRng,
  tick,
  waveClearBonusPoints,
} from "../engine";
import {
  BREAKDOWN_MAX_BYTES,
  LEDGER_DETAIL_WAVES,
  WAVE_CLEAR_SOURCE,
  emptyScoreLedger,
  recordScore,
  scoreSource,
  summarizeScoreLedger,
  type ScoreLedger,
  type ScorePoints,
} from "../scoreLedger";
import { fitsSaveShape } from "../saveShape";
import type { Bullet, Enemy, EnemyTier, StarSwarmInput, StarSwarmState } from "../types";

const NO_INPUT: StarSwarmInput = { playerX: CANVAS_W / 2, fire: false };

function advanceMs(state: StarSwarmState, ms: number, input = NO_INPUT): StarSwarmState {
  let s = state;
  for (let t = 0; t < ms; t += 16) s = tick(s, 16, input);
  return s;
}

/** Ledger points credited so far, summed over every wave and the folded bucket. */
function ledgerTotal(l: ScoreLedger): number {
  const sum = (p: Readonly<ScorePoints>) => Object.values(p).reduce((a, b) => a + b, 0);
  return (l.earlier ? sum(l.earlier.pts) : 0) + l.waves.reduce((a, w) => a + sum(w.pts), 0);
}

function ptsFor(s: StarSwarmState, wave: number): Readonly<ScorePoints> {
  return s.scoreLedger.waves.find((w) => w.wave === wave)?.pts ?? {};
}

/** A quiet mid-wave state: nobody shoots or dives on their own. */
function quiet(difficulty: StarSwarmState["difficulty"] = "Ensign"): StarSwarmState {
  const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, difficulty), 8000);
  expect(s.phase).toBe("Playing");
  return {
    ...s,
    enemyFireDisabled: true,
    playerFireDisabled: true,
    asteroidsDisabled: true,
    dodgeDisabled: true,
    nextDiveTimer: 1e9,
    enemies: s.enemies.map((e) => ({ ...e, shootTimer: 1e9 })),
    player: { ...s.player, invincibleTimer: 0 },
  };
}

function shot(e: Enemy, id = 77_000): Bullet {
  return {
    id,
    x: e.x,
    y: e.y,
    vx: 0,
    vy: 0,
    owner: "player",
    width: e.width,
    height: e.height,
    damage: 999,
  };
}

function withEnemy(s: StarSwarmState, id: number, patch: Partial<Enemy>): StarSwarmState {
  return { ...s, enemies: s.enemies.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Parks an enemy where it is, in the given phase, for a tick. */
function parked(e: Enemy, phase: Enemy["phase"], x = e.x, y = e.y): Partial<Enemy> {
  const p = { x, y };
  return {
    phase,
    x,
    y,
    path: { p0: p, p1: p, p2: p, p3: p },
    pathT: -1,
    pathDuration: 1e6,
    circleCx: x,
    circleCy: y,
    circleRadius: 0,
    circleSpeed: 0,
  };
}

function firstOf(s: StarSwarmState, tier: EnemyTier): Enemy {
  const e = s.enemies.find((en) => en.isAlive && en.tier === tier);
  if (!e) throw new Error(`no ${tier}`);
  return e;
}

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

describe("award paths (#2837)", () => {
  it("a new run starts with an empty ledger", () => {
    expect(initStarSwarm(CANVAS_W, CANVAS_H).scoreLedger).toEqual(emptyScoreLedger());
  });

  it("a shot kill in formation credits the plain tier", () => {
    const s0 = quiet();
    const g = { ...firstOf(s0, "Grunt"), phase: "Formation" as const };
    const s = tick(
      withEnemy({ ...s0, playerBullets: [shot(g)] }, g.id, parked(g, "Formation")),
      16,
      NO_INPUT
    );
    expect(s.score).toBe(100);
    expect(ptsFor(s, 1)).toEqual({ [scoreSource("Grunt")]: 100 });
  });

  it("a shot kill of a diver credits the tier's dive source at 2×", () => {
    const s0 = quiet("Commander");
    const e = firstOf(s0, "Elite");
    let s = withEnemy(s0, e.id, { ...parked(e, "Circling"), hp: 1 });
    s = tick({ ...s, playerBullets: [shot(e)] }, 16, NO_INPUT);
    const pts = Math.round(200 * 2 * difficultyMultiplier("Commander"));
    expect(s.score).toBe(pts);
    expect(ptsFor(s, 1)).toEqual({ "Elite:dive": pts });
  });

  it("a shot kill of a fleeing grunt credits the rout source at 2×", () => {
    const s0 = quiet();
    const g = firstOf(s0, "Grunt");
    const s = tick(
      withEnemy({ ...s0, playerBullets: [shot(g)] }, g.id, parked(g, "Fleeing")),
      16,
      NO_INPUT
    );
    expect(s.score).toBe(200);
    expect(ptsFor(s, 1)).toEqual({ "Grunt:rout": 200 });
  });

  it("a Carrier kill credits the Carrier source", () => {
    const s0 = quiet();
    // Escorts gone so the Carrier's armor is down, then one lethal shot.
    let s: StarSwarmState = {
      ...s0,
      enemies: s0.enemies.map((e) =>
        e.tier === "Guardian"
          ? { ...e, isAlive: false, hp: 0 }
          : e.tier === "Carrier"
            ? { ...e, hp: 1 }
            : e
      ),
    };
    const c = firstOf(s, "Carrier");
    s = tick({ ...s, playerBullets: [shot(c)] }, 16, NO_INPUT);
    expect(s.enemies.find((e) => e.id === c.id)!.isAlive).toBe(false);
    expect(ptsFor(s, 1)).toEqual({ Carrier: 1000 });
    expect(s.score).toBe(1000);
  });

  it("a diver that rams the ship credits the ram source", () => {
    const s0 = quiet();
    const g = firstOf(s0, "Grunt");
    const s = tick(
      withEnemy(s0, g.id, parked(g, "Circling", s0.player.x, s0.player.y)),
      16,
      NO_INPUT
    );
    expect(s.enemies.find((e) => e.id === g.id)!.isAlive).toBe(false);
    expect(s.player.lives).toBe(s0.player.lives - 1);
    expect(ptsFor(s, 1)).toEqual({ "Grunt:ram": 200 });
    expect(s.score).toBe(200);
  });

  it("a collected Smart Bomb credits each kill to the tier's bomb source", () => {
    const s0 = quiet();
    const grunts = s0.enemies.filter((e) => e.isAlive && e.tier === "Grunt").length;
    const bomb = {
      id: 66_000,
      type: "bomb" as const,
      x: s0.player.x,
      y: s0.player.y,
      vy: 0,
      width: 20,
      height: 20,
      despawnTimer: 1e6,
    };
    const s = tick({ ...s0, powerUps: [bomb] }, 16, NO_INPUT);
    const pts = ptsFor(s, 1);
    expect(pts["Grunt:bomb"]).toBe(grunts * 100);
    expect(Object.keys(pts).every((k) => k.endsWith(":bomb"))).toBe(true);
    expect(ledgerTotal(s.scoreLedger)).toBe(s.score);
  });

  it("the dev-panel bomb credits the same bomb sources", () => {
    const s0 = quiet();
    const s = applyPowerUp(s0, "bomb");
    expect(s.score).toBeGreaterThan(0);
    expect(Object.keys(ptsFor(s, 1)).every((k) => k.endsWith(":bomb"))).toBe(true);
    expect(ledgerTotal(s.scoreLedger)).toBe(s.score);
  });

  it("the wave-clear bonus is credited to the wave it cleared, and the ledger carries over", () => {
    const s0 = quiet();
    const g = firstOf(s0, "Grunt");
    let s = tick({ ...s0, playerBullets: [shot(g)] }, 16, NO_INPUT);
    s = { ...s, enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })) };
    s = tick(s, 16, NO_INPUT);
    // #2842: the bonus lands on the last kill, while wave 1's extraction is still flying
    expect(s.phase).toBe("Extraction");
    expect(s.wave).toBe(1);
    expect(ptsFor(s, 1)[WAVE_CLEAR_SOURCE]).toBe(waveClearBonusPoints(1, "Ensign"));
    expect(ledgerTotal(s.scoreLedger)).toBe(s.score);
    for (let i = 0; i < 1000 && s.wave === 1; i++) s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    expect(ptsFor(s, 1)[WAVE_CLEAR_SOURCE]).toBe(waveClearBonusPoints(1, "Ensign"));
    expect(ptsFor(s, 2)).toEqual({});
    expect(ledgerTotal(s.scoreLedger)).toBe(s.score);
  });

  it("scoreless state changes leave the ledger untouched", () => {
    const s0 = quiet();
    const s = tick(s0, 16, NO_INPUT);
    expect(s.scoreLedger).toBe(s0.scoreLedger);
  });
});

describe("reconciliation (#2837)", () => {
  it("across a long autoplayed run the ledger equals the score after every tick", () => {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "Captain");
    let t = 0;
    let bombs = 0;
    while (s.phase !== "GameOver" && s.wave < 7 && t < 300_000) {
      // Sweep the ship back and forth, always firing, with an occasional dev bomb. Lives are
      // topped up so the run gets through several waves, rams and bonus lives included.
      const x = CANVAS_W / 2 + Math.sin(t / 700) * (CANVAS_W / 2 - 30);
      s = tick({ ...s, player: { ...s.player, lives: Math.max(s.player.lives, 2) } }, 16, {
        playerX: x,
        fire: true,
      });
      if (t % 4000 === 0 && s.phase === "Playing") {
        s = applyPowerUp(s, "bomb");
        bombs++;
      }
      expect(ledgerTotal(s.scoreLedger)).toBe(s.score);
      t += 16;
    }
    expect(bombs).toBeGreaterThan(0);
    expect(s.wave).toBeGreaterThanOrEqual(7);
    const summary = summarizeScoreLedger(s.scoreLedger, s.score);
    expect(summary.unattributed).toBeUndefined();
    const last = summary.waves[summary.waves.length - 1]!;
    expect(last.end).toBe(s.score);
    for (const w of summary.waves) {
      expect(w.end - w.start).toBe(w.total);
      expect(Object.values(w.pts).reduce((a, b) => a + b, 0)).toBe(w.total);
    }
  });

  it("a gap between the ledger and the final score is reported as unattributed", () => {
    const l = recordScore(emptyScoreLedger(), 1, { Grunt: 300 });
    expect(summarizeScoreLedger(l, 300).unattributed).toBeUndefined();
    expect(summarizeScoreLedger(l, 350).unattributed).toBe(50);
  });

  it("the ledger survives a save/restore and a resumed run never counts a point twice", () => {
    const s0 = quiet();
    const g = firstOf(s0, "Grunt");
    const s1 = tick({ ...s0, playerBullets: [shot(g)] }, 16, NO_INPUT);
    const restored: unknown = JSON.parse(JSON.stringify(s1));
    expect(fitsSaveShape(restored)).toBe(true);
    const r = restored as StarSwarmState;
    expect(r.scoreLedger).toEqual(s1.scoreLedger);
    const s2 = tick(r, 16, NO_INPUT);
    expect(ledgerTotal(s2.scoreLedger)).toBe(s2.score);
    expect(s2.score).toBe(100);
    // Summarizing the same state again (a retried completion) yields the same block.
    expect(summarizeScoreLedger(s2.scoreLedger, s2.score)).toEqual(
      summarizeScoreLedger(s2.scoreLedger, s2.score)
    );
  });

  it("a save with a malformed ledger is not restored", () => {
    const s = JSON.parse(JSON.stringify(quiet())) as Record<string, unknown>;
    expect(fitsSaveShape({ ...s, scoreLedger: { waves: [{ wave: 1 }], earlier: null } })).toBe(
      false
    );
    expect(
      fitsSaveShape({ ...s, scoreLedger: { waves: [{ wave: 1, pts: { a: "x" } }], earlier: null } })
    ).toBe(false);
    const { scoreLedger: _dropped, ...withoutLedger } = s;
    expect(fitsSaveShape(withoutLedger)).toBe(false);
  });
});

describe("bounded result block (#2837)", () => {
  const TIERS: EnemyTier[] = ["Grunt", "Elite", "Guardian", "Carrier"];
  const MODS = [undefined, "dive", "rout", "bomb", "ram"] as const;

  /** Every source on every wave, with big numbers: a worst case no real run reaches. */
  function worstCase(waves: number): { ledger: ScoreLedger; score: number } {
    let ledger = emptyScoreLedger();
    let score = 0;
    for (let w = 1; w <= waves; w++) {
      const awards: ScorePoints = { [WAVE_CLEAR_SOURCE]: 99_999_999 };
      for (const t of TIERS) for (const m of MODS) awards[scoreSource(t, m)] = 9_999_999 + w;
      ledger = recordScore(ledger, w, awards);
      score += Object.values(awards).reduce((a, b) => a + b, 0);
    }
    return { ledger, score };
  }

  it("keeps at most LEDGER_DETAIL_WAVES waves in detail and folds the rest", () => {
    const { ledger, score } = worstCase(250);
    expect(ledger.waves).toHaveLength(LEDGER_DETAIL_WAVES);
    expect(ledger.waves[0]!.wave).toBe(250 - LEDGER_DETAIL_WAVES + 1);
    expect(ledger.earlier).toMatchObject({ first: 1, last: 250 - LEDGER_DETAIL_WAVES });
    expect(ledgerTotal(ledger)).toBe(score);
  });

  it.each([1, 5, 20, 21, 200, 250, 1000])(
    "a %i-wave worst case fits the budget and the 8 KiB result limit, and reconciles",
    (waves) => {
      const { ledger, score } = worstCase(waves);
      const summary = summarizeScoreLedger(ledger, score);
      const bytes = JSON.stringify(summary).length;
      expect(bytes).toBeLessThanOrEqual(BREAKDOWN_MAX_BYTES);
      const result = {
        outcome: "completed",
        wave_reached: waves,
        difficulty_tier: "LieutenantCommander",
        score_breakdown: summary,
      };
      expect(JSON.stringify(result).length).toBeLessThan(8192);
      expect(summary.unattributed).toBeUndefined();
      const total = (summary.earlier?.total ?? 0) + summary.waves.reduce((a, w) => a + w.total, 0);
      expect(total).toBe(score);
      const last = summary.waves[summary.waves.length - 1]!;
      expect(last.wave).toBe(waves);
      expect(last.end).toBe(score);
    }
  );

  it("a typical 200-wave run keeps its last LEDGER_DETAIL_WAVES waves in detail", () => {
    let ledger = emptyScoreLedger();
    for (let w = 1; w <= 200; w++)
      ledger = recordScore(ledger, w, {
        Grunt: 4000,
        "Grunt:dive": 800,
        Elite: 1600,
        Guardian: 1600,
        Carrier: 1000,
        clear: w * 500,
      });
    const summary = summarizeScoreLedger(ledger, ledgerTotal(ledger));
    expect(summary.waves).toHaveLength(LEDGER_DETAIL_WAVES);
    expect(summary.earlier).toMatchObject({ first: 1, last: 200 - LEDGER_DETAIL_WAVES });
  });
});
