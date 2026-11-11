/**
 * #3598: the web canvas's HUD (webHud.ts) draws the H1-A layout with the brand fonts, from the
 * same constants as the native overlay; and `hudTextStyle` turns those constants into the native
 * text styles, so native and web cannot drift apart.
 */
import { drawWebHud, loadHudFonts, resetHudTextCache, type WebHudFrame } from "../webHud";
import { hudTextStyle } from "../hudTextStyle";
import {
  HUD_CANVAS_FONT,
  HUD_CANVAS_FONTS,
  HUD_CHIP_COLOR,
  HUD_LAYOUT,
  HUD_POWER_UP_COLOR,
  HUD_TEXT,
  HUD_TIMER_WIDTH,
  HUD_UNDER_NUMERAL_TOP,
  type HudTextKind,
} from "../../../game/starswarm/render/hudStyle";

interface Call {
  name: string;
  args: unknown[];
  font: string;
  fillStyle: unknown;
  strokeStyle: unknown;
  textAlign: unknown;
  globalAlpha: number;
  shadowBlur: number;
}

function recorder() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, shadowBlur: 0, font: "" };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return (...args: unknown[]) => {
        const name = String(prop);
        calls.push({
          name,
          args,
          font: String(target.font),
          fillStyle: target.fillStyle,
          strokeStyle: target.strokeStyle,
          textAlign: target.textAlign,
          globalAlpha: Number(target.globalAlpha),
          shadowBlur: Number(target.shadowBlur),
        });
        if (name === "measureText") return { width: 30 };
        return undefined;
      };
    },
    set(target, prop, value) {
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const IMG = { tag: "ship" } as unknown as CanvasImageSource;
const ICON = { tag: "chip" } as unknown as CanvasImageSource;

function frame(over: Partial<WebHudFrame> = {}): WebHudFrame {
  return {
    width: 360,
    scoreCaption: "SCORE",
    score: 12450,
    bestCaption: "BEST",
    best: 48200,
    difficulty: "LIEUTENANT ×1.5",
    waveCaption: "WAVE",
    wave: 7,
    gunsText: "GUNS L2",
    hullText: "HULL 1",
    lives: 3,
    lifeImage: IMG,
    lifeFallback: "accent",
    powerUp: "lightning",
    powerUpName: "LIGHTNING",
    powerUpFraction: 0.6,
    powerUpIcon: ICON,
    ...over,
  };
}

beforeEach(() => resetHudTextCache());

describe("drawWebHud", () => {
  it("draws every text in a brand font, never Courier New", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame());
    const texts = calls.filter((c) => c.name === "fillText");
    expect(texts.length).toBeGreaterThan(8);
    for (const c of texts) {
      expect(Object.values(HUD_CANVAS_FONT)).toContain(c.font);
      expect(c.font).not.toMatch(/courier/i);
    }
  });

  it("each text gets its kind's font: SCORE caption, the score numeral, the best, the chips", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame());
    const fontOf = (text: string) =>
      calls.find((c) => c.name === "fillText" && c.args[0] === text)!.font;
    expect(fontOf("SCORE")).toBe(HUD_CANVAS_FONT.caption);
    expect(fontOf("12450")).toBe(HUD_CANVAS_FONT.numeral);
    expect(fontOf("48200")).toBe(HUD_CANVAS_FONT.best);
    expect(fontOf("LIEUTENANT ×1.5")).toBe(HUD_CANVAS_FONT.difficulty);
    expect(fontOf("7")).toBe(HUD_CANVAS_FONT.numeral);
    expect(fontOf("GUNS L2")).toBe(HUD_CANVAS_FONT.chip);
    expect(fontOf("LIGHTNING")).toBe(HUD_CANVAS_FONT.powerUpName);
  });

  it("the score and wave glow; the captions do not", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame());
    const blurOf = (text: string) =>
      calls.find((c) => c.name === "fillText" && c.args[0] === text)!.shadowBlur;
    expect(blurOf("12450")).toBe(HUD_TEXT.numeral.glowRadius);
    expect(blurOf("7")).toBe(HUD_TEXT.numeral.glowRadius);
    expect(blurOf("SCORE")).toBe(0);
  });

  it("score left, best centred, wave right", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame());
    const at = (text: string) => calls.find((c) => c.name === "fillText" && c.args[0] === text)!;
    expect(at("12450").args[1]).toBe(HUD_LAYOUT.marginX);
    expect(at("12450").textAlign).toBe("left");
    expect(at("48200").args[1]).toBe(180);
    expect(at("48200").textAlign).toBe("center");
    expect(at("7").args[1]).toBe(360 - HUD_LAYOUT.marginX);
    expect(at("7").textAlign).toBe("right");
  });

  it("stacks the GUNS chip over the HULL chip, cyan and plating blue, never overlapping", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame());
    const boxes = calls.filter((c) => c.name === "roundRect" || c.name === "rect");
    expect(boxes).toHaveLength(2);
    const [g, h] = boxes.map((b) => b.args as number[]);
    expect(g![0]).toBeCloseTo(h![0]!); // same x: stacked, not side by side
    expect(h![1]!).toBeGreaterThanOrEqual(g![1]! + g![3]!); // HULL starts below GUNS' bottom
    expect(g![1]).toBeCloseTo(HUD_UNDER_NUMERAL_TOP + HUD_LAYOUT.chipBorder / 2);
    const strokes = calls.filter((c) => c.name === "stroke").map((c) => c.strokeStyle);
    expect(strokes).toEqual([HUD_CHIP_COLOR.guns, HUD_CHIP_COLOR.hull]);
  });

  it("a chip grows to fit a long label (min width otherwise)", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame());
    const w = (calls.find((c) => c.name === "roundRect")!.args as number[])[2]!;
    expect(w + HUD_LAYOUT.chipBorder).toBe(
      Math.max(HUD_LAYOUT.chipMinWidth, 30 + 2 * HUD_LAYOUT.chipPadX)
    );
  });

  it("draws one chosen ship per life, right-aligned under the wave", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame({ lives: 3 }));
    const ships = calls.filter((c) => c.name === "drawImage" && c.args[0] === IMG);
    expect(ships).toHaveLength(3);
    const right = 360 - HUD_LAYOUT.marginX;
    const xs = ships.map((c) => c.args[1] as number);
    expect(Math.max(...xs) + HUD_LAYOUT.lifeIcon).toBe(right);
    for (const c of ships) expect(c.args[2]).toBe(HUD_UNDER_NUMERAL_TOP);
  });

  it("falls back to blocks while the ship image loads", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame({ lives: 2, lifeImage: null }));
    expect(calls.filter((c) => c.name === "fillRect" && c.fillStyle === "accent")).toHaveLength(2);
  });

  it("draws the timer under the lives, right-aligned: chip icon, name, 10 segments", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame({ powerUpFraction: 0.6 }));
    const right = 360 - HUD_LAYOUT.marginX;
    const icon = calls.find((c) => c.name === "drawImage" && c.args[0] === ICON)!;
    expect(icon.args[1]).toBe(right - HUD_TIMER_WIDTH);
    expect(icon.args[2] as number).toBeGreaterThan(HUD_UNDER_NUMERAL_TOP + HUD_LAYOUT.lifeIcon);
    const segs = calls.filter(
      (c) => c.name === "fillRect" && c.fillStyle === HUD_POWER_UP_COLOR.lightning
    );
    expect(segs).toHaveLength(10);
    expect(segs.filter((c) => c.globalAlpha === 1)).toHaveLength(6);
    const last = segs[9]!.args as number[];
    expect(last[0]! + last[2]!).toBe(right);
    const name = calls.find((c) => c.name === "fillText" && c.args[0] === "LIGHTNING")!;
    expect(name.fillStyle).toBe(HUD_POWER_UP_COLOR.lightning);
  });

  it("draws no timer without a duration power-up", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame({ powerUp: null }));
    expect(calls.some((c) => c.name === "drawImage" && c.args[0] === ICON)).toBe(false);
    expect(calls.some((c) => c.name === "fillText" && c.args[0] === "LIGHTNING")).toBe(false);
  });

  it("does not mirror for RTL strings: the layout is positional", () => {
    const { ctx, calls } = recorder();
    drawWebHud(ctx, frame({ scoreCaption: "النقاط", waveCaption: "الموجة" }));
    const at = (text: string) => calls.find((c) => c.name === "fillText" && c.args[0] === text)!;
    expect(at("النقاط").args[1]).toBe(HUD_LAYOUT.marginX);
    expect(at("الموجة").args[1]).toBe(360 - HUD_LAYOUT.marginX);
  });
});

