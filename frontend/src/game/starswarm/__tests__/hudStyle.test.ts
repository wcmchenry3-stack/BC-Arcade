/**
 * #3598: the HUD's shared look (render/hudStyle.ts) — brand fonts, the H1-A geometry, the
 * 10-segment bar — and the property that keeps it cheap: the redesign adds nothing to the
 * change-gated HUD state, so steady play still commits nothing to React.
 */
import { initStarSwarm, tick, CANVAS_W, CANVAS_H, POWERUP_DURATION, applyPowerUp } from "../engine";
import {
  HUD_BAR_WIDTH,
  HUD_CANVAS_FONT,
  HUD_CANVAS_FONTS,
  HUD_LAYOUT,
  HUD_TEXT,
  HUD_TIMER_WIDTH,
  HUD_UNDER_NUMERAL_TOP,
  canvasFont,
  createHudNumberCache,
  formatHudNumber,
  groupDigits,
  gunsChipText,
  hudSideColumnWidth,
  normalizeHudNumber,
  hullChipText,
  litBarWidth,
  segmentsLit,
  type HudTextKind,
} from "../render/hudStyle";
import { deriveHud, hudCues, sameHud, type HudExtras, type HudState } from "../render/hud";
import { COLLECT_CUE_MIN_TOP } from "../render/pickupCue";
import { typography } from "../../../theme/typography";
import type { StarSwarmState } from "../types";

const KINDS = Object.keys(HUD_TEXT) as HudTextKind[];
const BRAND = new Set<string>(Object.values(typography));

describe("brand typography", () => {
  it.each(KINDS)("%s uses a brand family from theme/typography", (kind) => {
    expect(BRAND.has(HUD_TEXT[kind].family)).toBe(true);
  });

  it("numerals and banners are Space Grotesk; captions, chips and body are Manrope", () => {
    const grotesk = [typography.heading, typography.headingLight];
    for (const k of [
      "numeral",
      "best",
      "pickupCue",
      "missionComplete",
      "bossBanner",
      "waveIncoming",
      "countdown",
      "bonusLife",
    ] as const) {
      expect(grotesk).toContain(HUD_TEXT[k].family);
    }
    for (const k of ["caption", "difficulty", "chip", "powerUpName", "collectCue"] as const) {
      expect(HUD_TEXT[k].family.startsWith("Manrope_")).toBe(true);
    }
  });

  it("the H1-A mock's weights: score and wave bold, best light, difficulty semibold", () => {
    expect(HUD_TEXT.numeral.family).toBe(typography.heading);
    expect(HUD_TEXT.best.family).toBe(typography.headingLight);
    expect(HUD_TEXT.difficulty.family).toBe(typography.bodyMedium);
    expect(HUD_TEXT.caption.family).toBe(typography.label);
  });

  it("no HUD text is smaller than 8 px, and every line box holds its glyphs", () => {
    for (const k of KINDS) {
      expect(HUD_TEXT[k].size).toBeGreaterThanOrEqual(8);
      expect(HUD_TEXT[k].lineHeight).toBeGreaterThanOrEqual(HUD_TEXT[k].size);
    }
  });

  it("the score and wave glow soft cyan; the captions do not glow", () => {
    expect(HUD_TEXT.numeral.glow).not.toBeNull();
    expect(HUD_TEXT.numeral.glowRadius).toBeGreaterThan(0);
    expect(HUD_TEXT.caption.glow).toBeNull();
  });
});

describe("web canvas fonts", () => {
  it.each(KINDS)("%s: the same family and size as native, quoted, sans-serif fallback", (kind) => {
    const s = HUD_TEXT[kind];
    expect(HUD_CANVAS_FONT[kind]).toBe(`${s.size}px "${s.family}", sans-serif`);
    expect(canvasFont(s)).toBe(HUD_CANVAS_FONT[kind]);
  });

  it("never asks for Courier New or a bold weight (the face is already bold)", () => {
    for (const f of Object.values(HUD_CANVAS_FONT)) {
      expect(f).not.toMatch(/courier/i);
      expect(f).not.toMatch(/\bbold\b|\b[1-9]00\b/);
    }
  });

  it("lists each distinct font once for the loader", () => {
    expect(new Set(HUD_CANVAS_FONTS).size).toBe(HUD_CANVAS_FONTS.length);
    for (const f of Object.values(HUD_CANVAS_FONT)) expect(HUD_CANVAS_FONTS).toContain(f);
  });
});

