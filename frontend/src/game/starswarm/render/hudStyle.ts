/**
 * #3598 (epic #3590, art 7): the HUD's look and layout in one place, read by both renderers.
 *
 * Native draws the HUD as React Native Text over the Skia canvas (`GameCanvas.tsx`,
 * `LivesIndicator`, `PowerUpIndicator`); web draws it into the 2D canvas (`GameCanvas.web.tsx`).
 * Both take their fonts, sizes, colours, glows, line heights and gaps from here, so the two cannot
 * drift apart (`hudStyle.test.ts` pins the parity).
 *
 * Layout (owner pick H1-A, the flight HUD redistributed; the centre is kept clear for the Carrier
 * and its Guardians):
 *
 *   SCORE              BEST                    WAVE
 *   12450              48200                      7
 *   [GUNS L2]          LIEUTENANT ×1.5     ▲ ▲ ▲      <- lives, right-aligned
 *   [HULL 1]                             ⬡ LIGHTNING
 *                                          ▮▮▮▮▮▮▯▯▯▯ <- power-up timer, right-aligned
 *
 * Units: game px on web (the whole drawing is scaled), dp on native (the overlay is not scaled),
 * the same numbers on both, as every Star Swarm HUD size has always been.
 *
 * The HUD does not mirror in RTL locales (Arabic, Hebrew): it is part of the playfield, like the
 * canvas, which never mirrors, and native already runs with RTL layout off (`i18n.ts`). Only the
 * strings are translated; the score stays top-left and the wave top-right everywhere.
 *
 * Pure and React-free.
 */
import { typography } from "../../../theme/typography";
import {
  STARSWARM_ACCENT,
  STARSWARM_ARMOR_BLUE,
  STARSWARM_BONUS_LIFE,
  STARSWARM_BONUS_LIFE_GLOW,
  STARSWARM_BOSS_WAVE,
  STARSWARM_HUD_DIFFICULTY,
  STARSWARM_HUD_DIM,
  STARSWARM_HUD_TEXT,
  STARSWARM_HULL_BLUE,
  STARSWARM_LIGHTNING,
} from "../../../theme/theme.starswarm";

/** One kind of HUD text. `glow` is a soft halo in that colour (native text shadow, canvas shadow). */
export interface HudTextStyle {
  readonly family: string;
  readonly size: number;
  /** The line box, so native (Text lineHeight) and web (middle baseline) place glyphs alike. */
  readonly lineHeight: number;
  readonly color: string;
  readonly glow: string | null;
  readonly glowRadius: number;
  readonly letterSpacing: number;
}

function style(
  family: string,
  size: number,
  lineHeight: number,
  color: string,
  glow: string | null = null,
  glowRadius = 0,
  letterSpacing = 0
): HudTextStyle {
  return { family, size, lineHeight, color, glow, glowRadius, letterSpacing };
}

/**
 * Every HUD text. Headlines and numerals are Space Grotesk, labels and body Manrope
 * (`docs/BRANDING.md`). The mock's 6–7 px captions (chips, power-up name) are raised to 8, the
 * smallest size the HUD ever used, for legibility; the best score is Space Grotesk 400 (the mock
 * drew 500, a weight the app does not load).
 */
export const HUD_TEXT = {
  /** "SCORE", "BEST", "WAVE": Manrope 700, dim. */
  caption: style(typography.label, 8, 10, STARSWARM_HUD_DIM, null, 0, 1),
  /** The score and the wave number: Space Grotesk 700, white, soft cyan glow. */
  numeral: style(typography.heading, 18, 22, STARSWARM_HUD_TEXT, STARSWARM_ACCENT, 6),
  /** The best score: Space Grotesk 400, dim. */
  best: style(typography.headingLight, 13, 16, STARSWARM_HUD_DIM),
  /** "LIEUTENANT ×1.5": Manrope 600. */
  difficulty: style(typography.bodyMedium, 8, 10, STARSWARM_HUD_DIFFICULTY, null, 0, 0.5),
  /** "GUNS L2" / "HULL 1" in their outline chips: Manrope 700 (colour per chip, below). */
  chip: style(typography.label, 8, 10, STARSWARM_ACCENT, null, 0, 0.5),
  /** The active power-up's name over its bar: Manrope 700 (colour per power-up, below). */
  powerUpName: style(typography.label, 8, 10, STARSWARM_LIGHTNING, null, 0, 0.5),
  /** "GUNS +1", "SHIELD → NEXT WAVE"…: Space Grotesk 700, glowing in the cue's own colour. */
  pickupCue: style(typography.heading, 18, 24, STARSWARM_ACCENT, STARSWARM_ACCENT, 6),
  /** "QUICK, GRAB 'EM…" / "CRACK IT FOR SALVAGE!": Manrope 700, accent, accent glow. */
  collectCue: style(typography.label, 11, 16, STARSWARM_ACCENT, STARSWARM_ACCENT, 4, 1),
  /** MISSION COMPLETE: Space Grotesk 700, accent glow. */
  missionComplete: style(typography.heading, 26, 32, STARSWARM_ACCENT, STARSWARM_ACCENT, 18),
  /** ROUT! / CARRIER SIGHTED: Space Grotesk 700 in the boss-wave yellow. */
  bossBanner: style(typography.heading, 22, 28, STARSWARM_BOSS_WAVE, STARSWARM_BOSS_WAVE, 10),
  /** "— WAVE N —" over the countdown digit. */
  waveIncoming: style(typography.heading, 16, 20, STARSWARM_ACCENT, STARSWARM_ACCENT, 6, 1),
  /** The countdown digit. */
  countdown: style(typography.heading, 96, 112, STARSWARM_ACCENT, STARSWARM_ACCENT, 20),
  /** 1UP: Space Grotesk 700, yellow on its amber glow. */
  bonusLife: style(typography.heading, 36, 44, STARSWARM_BONUS_LIFE, STARSWARM_BONUS_LIFE_GLOW, 8),
} as const;

