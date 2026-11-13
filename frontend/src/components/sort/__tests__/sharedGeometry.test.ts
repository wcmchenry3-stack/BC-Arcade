/** #3659: the flask and board-padding numbers have one source each. */
import * as fs from "fs";
import * as path from "path";
import {
  BODY_BOTTOM,
  FLASK_CAVITY,
  INNER_H,
  NECK_LEFT,
  NECK_RIGHT,
  PAD_TOP,
  VB_H,
  VB_W,
} from "../BottleView";
import { BOARD_HORIZONTAL_PAD, BOARD_PADDING } from "../gridGeometry";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("flask geometry", () => {
  it("the neck numbers match the FLASK_CAVITY path coordinates", () => {
    const m = FLASK_CAVITY.match(/^M (\d+) (\d+) L \d+ \d+ .* L (\d+) (\d+) Z$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(NECK_LEFT);
    expect(Number(m![2])).toBe(PAD_TOP);
    expect(Number(m![3])).toBe(NECK_RIGHT);
    expect(Number(m![4])).toBe(PAD_TOP);
  });

  it("body bottom and inner height follow from the viewBox", () => {
    expect(BODY_BOTTOM).toBe(VB_H - 2);
    expect(INNER_H).toBe(BODY_BOTTOM - PAD_TOP);
    expect(NECK_RIGHT).toBeLessThan(VB_W);
  });

  it("SortBoard reads the flask numbers from BottleView and defines none of its own", () => {
    const src = read("../SortBoard.tsx");
    expect(src).not.toMatch(/const (VB_W|VB_H|NECK_\w+|BODY_BOTTOM_VB|INNER_H_VB)\s*=/);
    expect(src).toMatch(/PAD_TOP as NECK_TOP_VB/);
  });
});

describe("board padding", () => {
  it("horizontal padding is both sides of the shared padding", () => {
    expect(BOARD_HORIZONTAL_PAD).toBe(2 * BOARD_PADDING);
  });

  it("SortScreen's container and height math use the shared constant; SortBoard defines none", () => {
    const screen = read("../../../screens/SortScreen.tsx");
    expect(screen).toMatch(/boardContainer: \{[^}]*paddingHorizontal: BOARD_PADDING,/s);
    expect(screen).toMatch(/boardContainer: \{[^}]*paddingVertical: BOARD_VERTICAL_PADDING,/s);
    expect(screen).toContain("boardHeight - 2 * BOARD_VERTICAL_PADDING");
    expect(screen).not.toMatch(/const BOARD_PADDING\s*=/);
    expect(read("../SortBoard.tsx")).not.toMatch(/const BOARD_HORIZONTAL_PAD\s*=/);
  });
});