describe("H1-A geometry", () => {
  it("the GUNS / HULL chips stack with a gap, so they never overlap", () => {
    const gunsTop = HUD_UNDER_NUMERAL_TOP;
    const hullTop = gunsTop + HUD_LAYOUT.chipHeight + HUD_LAYOUT.chipGap;
    expect(hullTop).toBeGreaterThan(gunsTop + HUD_LAYOUT.chipHeight);
    expect(HUD_LAYOUT.chipHeight).toBeGreaterThanOrEqual(HUD_TEXT.chip.lineHeight);
  });

  it("chips and lives start under the numeral, matching the mock's 48 px", () => {
    expect(HUD_UNDER_NUMERAL_TOP).toBe(48);
  });

  it("the timer is the icon, a gap and the 10-segment bar; it sits under the lives", () => {
    expect(HUD_BAR_WIDTH).toBe(10 * 4 + 9 * 2);
    expect(HUD_TIMER_WIDTH).toBe(HUD_LAYOUT.timerIcon + HUD_LAYOUT.timerIconGap + HUD_BAR_WIDTH);
    const timerTop = HUD_UNDER_NUMERAL_TOP + HUD_LAYOUT.lifeIcon + HUD_LAYOUT.livesToTimerGap;
    expect(timerTop).toBe(70); // the mock's 70
  });

  it("the HUD columns end above the collect cue and clear of the centred banners", () => {
    const leftBottom = HUD_UNDER_NUMERAL_TOP + 2 * HUD_LAYOUT.chipHeight + HUD_LAYOUT.chipGap;
    const rightBottom =
      HUD_UNDER_NUMERAL_TOP +
      HUD_LAYOUT.lifeIcon +
      HUD_LAYOUT.livesToTimerGap +
      HUD_LAYOUT.timerIcon;
    expect(Math.max(leftBottom, rightBottom)).toBeLessThan(COLLECT_CUE_MIN_TOP);
    // the narrowest supported canvas still has a centre column between the side columns
    const narrow = 320;
    const side = HUD_LAYOUT.marginX + HUD_TIMER_WIDTH;
    expect(narrow - 2 * side).toBeGreaterThan(100);
  });

  it("the pickup toast keeps its centre slot below the difficulty line", () => {
    const difficultyBottom =
      HUD_LAYOUT.top +
      HUD_TEXT.caption.lineHeight +
      HUD_TEXT.best.lineHeight +
      HUD_TEXT.difficulty.lineHeight;
    expect(HUD_LAYOUT.pickupCueCenterY - HUD_TEXT.pickupCue.lineHeight / 2).toBeGreaterThanOrEqual(
      difficultyBottom
    );
  });
});

describe("the 10-segment bar", () => {
  it("lights segments rounded up, 0 with nothing left", () => {
    expect(segmentsLit(0)).toBe(0);
    expect(segmentsLit(-1)).toBe(0);
    expect(segmentsLit(Number.NaN)).toBe(0);
    expect(segmentsLit(0.01)).toBe(1);
    expect(segmentsLit(0.6)).toBe(6);
    expect(segmentsLit(0.61)).toBe(7);
    expect(segmentsLit(1)).toBe(10);
    expect(segmentsLit(2)).toBe(10);
  });

  it("the lit width spans whole segments and their gaps", () => {
    expect(litBarWidth(0)).toBe(0);
    expect(litBarWidth(0.1)).toBe(4);
    expect(litBarWidth(0.2)).toBe(10);
    expect(litBarWidth(1)).toBe(HUD_BAR_WIDTH);
  });
});

describe("chip text", () => {
  it("is the ladder label and the number, in words (never colour alone)", () => {
    expect(gunsChipText("GUNS L", 2)).toBe("GUNS L2");
    expect(hullChipText("HULL", 1)).toBe("HULL 1");
    expect(hullChipText("HULL", 0)).toBe("HULL 0");
  });
});

describe("change gating holds (#2566)", () => {
  const NONE: HudExtras = { countdownDigit: null, waveBannerCountdown: false, bonusFlash: false };

  function quiet(): StarSwarmState {
    let s = initStarSwarm(CANVAS_W, CANVAS_H, 1, 42, "LieutenantJG");
    for (let t = 0; t < 8000; t += 16) s = tick(s, 16, { playerX: 40, fire: false });
    return {
      ...s,
      enemyFireDisabled: true,
      asteroidsDisabled: true,
      nextDiveTimer: 1e9,
      pauseStraggler: true,
      enemyBullets: [],
      powerUps: [],
      player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
      enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
    };
  }

  it("the redesign adds no HUD state: the segments come from the per-frame cue", () => {
    const keys = Object.keys(deriveHud(quiet(), NONE)).sort();
    expect(keys).toEqual(
      [
        "score",
        "wave",
        "difficulty",
        "guns",
        "hull",
        "lives",
        "countdownDigit",
        "waveBannerCountdown",
        "bonusFlash",
        "missionComplete",
        "rout",
        "bossWave",
        "gameOver",
        "collectPowerUps",
        "crackAsteroids",
        "powerUp",
      ].sort()
    );
  });

  it("a draining power-up crosses segment boundaries with no React commit", () => {
    let s = applyPowerUp(quiet(), "lightning");
    let hud: HudState = deriveHud(s, NONE);
    const litSeen = new Set<number>();
    let commits = 0;
    for (let t = 0; t < POWERUP_DURATION / 2; t += 16) {
      s = tick(s, 16, { playerX: 40, fire: false });
      litSeen.add(segmentsLit(hudCues(s).powerUpFraction));
      const next = deriveHud(s, NONE);
      if (!sameHud(hud, next)) commits++;
      hud = next;
    }
    expect(litSeen.size).toBeGreaterThan(3);
    expect(commits).toBe(0);
  });
});

