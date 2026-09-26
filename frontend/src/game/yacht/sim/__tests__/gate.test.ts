import { readFileSync } from "fs";
import { join } from "path";
import {
  GATE_BANDS,
  GATE_GROUPS,
  GATE_MATCHUPS,
  checkBand,
  checkBands,
  formatBandResults,
  type Band,
  type Reports,
} from "../gate";
import type { Estimate, MatchupReport } from "../stats";

function est(mean: number, half: number, n = 500): Estimate {
  return { mean, se: half / 1.96, ciLow: mean - half, ciHigh: mean + half, n };
}

// Only the fields the fixture bands read.
const reports = {
  m1: { aWinRate: est(0.6, 0.02) },
  m2: { aWinRate: est(0.5, 0.03) },
} as unknown as Reports;

const winRate = (id: string) => (r: Reports) => (r[id] as MatchupReport).aWinRate;

describe("checkBand", () => {
  it("passes inside the band and names the observed value, CI and bounds", () => {
    const band: Band = {
      id: "m1-win",
      description: "A beats B",
      matchups: ["m1"],
      metric: winRate("m1"),
      min: 0.55,
      max: 0.65,
      percent: true,
    };
    const r = checkBand(band, reports);
    expect(r.status).toBe("pass");
    expect(r.inconclusive).toBe(false);
    expect(r.message).toBe(
      "PASS m1-win: observed 60.0% [58.0%, 62.0%] (95% CI), band ≥ 55.0% and ≤ 65.0% — A beats B"
    );
  });

  it("fails outside the band with an actionable message", () => {
    const band: Band = {
      id: "m1-win",
      description: "A beats B",
      matchups: ["m1"],
      metric: winRate("m1"),
      max: 0.55,
      percent: true,
    };
    const r = checkBand(band, reports);
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/^FAIL m1-win: observed 60\.0% \[58\.0%, 62\.0%\]/);
    expect(r.message).toContain("band ≤ 55.0%");
  });

  it("flags a result whose CI straddles a bound as inconclusive", () => {
    const band: Band = {
      id: "m2-win",
      description: "even",
      matchups: ["m2"],
      metric: winRate("m2"),
      min: 0.49,
    };
    const r = checkBand(band, reports);
    expect(r.status).toBe("pass");
    expect(r.inconclusive).toBe(true);
    expect(r.message).toContain("inconclusive");
  });

  it("treats strictMin as a strict inequality", () => {
    const base = { id: "x", description: "", matchups: ["m2"], metric: winRate("m2"), min: 0.5 };
    expect(checkBand(base, reports).status).toBe("pass");
    expect(checkBand({ ...base, strictMin: true }, reports).status).toBe("fail");
  });

  it("skips a band whose matchups weren't run", () => {
    const band: Band = {
      id: "needs-m3",
      description: "",
      matchups: ["m3"],
      metric: winRate("m3"),
      min: 0,
    };
    const r = checkBand(band, reports);
    expect(r.status).toBe("skipped");
    expect(r.message).toBe("SKIP needs-m3: needs m3");
  });

  it("summarizes results with counts", () => {
    const bands: Band[] = [
      { id: "a", description: "", matchups: ["m1"], metric: winRate("m1"), min: 0.5 },
      { id: "b", description: "", matchups: ["m1"], metric: winRate("m1"), max: 0.5 },
      { id: "c", description: "", matchups: ["m9"], metric: winRate("m9"), min: 0 },
    ];
    const text = formatBandResults(checkBands(reports, bands));
    expect(text.split("\n")[0]).toBe(
      "=== Yacht calibration gate: 1 passed, 1 failed, 1 skipped ==="
    );
  });
});

describe("gate definition", () => {
  const ids = GATE_MATCHUPS.map((m) => m.id);

  it("has unique matchup ids and seeds, with whole four-game blocks", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(GATE_MATCHUPS.map((m) => m.seed)).size).toBe(ids.length);
    for (const m of GATE_MATCHUPS) expect(m.games % 4).toBe(0);
  });

  it("puts every matchup in exactly one CI group", () => {
    const grouped = Object.values(GATE_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...ids].sort());
  });

  it("only has bands that read matchups from a single group", () => {
    for (const band of GATE_BANDS) {
      for (const id of band.matchups) expect(ids).toContain(id);
      const groups = Object.entries(GATE_GROUPS).filter(([, members]) =>
        band.matchups.every((id) => members.includes(id))
      );
      expect({ band: band.id, groups: groups.length }).toEqual({ band: band.id, groups: 1 });
    }
  });

  it("has unique band ids, each with at least one bound", () => {
    const bandIds = GATE_BANDS.map((b) => b.id);
    expect(new Set(bandIds).size).toBe(bandIds.length);
    for (const b of GATE_BANDS) expect(b.min !== undefined || b.max !== undefined).toBe(true);
  });

  it("matches the workflow's job matrix", () => {
    const workflow = readFileSync(
      join(__dirname, "../../../../../../.github/workflows/yacht-sim-gate.yml"),
      "utf8"
    );
    const matrix = /group: \[([^\]]*)\]/.exec(workflow)?.[1] ?? "";
    const groups = matrix.split(",").map((g) => g.trim());
    expect([...groups].sort()).toEqual(Object.keys(GATE_GROUPS).sort());
  });
});
