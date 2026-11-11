/**
 * #3512: the banked power-up toasts — "SHIELD → NEXT WAVE" when one is banked after the last
 * kill, "SHIELD UP!" when it takes effect as the next wave's combat starts — and their spoken
 * announcements, read from two consecutive states like the #2847 ladder cues.
 */
import { CANVAS_H, CANVAS_W, initStarSwarm } from "../engine";
import {
  BG_RGB,
  PICKUP_BOMB_RGB,
  PICKUP_BUDDY_RGB,
  PICKUP_LIGHTNING_RGB,
  PICKUP_SHIELD_RGB,
} from "../render/palette";
import { cssHex } from "../render/color";
import {
  cueColor,
  pickupCueA11yKey,
  pickupCueColor,
  pickupCueLabelKey,
  pickupCues,
} from "../render/pickupCue";
import type { BankablePowerUp, StarSwarmState } from "../types";

function state(over: Partial<StarSwarmState> = {}): StarSwarmState {
  const s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42);
  return { ...s, enemies: [], powerUps: [], ...over };
}

const KINDS: readonly BankablePowerUp[] = ["shield", "lightning", "buddy", "bomb"];
const NAME: Record<BankablePowerUp, string> = {
  shield: "Shield",
  lightning: "Lightning",
  buddy: "Buddy",
  bomb: "Bomb",
};

describe("#3512 banked power-up cues", () => {
  it.each(KINDS)("%s: banking it fires the NEXT WAVE toast, once", (kind) => {
    const wait = state({ phase: "ClearAwaitingPickups" });
    const banked = { ...wait, bankedPowerUp: kind };
    const cues = pickupCues(wait, banked);
    expect(cues).toEqual([{ kind: "banked", powerUp: kind }]);
    expect(pickupCueLabelKey(cues[0]!)).toBe(`hud.cueBanked${NAME[kind]}`);
    expect(pickupCueA11yKey(cues[0]!)).toBe(`a11y.banked${NAME[kind]}`);
    // the next tick, still banked, fires nothing
    expect(pickupCues(banked, { ...banked })).toEqual([]);
  });

  it.each(KINDS)("%s: applying it as combat starts fires the UP / STRIKE toast, once", (kind) => {
    const swoop = state({ phase: "SwoopIn", bankedPowerUp: kind });
    const playing = { ...swoop, phase: "Playing" as const, bankedPowerUp: null };
    const cues = pickupCues(swoop, playing);
    expect(cues).toEqual([{ kind: "applied", powerUp: kind }]);
    expect(pickupCueLabelKey(cues[0]!)).toBe(`hud.cueApplied${NAME[kind]}`);
    expect(pickupCueA11yKey(cues[0]!)).toBe(`a11y.applied${NAME[kind]}`);
    expect(pickupCues(playing, { ...playing })).toEqual([]);
  });

  it("a second banked power-up replacing the first fires its own toast", () => {
    const a = state({ phase: "ClearAwaitingPickups", bankedPowerUp: "shield" });
    expect(pickupCues(a, { ...a, bankedPowerUp: "bomb" })).toEqual([
      { kind: "banked", powerUp: "bomb" },
    ]);
  });

  it("a run that ends with one banked fires no apply toast", () => {
    const a = state({ phase: "ClearAwaitingPickups", bankedPowerUp: "buddy" });
    expect(pickupCues(a, { ...a, phase: "GameOver" })).toEqual([]);
  });

  it("each toast takes its power-up token's face colour (#3595); the ladder cues keep theirs", () => {
    const rgb = {
      shield: PICKUP_SHIELD_RGB,
      lightning: PICKUP_LIGHTNING_RGB,
      buddy: PICKUP_BUDDY_RGB,
      bomb: PICKUP_BOMB_RGB,
    };
    expect(Object.values(rgb).map((c) => cssHex(c))).toEqual([
      "#29c6ff",
      "#ffe23a",
      "#5dffa8",
      "#ff6a2a",
    ]);
    // text on the playfield: each holds WCAG AA (4.5:1) against the space background
    const lum = (c: number) => {
      const ch = [16, 8, 0].map((sh) => ((c >> sh) & 0xff) / 255);
      const [r, g, bl] = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    for (const c of Object.values(rgb)) {
      expect((lum(c) + 0.05) / (lum(BG_RGB) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
    for (const kind of KINDS) {
      expect(cueColor({ kind: "banked", powerUp: kind })).toBe(cssHex(rgb[kind]));
      expect(cueColor({ kind: "applied", powerUp: kind })).toBe(cssHex(rgb[kind]));
    }
    expect(cueColor({ kind: "guns", max: false, level: 2 })).toBe(pickupCueColor("guns"));
    expect(cueColor({ kind: "hull", max: true, level: 3 })).toBe(pickupCueColor("hull"));
  });

  it("a ladder rise is spoken elsewhere (onUpgrade); only its MAX variant is announced here", () => {
    expect(pickupCueA11yKey({ kind: "guns", max: false, level: 2 })).toBeNull();
    expect(pickupCueA11yKey({ kind: "hull", max: true, level: 3 })).toBe("hud.cueHullMax");
  });
});
