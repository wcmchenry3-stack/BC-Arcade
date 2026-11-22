/**
 * #3600: the ships are cosmetic. Whatever ship is picked, the player's hitbox, hurt radius and
 * guns are the engine's, and the ship id never reaches the engine.
 */
import * as fs from "fs";
import * as path from "path";
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../engine";
import { PLAYER_H, PLAYER_HURT_RADIUS, PLAYER_W } from "../engine/tuning";
import { buildFrame } from "../render/frame";
import type { LoadedSprites } from "../render/frame";
import { SHIP_IDS, SHIP_SPRITE_PAD } from "../render/ship";

describe("ships do not change the hitbox", () => {
  it("the engine's player box and hurt radius are fixed constants", () => {
    expect(PLAYER_W).toBe(34);
    expect(PLAYER_H).toBe(34);
    expect(PLAYER_HURT_RADIUS).toBe(7);
    const p = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "Ensign").player;
    expect(p.width).toBe(PLAYER_W);
    expect(p.height).toBe(PLAYER_H);
  });

  it("every ship is drawn into the hitbox plus the same margin", () => {
    const state = initStarSwarm(CANVAS_W, CANVAS_H, 1, 7, "Ensign");
    const loaded = new Proxy({}, { get: () => true }) as unknown as LoadedSprites;
    const boxes = SHIP_IDS.map((ship) => {
      const op = buildFrame(state, { loaded, width: CANVAS_W, height: CANVAS_H, ship }).find(
        (o) => o.k === "ship"
      );
      if (!op || op.k !== "ship") throw new Error("no ship op");
      return [op.x, op.y, op.w, op.h];
    });
    expect(new Set(boxes.map((b) => b.join(","))).size).toBe(1);
    expect(boxes[0]![2]).toBe(PLAYER_W + 2 * SHIP_SPRITE_PAD);
  });

  it("the engine never sees the ship id", () => {
    const dir = path.join(__dirname, "..");
    const files = [
      "engine.ts",
      ...fs.readdirSync(path.join(dir, "engine")).map((f) => path.join("engine", f)),
    ].filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(src).not.toMatch(/render\/ship|ShipId|DEFAULT_SHIP_ID/);
    }
  });
});