export type HudTextKind = keyof typeof HUD_TEXT;

/** The chips' outline and text colours: cyan GUNS, plating-blue HULL (the plating's own blue). */
export const HUD_CHIP_COLOR = { guns: STARSWARM_ACCENT, hull: STARSWARM_ARMOR_BLUE } as const;

/** The power-up timer's colour, by power-up (its name and lit segments). */
export const HUD_POWER_UP_COLOR = {
  shield: STARSWARM_HULL_BLUE,
  lightning: STARSWARM_LIGHTNING,
} as const;

/** Native allows font scaling up to this factor: enough to help, small enough to stay one line. */
export const HUD_MAX_FONT_SCALE = 1.3;

/** Geometry shared by both renderers. */
export const HUD_LAYOUT = {
  /** Left and right inset of the score and wave columns. */
  marginX: 14,
  /** Top of the "SCORE" / "BEST" / "WAVE" captions. */
  top: 10,
  /** Gap between the score / wave numeral and what stacks under it (chips, lives). */
  underNumeralGap: 6,
  /** The GUNS / HULL chips: stacked, never side by side, so they never overlap. */
  chipHeight: 14,
  chipMinWidth: 50,
  chipPadX: 8,
  chipGap: 3,
  chipRadius: 7,
  chipBorder: 1,
  /** Lives: one mini player ship each, right-aligned under the wave. */
  lifeIcon: 14,
  lifeGap: 3,
  /** Gap between the lives row and the power-up timer under it. */
  livesToTimerGap: 8,
  /** The power-up timer: hex chip icon, then the name over a 10-segment bar. */
  timerIcon: 16,
  timerIconGap: 4,
  timerNameToBarGap: 1,
  segmentCount: 10,
  segmentWidth: 4,
  segmentGap: 2,
  segmentHeight: 5,
  /** Opacity of a spent segment (the lit ones are opaque). */
  segmentDimOpacity: 0.2,
  /** Centre of the pickup toast, from the top: today's slot under the centre column. */
  pickupCueCenterY: 66,
  /** The centre column's widest line (best score, difficulty); longer text shrinks to fit. */
  centerMaxWidth: 120,
} as const;

/**
 * Room for the score (left) or the wave (right) on a canvas this wide: what is left of the width
 * after the margins and the centre column, split between the two sides. Native gets the same from
 * flexbox (two flex: 1 columns round a centre column capped at `centerMaxWidth`); web passes it to
 * `fillText` as the max width.
 */
export function hudSideColumnWidth(canvasWidth: number): number {
  return (canvasWidth - 2 * HUD_LAYOUT.marginX - HUD_LAYOUT.centerMaxWidth) / 2;
}

/** The bar's full width: 10 segments of 4 with 2 between them. */
export const HUD_BAR_WIDTH =
  HUD_LAYOUT.segmentCount * HUD_LAYOUT.segmentWidth +
  (HUD_LAYOUT.segmentCount - 1) * HUD_LAYOUT.segmentGap;

/** The power-up timer's full width (icon, gap, bar), right-aligned to the wave number. */
export const HUD_TIMER_WIDTH = HUD_LAYOUT.timerIcon + HUD_LAYOUT.timerIconGap + HUD_BAR_WIDTH;

/** Top of the chips / lives, from the canvas top: under the caption and the numeral. */
export const HUD_UNDER_NUMERAL_TOP =
  HUD_LAYOUT.top +
  HUD_TEXT.caption.lineHeight +
  HUD_TEXT.numeral.lineHeight +
  HUD_LAYOUT.underNumeralGap;

/**
 * How many of the 10 segments are lit for a remaining fraction (0–1): rounded up, so the last
 * segment goes out as the power-up ends. A worklet: native runs it on the UI thread.
 */
