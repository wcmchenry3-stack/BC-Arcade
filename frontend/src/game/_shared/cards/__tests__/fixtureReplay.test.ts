/**
 * The pinned golden replay (#3289): the events the backend validates in its tests
 * (backend/tests/fixtures/{solitaire,freecell}_moves_v1.json, recorded from scripted won
 * games) are replayed with the real engines here and must come out with the boards and
 * scores written below. The expected values are hard-coded, so an engine change cannot
 * move the recorder and the replay together: it fails here and the fixture is
 * regenerated on purpose (with an `engine_version` bump).
 */

import * as fs from "fs";
import * as path from "path";

import { dealGame as dealFreeCell } from "../../../freecell/engine";
import { applyAction as applyFreeCell } from "../../../freecell/replay";
import { dealGame as dealSolitaire } from "../../../solitaire/engine";
import { applyAction as applySolitaire } from "../../../solitaire/replay";

const FIXTURES = path.resolve(__dirname, "../../../../../../backend/tests/fixtures");

interface Fixture {
  seed: number;
  draw_mode?: 1 | 3;
  events: { s: number; m: number[][] }[];
}

const load = (name: string): Fixture =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as Fixture;

const id = (c: { suit: string; rank: number; faceUp?: boolean }) =>
  `${c.rank}${c.suit[0]}${c.faceUp === false ? "?" : ""}`;

describe("Solitaire fixture (draw-1 seed 10: undo, hint, recycle, auto-complete)", () => {
  const fixture = load("solitaire_moves_v1.json");

  it("rebuilds the pinned board after the first chunk and the pinned win", () => {
    expect(fixture.seed).toBe(10);
    let state = dealSolitaire(fixture.draw_mode ?? 1, fixture.seed);
    let next = 0;
    fixture.events.forEach((event, i) => {
      expect(event.s).toBe(next);
      for (const action of event.m) state = applySolitaire(state, action);
      next += event.m.length;
      if (i !== 0) return;
      expect(state.score).toBe(60);
      expect(state.tableau.map((col) => col.map(id).join(" "))).toEqual([
        "5c",
        "13d? 7d",
        "12d 11c 10h",
        "12c? 8h? 4d? 10c 9h",
        "11s? 6c? 7h? 11h? 3d",
        "9c? 3c? 5h? 10d",
        "8c? 2c? 6d? 8s? 13h? 6h? 7c",
      ]);
      expect(state.stock).toHaveLength(10);
      expect(state.waste.map(id).join(" ")).toBe("13s 10s 8d 5s 5d 11d 1d 7s 2h 12h 3h");
      expect(state.foundations.spades).toHaveLength(3);
      expect(state.recycleCount).toBe(0);
    });
    expect(state.isComplete).toBe(true);
    expect(state.score).toBe(1040);
    expect(state.recycleCount).toBe(2);
    for (const suit of ["spades", "hearts", "diamonds", "clubs"] as const) {
      expect(state.foundations[suit]).toHaveLength(13);
    }
  });
});

describe("FreeCell fixture (seed 116: supermoves, free cells, undo, hint, auto-complete)", () => {
  const fixture = load("freecell_moves_v1.json");

  it("rebuilds the pinned board after the second chunk and the pinned win", () => {
    expect(fixture.seed).toBe(116);
    let state = dealFreeCell(fixture.seed);
    fixture.events.forEach((event, i) => {
      for (const action of event.m) state = applyFreeCell(state, action);
      if (i !== 1) return;
      expect(state.moveCount).toBe(34);
      expect(state.tableau.map((col) => col.map(id).join(" "))).toEqual([
        "4d",
        "13c 12h 11s 10h",
        "12c 7c 11d 10s",
        "13d 2d",
        "7d 5s 13h",
        "3s 5h 9h 6c 12s 11h 10c 9d 8c 7h 6s 5d 4s 3d",
        "8s 6h",
        "4h 8d 9c 13s 12d 11c 10d 9s 8h 7s 6d",
      ]);
      expect(state.freeCells).toEqual([null, null, null, null]);
      expect(state.foundations.spades).toHaveLength(2);
      expect(state.foundations.hearts).toHaveLength(3);
      expect(state.foundations.diamonds).toHaveLength(1);
      expect(state.foundations.clubs).toHaveLength(5);
    });
    expect(state.isComplete).toBe(true);
    expect(state.moveCount).toBe(238);
  });
});