describe("#3598 (owner) grouped HUD numbers", () => {
  const NBSP = "\u00a0";

  it.each([
    ["en", "12,450", "1,234,567"],
    ["de", "12.450", "1.234.567"],
    ["fr-CA", `12${NBSP}450`, `1${NBSP}234${NBSP}567`],
    ["ar", "12,450", "1,234,567"],
    ["hi", "12,450", "12,34,567"],
  ])("%s: its own separator, Western digits", (locale, five, seven) => {
    expect(formatHudNumber(12450, locale)).toBe(five);
    expect(formatHudNumber(1234567, locale)).toBe(seven);
    expect(formatHudNumber(1234567, locale)).toMatch(/^[0-9.,\u00a0]+$/);
  });

  it("small numbers are left alone", () => {
    expect(formatHudNumber(0, "en")).toBe("0");
    expect(formatHudNumber(950, "de")).toBe("950");
  });

  it("every shipped locale gives Western digits only", () => {
    for (const l of [
      "ar",
      "de",
      "en",
      "es",
      "fr-CA",
      "he",
      "hi",
      "ja",
      "ko",
      "nl",
      "pt",
      "ru",
      "zh",
    ]) {
      expect(formatHudNumber(9876543, l)).toMatch(/^[0-9][0-9.,\u00a0]*$/);
    }
  });

  it("normalises native digits and separators an engine may return anyway", () => {
    expect(normalizeHudNumber("١٢٬٤٥٠")).toBe("12,450"); // Arabic-Indic digits, Arabic separator
    expect(normalizeHudNumber("۱۲۳")).toBe("123"); // Persian
    expect(normalizeHudNumber("१२,४५०")).toBe("12,450"); // Devanagari
    expect(normalizeHudNumber("12\u202f450")).toBe(`12${NBSP}450`); // no glyph in Space Grotesk
  });

  it("groups by hand when the engine has no usable Intl.NumberFormat", () => {
    expect(groupDigits(0)).toBe("0");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1000)).toBe("1,000");
    expect(groupDigits(1234567)).toBe("1,234,567");
    const Real = Intl.NumberFormat;
    const spy = jest.spyOn(Intl, "NumberFormat").mockImplementation(() => {
      throw new RangeError("no Intl");
    });
    try {
      expect(formatHudNumber(1234567, "xx-NOINTL")).toBe("1,234,567");
    } finally {
      spy.mockRestore();
    }
    expect(Intl.NumberFormat).toBe(Real);
  });

  it("makes one formatter per locale, not one per call", () => {
    const spy = jest.spyOn(Intl, "NumberFormat");
    try {
      for (let i = 0; i < 50; i++) formatHudNumber(1000 + i, "nl");
      for (let i = 0; i < 50; i++) formatHudNumber(1000 + i, "nl");
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("the cache re-formats only when the value or the language changes", () => {
    const format = jest.fn((v: number, l: string) => `${l}:${v}`);
    const cached = createHudNumberCache(format);
    for (let i = 0; i < 100; i++) expect(cached(12450, "en")).toBe("en:12450");
    expect(format).toHaveBeenCalledTimes(1);
    cached(12550, "en");
    expect(format).toHaveBeenCalledTimes(2);
    cached(12550, "de");
    expect(format).toHaveBeenCalledTimes(3);
    cached(12550, "de");
    expect(format).toHaveBeenCalledTimes(3);
  });

  it("the widest realistic score fits its column", () => {
    // Space Grotesk 700 advance widths (em) from the bundled TTF: "0" is the widest digit
    // (0.648), "," 0.294, the no-break space 0.254. Seven digits is far past any run so far.
    const widest = (7 * 0.648 + 2 * 0.294) * HUD_TEXT.numeral.size;
    // the engine width the web canvas lays out in: full size, no shrinking
    expect(widest).toBeLessThanOrEqual(hudSideColumnWidth(CANVAS_W));
    // the narrowest phone (320 dp, native's unscaled overlay): within the 0.6 minimum font scale
    expect(widest * 0.6).toBeLessThanOrEqual(hudSideColumnWidth(320));
    // the best score in the centre column
    const best = (7 * 0.641 + 2 * 0.251) * HUD_TEXT.best.size;
    expect(best).toBeLessThanOrEqual(HUD_LAYOUT.centerMaxWidth);
  });
});