describe("loadHudFonts", () => {
  it("asks for every HUD font and resolves true when each matched a face", async () => {
    const load = jest.fn(async () => [{}]);
    await expect(loadHudFonts({ load })).resolves.toBe(true);
    expect(load.mock.calls.map((c) => (c as unknown[])[0])).toEqual([...HUD_CANVAS_FONTS]);
  });

  it("resolves false when a font matched no face, failed, or the browser has no font set", async () => {
    await expect(loadHudFonts({ load: async () => [] })).resolves.toBe(false);
    await expect(
      loadHudFonts({
        load: async () => {
          throw new Error("network");
        },
      })
    ).resolves.toBe(false);
    await expect(loadHudFonts(undefined)).resolves.toBe(false);
  });
});

describe("native / web parity", () => {
  it.each(Object.keys(HUD_TEXT) as HudTextKind[])(
    "%s: native's text style and the canvas font come from the same numbers",
    (kind) => {
      const s = HUD_TEXT[kind];
      const n = hudTextStyle(s);
      expect(n.fontFamily).toBe(s.family);
      expect(n.fontSize).toBe(s.size);
      expect(n.lineHeight).toBe(s.lineHeight);
      expect(n.color).toBe(s.color);
      expect(n.letterSpacing).toBe(s.letterSpacing);
      expect(n.fontWeight).toBeUndefined();
      expect(HUD_CANVAS_FONT[kind]).toContain(`${n.fontSize}px "${n.fontFamily}"`);
      if (s.glow === null) {
        expect(n.textShadowRadius).toBeUndefined();
      } else {
        expect(n.textShadowColor).toBe(s.glow);
        expect(n.textShadowRadius).toBe(s.glowRadius);
        expect(n.textShadowOffset).toEqual({ width: 0, height: 0 });
      }
    }
  );
});
