import { opaque, cssHex, cssRgba, rgbFromHex } from "../../game/starswarm/render/color";
import * as palette from "../../game/starswarm/render/palette";
import { dark, light, type Colors } from "../ThemeContext";
import * as dailyword from "../theme.dailyword";
import * as hearts from "../theme.hearts";
import * as mahjong from "../theme.mahjong";
import * as starswarm from "../theme.starswarm";

// WCAG 2.x relative luminance / contrast ratio for opaque #rrggbb colours — the same
// helper shape as outcomeContrast.test.ts.
function luminance(hex: string): number {
  const linear = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Blend an `rgba(r,g,b,a)` scrim over an opaque #rrggbb backdrop. */
function over(scrim: string, backdrop: string): string {
  const [r, g, b, a] = scrim.match(/[\d.]+/g)!.map(Number) as [number, number, number, number];
  const ch = (v: number, i: number) =>
    Math.round(v * a + parseInt(backdrop.slice(i, i + 2), 16) * (1 - a))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(r, 1)}${ch(g, 3)}${ch(b, 5)}`;
}

describe("Daily Word tile and key colours (#2989)", () => {
  const TILES = [
    ["correct", dailyword.DAILYWORD_CORRECT],
    ["present", dailyword.DAILYWORD_PRESENT],
    ["absent", dailyword.DAILYWORD_ABSENT],
  ] as const;

  it("keeps the Wordle colours the tiles and keys always had", () => {
    expect(dailyword.DAILYWORD_CORRECT).toBe("#538d4e");
    expect(dailyword.DAILYWORD_PRESENT).toBe("#8c7100");
    expect(dailyword.DAILYWORD_ABSENT).toBe("#3a3a3c");
    expect(dailyword.DAILYWORD_LETTER_TEXT).toBe("#ffffff");
  });

  // Measured white-letter contrast: correct 3.97, present 2.63, absent 11.35. The Wordle
  // colours are unchanged by #2989 (it only unified their two definitions), so "present" stays
  // below WCAG AA / 3:1 as before; pin each state at its measured floor so a new colour can
  // only improve it. Raising "present" is a design change for its own issue.
  it.each([
    ["correct", dailyword.DAILYWORD_CORRECT, 3.9],
    ["present", dailyword.DAILYWORD_PRESENT, 4.5],
    ["absent", dailyword.DAILYWORD_ABSENT, 4.5],
  ] as const)("%s: the white letter holds its measured contrast floor", (_n, bg, floor) => {
    expect(contrast(dailyword.DAILYWORD_LETTER_TEXT, bg)).toBeGreaterThanOrEqual(floor);
  });

  it("gives correct, present and absent three distinct colours", () => {
    const values = TILES.map(([, c]) => c);
    expect(new Set(values).size).toBe(3);
  });

  it.each([
    ["dark", dark],
    ["light", light],
  ] as [string, Colors][])("%s: a scored tile is distinguishable from an empty one", (_n, p) => {
    // An empty tile is `colors.surface`; a scored tile must not vanish into it (WCAG 1.4.11 spirit).
    for (const [, bg] of TILES) expect(contrast(bg, p.surface)).toBeGreaterThanOrEqual(1.5);
  });
});

describe("Mahjong palette (#2989)", () => {
  it("keeps the board background that web and native share", () => {
    expect(mahjong.MAHJONG_BOARD_BG).toBe("#2d3d2d");
  });

  it("keeps the flying pair identical to the canvas tile", () => {
    expect(mahjong.MAHJONG_FP_FACE).toBe(mahjong.MAHJONG_TILE_FACE);
    expect(mahjong.MAHJONG_FP_BORDER).toBe(mahjong.MAHJONG_BORDER_SELECTED);
    expect(mahjong.MAHJONG_FP_SIDE_R).toBe(mahjong.MAHJONG_SIDE_R);
    expect(mahjong.MAHJONG_FP_SIDE_B).toBe(mahjong.MAHJONG_SIDE_B);
  });

  it("covers every suit with a placeholder colour", () => {
    expect(Object.keys(mahjong.MAHJONG_SUIT_COLOR).sort()).toEqual(
      ["bamboos", "characters", "circles", "dragons", "flowers", "seasons", "winds"].sort()
    );
  });

  it("selected tile border and hint accent stand out from the board (3:1, WCAG 1.4.11)", () => {
    expect(
      contrast(mahjong.MAHJONG_BORDER_SELECTED, mahjong.MAHJONG_BOARD_BG)
    ).toBeGreaterThanOrEqual(3);
    expect(contrast(mahjong.MAHJONG_HINT_COLOR, mahjong.MAHJONG_BOARD_BG)).toBeGreaterThanOrEqual(
      3
    );
  });

  it("tile face reads against the board and ink against the face", () => {
    expect(contrast(mahjong.MAHJONG_TILE_FACE, mahjong.MAHJONG_BOARD_BG)).toBeGreaterThanOrEqual(3);
    for (const suit of Object.values(mahjong.MAHJONG_SUIT_COLOR)) {
      expect(contrast(suit, mahjong.MAHJONG_TILE_FACE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("no-moves overlay: title and detail read on the scrim, label on the button (AA 4.5:1)", () => {
    const scrimmed = over(mahjong.MAHJONG_NO_MOVES_OVERLAY_BG, mahjong.MAHJONG_BOARD_BG);
    expect(contrast(mahjong.MAHJONG_OVERLAY_TEXT, scrimmed)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mahjong.MAHJONG_OVERLAY_DETAIL_TEXT, scrimmed)).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(mahjong.MAHJONG_OVERLAY_TEXT, mahjong.MAHJONG_OVERLAY_BTN_BG)
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Hearts animation colours (#2989)", () => {
  it("queen of spades ink reaches AA on the card face", () => {
    expect(contrast(hearts.HEARTS_QUEEN_INK, hearts.HEARTS_QUEEN_CARD_FACE)).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it("moon shot caption and stars read on the black backdrop (AA)", () => {
    expect(
      contrast(hearts.HEARTS_MOONSHOT_LABEL, hearts.HEARTS_MOONSHOT_BACKDROP)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(hearts.HEARTS_MOONSHOT_STAR, hearts.HEARTS_MOONSHOT_BACKDROP)
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Star Swarm HUD colours (#2989)", () => {
  const SPACE = starswarm.STARSWARM_SPACE;

  it.each([
    ["accent", starswarm.STARSWARM_ACCENT],
    ["HUD text", starswarm.STARSWARM_HUD_TEXT],
    ["difficulty", starswarm.STARSWARM_HUD_DIFFICULTY],
    ["boss wave", starswarm.STARSWARM_BOSS_WAVE],
    ["bonus life", starswarm.STARSWARM_BONUS_LIFE],
    ["hull blue", starswarm.STARSWARM_HULL_BLUE],
    ["lightning", starswarm.STARSWARM_LIGHTNING],
  ])("%s text reaches AA on deep space", (_n, fg) => {
    expect(contrast(fg, SPACE)).toBeGreaterThanOrEqual(4.5);
  });

  it("the dark label on the accent-filled Resume / New Game button reaches AA", () => {
    expect(contrast(SPACE, starswarm.STARSWARM_ACCENT)).toBeGreaterThanOrEqual(4.5);
  });

  it("pause title reads on the pause scrim", () => {
    const scrimmed = over("rgba(0,0,16,0.72)", "#000010");
    expect(starswarm.STARSWARM_PAUSE_SCRIM.replace(/\s/g, "")).toBe("rgba(0,0,16,0.72)");
    expect(contrast(starswarm.STARSWARM_ACCENT, scrimmed)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("Star Swarm canvas palette stays one colour across renderers (#2989)", () => {
  it("derives the shared colours from theme.starswarm", () => {
    expect(cssHex(palette.BG_RGB)).toBe(starswarm.STARSWARM_SPACE);
    expect(cssHex(palette.ACCENT_RGB)).toBe(starswarm.STARSWARM_ACCENT);
    expect(cssHex(palette.HULL_BLUE_RGB)).toBe(starswarm.STARSWARM_HULL_BLUE);
    expect(cssHex(palette.LIGHTNING_RGB)).toBe(starswarm.STARSWARM_LIGHTNING);
    expect(palette.PLAYER_SHOT).toBe(opaque(rgbFromHex(starswarm.STARSWARM_ACCENT)));
  });

  it("keeps the packed colours the display list always used", () => {
    expect(palette.BG).toBe(0xff000010);
    expect(palette.ENEMY_SHOT).toBe(0xffff4422);
    expect(palette.FLAK_SHOT).toBe(0xffffd27a);
    expect(palette.PLAYER_SHOT).toBe(0xff00ffcc);
    expect(palette.CHARGE_SHOT).toBe(0xff00f0ff);
    // #3593: one fallback colour for every tier (each has its own shape), the lifted shell's light stop
    expect(palette.ENEMY_FALLBACK).toBe(0xffb07ae0);
    // #3592 restyled Buddy's HP bar in style B: cyan, amber, danger red (was green, amber, red)
    expect([palette.BUDDY_HP_HIGH, palette.BUDDY_HP_MID, palette.BUDDY_HP_LOW]).toEqual([
      0xff00e8d0, 0xffffb020, 0xffff5a3c,
    ]);
    // ...and the plating blue the outline and the plating flash share with the generator
    expect(palette.ARMOR_BLUE_RGB).toBe(0x1fb6ff);
    expect(palette.HULL_BLUE_RGB).toBe(0x00aaff);
    expect(palette.SALVAGE_RGB).toBe(0xffb020);
    // #3625: the Carrier's searing plasma (CB2), brace orange, hive shield and final-stand heat
    expect([palette.PLASMA_RGB, palette.PLASMA_CORE_RGB, palette.PLASMA_GLOW_RGB]).toEqual([
      0xff3a1a, 0xfff2b0, 0xff8a3c,
    ]);
    expect(palette.BRACE_RGB).toBe(0xff8a3c);
    expect(palette.HIVE_SHIELD_RGB).toBe(0xe08cff);
    expect(palette.HEAT_RGB).toBe(0xff2a1a);
  });

  it("the web table's strings are the packed colours' CSS forms", () => {
    expect(cssHex(palette.ENEMY_SHOT_RGB)).toBe("#ff4422");
    expect(cssHex(palette.SHELL_LIGHT_RGB)).toBe("#b07ae0");
    expect(cssRgba(palette.HULL_BLUE_RGB, 0.25)).toBe("rgba(0,170,255,0.25)");
    expect(cssRgba(palette.BUDDY_SHIP_RGB, 0.8)).toBe("rgba(0,120,255,0.8)");
  });

  it("the enemy fallback is the shell's light stop, fully opaque (#3593)", () => {
    expect(palette.ENEMY_FALLBACK).toBe(opaque(palette.SHELL_LIGHT_RGB));
  });
});
