/**
 * #2880 balance sim: markdown tables for the CLI (scripts/simulate-starswarm.ts). Pure string
 * builders over `CellSummary`; nothing here prints or runs the engine.
 */
import type { DifficultyTier } from "../types";
import type { CellSummary } from "./balance";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f1 = (x: number) => x.toFixed(1);
const sec = (x: number | null) => (x === null ? "—" : (x / 1000).toFixed(1));

const DIFF_SHORT: Record<DifficultyTier, string> = {
  Ensign: "Ens",
  LieutenantJG: "LtJG",
  Lieutenant: "Lt",
  LieutenantCommander: "LCdr",
  Commander: "Cdr",
  Captain: "Capt",
  RearAdmiral: "RAdm",
  ViceAdmiral: "VAdm",
  Admiral: "Adm",
  FleetAdmiral: "FAdm",
};

/** Markdown tables, one pair per (variant, pilot, scenario), a row per difficulty. */
export function formatReport(cells: readonly CellSummary[]): string {
  const blocks = new Map<string, CellSummary[]>();
  for (const c of cells) {
    const k = `${c.variant} · ${c.pilot} · ${c.scenario}`;
    const b = blocks.get(k);
    if (b) b.push(c);
    else blocks.set(k, [c]);
  }
  const order = Object.keys(DIFF_SHORT);
  const lines: string[] = [];
  for (const [k, rows] of blocks) {
    rows.sort((a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty));
    lines.push(`#### ${k}`, "");
    lines.push(
      "| Diff | n | Destroyed | Killer twin/beam/Gd/El/Gr/rock | HP mean/p10/p50 | Drawn Gr/El/Gd/C | Drawn hit% (C) | Buddy dmg share | Buddy kills | Buddy→Carrier dmg (share) | Carrier kill by Buddy | TTK with/without (s) |",
      "| --- | --: | --: | --- | --- | --- | --- | --: | --: | --- | --: | --- |"
    );
    for (const c of rows) {
      const kp = c.killerPct;
      const d = c.drawnPerSortie;
      lines.push(
        `| ${DIFF_SHORT[c.difficulty]} | ${c.reached} | ${pct(c.destroyedPct)} | ${[
          kp.carrierTwin,
          kp.beam,
          kp.Guardian,
          kp.Elite,
          kp.Grunt,
          kp.rock,
        ]
          .map(pct)
          .join("/")} | ${f1(c.hpMean)}/${c.hpP10}/${c.hpP50} | ${[
          d.Grunt,
          d.Elite,
          d.Guardian,
          d.Carrier,
        ]
          .map(f1)
          .join("/")} | ${pct(c.drawnHitPct)} (${pct(c.carrierDrawnHitPct)}) | ${pct(
          c.buddyDamageShare
        )} | ${f1(c.buddyKillsPerSortie)} | ${f1(c.buddyCarrierDamage)} (${pct(
          c.buddyCarrierShare
        )}) | ${pct(c.carrierKillByBuddyPct)} | ${sec(c.ttkWithP50)} / ${sec(c.ttkWithoutP50)} |`
      );
    }
    lines.push("");
    lines.push(
      "| Diff | Sortie (s) | Beams/sortie | Beam in lane / hit | Runs/sortie | Run closest (px) / <120px | Time in beam lane | Mean gap (px) | Stray hits | Player hits with/without | Attr. misses |",
      "| --- | --: | --: | --- | --: | --- | --: | --: | --: | --- | --: |"
    );
    for (const c of rows) {
      lines.push(
        `| ${DIFF_SHORT[c.difficulty]} | ${sec(c.sortieMs)} | ${f1(c.beamsPerSortie)} | ${pct(
          c.beamInLanePct
        )} / ${pct(c.beamHitPct)} | ${f1(c.runsPerSortie)} | ${Math.round(c.runMinDist)} / ${pct(
          c.runClosePct
        )} | ${pct(c.inLanePct)} | ${Math.round(c.meanGap)} | ${f1(c.strayHitsPerSortie)} | ${f1(
          c.playerHitsWith
        )} / ${f1(c.playerHitsWithout)} | ${c.attributionMisses} |`
      );
    }
    lines.push("");
    lines.push(
      "| Diff | Fleet at launch | Buddy kills (run 1/2/3) | Fleet killed by Buddy mean / p90 / max | Buddy dmg share | Wave cleared in sortie | Formation wiped in sortie |",
      "| --- | --: | --- | --- | --: | --: | --: |"
    );
    for (const c of rows) lines.push(offenseRow(c, DIFF_SHORT[c.difficulty]));
    lines.push("");
  }
  return lines.join("\n");
}

function offenseRow(c: CellSummary, label: string): string {
  return `| ${label} | ${f1(c.fleetAtLaunch)} | ${f1(c.buddyKillsPerSortie)} (${c.killsByRun
    .map(f1)
    .join("/")}) | ${pct(c.fleetFracMean)} / ${pct(c.fleetFracP90)} / ${pct(
    c.fleetFracMax
  )} | ${pct(c.buddyDamageShare)} | ${pct(c.waveClearedPct)} | ${pct(c.formationClearedPct)} |`;
}

/** Offensive output per sortie, one row per cell (for the fan / pierce / damage sweeps). */
export function formatOffense(cells: readonly CellSummary[]): string {
  const lines = [
    "| Variant · pilot · scenario · diff | Fleet at launch | Buddy kills (run 1/2/3) | Fleet killed by Buddy mean / p90 / max | Buddy dmg share | Wave cleared in sortie | Formation wiped in sortie |",
    "| --- | --: | --- | --- | --: | --: | --: |",
  ];
  for (const c of cells) {
    const label = `${c.variant} · ${c.pilot} · ${c.scenario} · ${DIFF_SHORT[c.difficulty]}`;
    lines.push(offenseRow(c, label));
  }
  return lines.join("\n");
}

/** A compact one-line-per-cell table for sweeps (variant rows, fixed scenario/difficulty). */
export function formatSweep(cells: readonly CellSummary[]): string {
  const lines = [
    "| Variant | Pilot | Scenario | Diff | n | Destroyed | Killer twin/beam | HP p50 | Drawn C | C hit% | Buddy→Carrier share | Carrier kill by Buddy | TTK with/without (s) |",
    "| --- | --- | --- | --- | --: | --: | --- | --: | --: | --: | --: | --: | --- |",
  ];
  for (const c of cells) {
    lines.push(
      `| ${c.variant} | ${c.pilot} | ${c.scenario} | ${DIFF_SHORT[c.difficulty]} | ${c.reached} | ${pct(
        c.destroyedPct
      )} | ${pct(c.killerPct.carrierTwin)}/${pct(c.killerPct.beam)} | ${c.hpP50} | ${f1(
        c.drawnPerSortie.Carrier
      )} | ${pct(c.carrierDrawnHitPct)} | ${pct(c.buddyCarrierShare)} | ${pct(
        c.carrierKillByBuddyPct
      )} | ${sec(c.ttkWithP50)} / ${sec(c.ttkWithoutP50)} |`
    );
  }
  return lines.join("\n");
}