export function segmentsLit(fraction: number): number {
  "worklet";
  if (!(fraction > 0)) return 0;
  return Math.min(HUD_LAYOUT.segmentCount, Math.ceil(fraction * HUD_LAYOUT.segmentCount));
}

/** The width the lit segments span, px (0 with none lit). A worklet, like `segmentsLit`. */
export function litBarWidth(fraction: number): number {
  "worklet";
  const lit = segmentsLit(fraction);
  return lit === 0
    ? 0
    : lit * (HUD_LAYOUT.segmentWidth + HUD_LAYOUT.segmentGap) - HUD_LAYOUT.segmentGap;
}

/**
 * The CSS font for a HUD text on the web canvas. No weight: each family name is one loaded face
 * (expo-font registers "SpaceGrotesk_700Bold" etc. as weight-normal faces), and asking for bold
 * would make the browser embolden an already bold face. `sans-serif` only shows until it loads.
 */
export function canvasFont(s: HudTextStyle): string {
  return `${s.size}px "${s.family}", sans-serif`;
}

/** Every HUD text's canvas font, built once (a frame builds no font strings). */
export const HUD_CANVAS_FONT: Readonly<Record<HudTextKind, string>> = Object.fromEntries(
  (Object.keys(HUD_TEXT) as HudTextKind[]).map((k) => [k, canvasFont(HUD_TEXT[k])])
) as Record<HudTextKind, string>;

/** The distinct canvas fonts, for the web canvas to load before it relies on them. */
export const HUD_CANVAS_FONTS: readonly string[] = [...new Set(Object.values(HUD_CANVAS_FONT))];

/** The GUNS chip's text: the ladder label and the level ("GUNS L2"). */
export function gunsChipText(gunsLabel: string, guns: number): string {
  return `${gunsLabel}${guns}`;
}

/** The HULL chip's text: the label and the plating count ("HULL 1"). */
export function hullChipText(hullLabel: string, hull: number): string {
  return `${hullLabel} ${hull}`;
}

/**
 * #3598 (owner): the HUD's score and best are grouped the way the app's language groups numbers
 * ("12,450" en, "12.450" de, "12 450" fr-CA, "12,34,567" hi), always in Western digits. One
 * formatter per locale, made on first use; null where the engine has no usable Intl.
 */
const hudNumberFormats = new Map<string, Intl.NumberFormat | null>();

function hudNumberFormat(locale: string): Intl.NumberFormat | null {
  let f = hudNumberFormats.get(locale);
  if (f !== undefined) return f;
  f = null;
  // `-u-nu-latn` and `numberingSystem` both ask for Western digits: an engine that ignores one
  // option usually honours the other, and `normalizeHudNumber` catches the rest.
  for (const tag of [`${locale}-u-nu-latn`, locale]) {
    try {
      f = new Intl.NumberFormat(tag, {
        numberingSystem: "latn",
        useGrouping: true,
        maximumFractionDigits: 0,
      });
      break;
    } catch {
      // an unknown tag or option: try the plain locale, then group by hand
    }
  }
  hudNumberFormats.set(locale, f);
  return f;
}

/** Native digit ranges an engine may still return (Arabic-Indic, Persian, Devanagari). */
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966] as const;

/**
 * Western digits whatever the engine returned, and separators the brand fonts have: the Arabic
 * thousands sign becomes "," (the latn separator Arabic uses) and the narrow no-break space
 * (fr-CA; Space Grotesk has no glyph for it) a no-break space.
 */
export function normalizeHudNumber(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    const block = DIGIT_BLOCKS.find((b) => c >= b && c <= b + 9);
    if (block !== undefined) out += String(c - block);
    else if (c === 0x066c) out += ",";
    else if (c === 0x202f) out += "\u00a0";
    else out += ch;
  }
  return out;
}

/** Grouping by hand, in threes with ",", where Intl is missing. */
export function groupDigits(value: number): string {
  const digits = String(Math.trunc(Math.abs(value)));
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ",";
    out += digits[i];
  }
  return value < 0 ? `-${out}` : out;
}

/** A HUD number (score, best) grouped for `locale`, in Western digits. */
export function formatHudNumber(value: number, locale: string): string {
  const f = hudNumberFormat(locale);
  if (f === null) return groupDigits(value);
  try {
    return normalizeHudNumber(f.format(value));
  } catch {
    return groupDigits(value);
  }
}

/**
 * A one-entry memo of `formatHudNumber`: it formats only when the value or the locale changed
 * since the last call. The web canvas keeps one per number, since it redraws every frame.
 */
export function createHudNumberCache(
  format: (value: number, locale: string) => string = formatHudNumber
): (value: number, locale: string) => string {
  let lastValue = Number.NaN;
  let lastLocale = "";
  let last = "";
  return (value, locale) => {
    if (value !== lastValue || locale !== lastLocale) {
      last = format(value, locale);
      lastValue = value;
      lastLocale = locale;
    }
    return last;
  };
}
