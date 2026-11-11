/**
 * #3598: the web canvas's HUD — the H1-A layout drawn into the 2D context with the same fonts,
 * sizes, colours, glows and gaps as the native overlay (`render/hudStyle.ts`), so Expo Web shows
 * what iOS and Android show. Called from `GameCanvas.web.tsx`'s draw, in game px (the context is
 * already scaled).
 *
 * Fonts: the brand faces are the ones `App.tsx` registers with expo-font (`@font-face` rules named
 * "SpaceGrotesk_700Bold" etc.). Canvas text never triggers or waits for a webfont on its own, and
 * on Safari expo-font resolves before the face has loaded, so the canvas asks for every HUD font
 * up front (`loadHudFonts`, on mount). Until a face is ready the text draws in `sans-serif`; the
 * canvas redraws every frame, so the brand face takes over on the frame it lands. A font that
 * cannot be loaded leaves a Sentry breadcrumb (no event, so no cost) instead of failing silently.
 */
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
  segmentsLit,
} from "../../game/starswarm/render/hudStyle";
import { STARSWARM_HUD_CHIP_FILL } from "../../theme/theme.starswarm";

/** Each kind's canvas letter spacing, built once. */
const LETTER_SPACING: Readonly<Record<HudTextKind, string>> = Object.fromEntries(
  (Object.keys(HUD_TEXT) as HudTextKind[]).map((k) => [k, `${HUD_TEXT[k].letterSpacing}px`])
) as Record<HudTextKind, string>;

/**
 * Set the context up for one kind of HUD text: font, colour, letter spacing and glow. `color`
 * overrides the kind's own (a chip, a power-up, a cue). Call `endHudText` after drawing.
 */
export function beginHudText(ctx: CanvasRenderingContext2D, kind: HudTextKind, color?: string) {
  const s = HUD_TEXT[kind];
  ctx.font = HUD_CANVAS_FONT[kind];
  ctx.fillStyle = color ?? s.color;
  // Chrome / Firefox space the letters as native does; older engines ignore the property.
  (ctx as { letterSpacing?: string }).letterSpacing = LETTER_SPACING[kind];
  if (s.glow !== null) {
    ctx.shadowColor = s.glow === s.color && color !== undefined ? color : s.glow;
    ctx.shadowBlur = s.glowRadius;
  }
}

/** Undo `beginHudText`'s glow and letter spacing. */
export function endHudText(ctx: CanvasRenderingContext2D) {
  ctx.shadowBlur = 0;
  (ctx as { letterSpacing?: string }).letterSpacing = "0px";
}

/** One line of HUD text, glyphs centred in the kind's line box like native's lineHeight. */
function line(
  ctx: CanvasRenderingContext2D,
  kind: HudTextKind,
  text: string,
  x: number,
  top: number,
  color?: string,
  maxWidth?: number
) {
  beginHudText(ctx, kind, color);
  const y = top + HUD_TEXT[kind].lineHeight / 2;
  if (maxWidth === undefined) ctx.fillText(text, x, y);
  else ctx.fillText(text, x, y, maxWidth);
  endHudText(ctx);
}

/** Measured chip text widths, by text (cleared when the fonts land, as widths change then). */
const chipWidths = new Map<string, number>();

/** Forget measured widths — call once the brand fonts have loaded. */
export function resetHudTextCache() {
  chipWidths.clear();
}

function chipWidth(ctx: CanvasRenderingContext2D, text: string): number {
  let w = chipWidths.get(text);
  if (w === undefined) {
    ctx.font = HUD_CANVAS_FONT.chip;
    w = Math.max(
      HUD_LAYOUT.chipMinWidth,
      Math.ceil(ctx.measureText(text).width) + 2 * HUD_LAYOUT.chipPadX
    );
    chipWidths.set(text, w);
  }
  return w;
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  const w = chipWidth(ctx, text);
  const h = HUD_LAYOUT.chipHeight;
  const b = HUD_LAYOUT.chipBorder;
  ctx.beginPath();
  // inset by half the border so the stroke sits inside the box, as a native border does
  const rx = x + b / 2;
  const ry = y + b / 2;
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(rx, ry, w - b, h - b, HUD_LAYOUT.chipRadius);
  } else {
    ctx.rect(rx, ry, w - b, h - b);
  }
  ctx.fillStyle = STARSWARM_HUD_CHIP_FILL;
  ctx.fill();
  ctx.lineWidth = b;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.textAlign = "center";
  line(ctx, "chip", text, x + w / 2, y + (h - HUD_TEXT.chip.lineHeight) / 2, color);
}

/** What one frame's HUD shows. Strings come translated; images are null until loaded. */
export interface WebHudFrame {
  width: number;
  scoreCaption: string;
  score: number;
  bestCaption: string;
  best: number;
  difficulty: string;
  waveCaption: string;
  wave: number;
  gunsText: string;
  hullText: string;
  lives: number;
  /** The chosen ship's base layer (#3600), or null while it loads. */
  lifeImage: CanvasImageSource | null;
  /** Lives fallback colour while the ship image loads. */
  lifeFallback: string;
  powerUp: "shield" | "lightning" | null;
  powerUpName: string;
  /** Remaining fraction, 0–1. */
  powerUpFraction: number;
  /** The power-up's hex chip (#3595), or null while it loads. */
  powerUpIcon: CanvasImageSource | null;
}

/**
 * Draw the H1-A HUD columns. The caller reuses one `WebHudFrame` object, so a frame allocates
 * nothing here beyond what canvas text drawing does itself.
 */
export function drawWebHud(ctx: CanvasRenderingContext2D, f: WebHudFrame) {
  const left = HUD_LAYOUT.marginX;
  const right = f.width - HUD_LAYOUT.marginX;
  const centre = f.width / 2;
  const top = HUD_LAYOUT.top;
  const numeralTop = top + HUD_TEXT.caption.lineHeight;
  ctx.textBaseline = "middle";

  // Top left: SCORE over the score; GUNS and HULL chips stacked under it
  ctx.textAlign = "left";
  line(ctx, "caption", f.scoreCaption, left, top);
  line(ctx, "numeral", String(f.score), left, numeralTop);
  chip(ctx, f.gunsText, left, HUD_UNDER_NUMERAL_TOP, HUD_CHIP_COLOR.guns);
  chip(
    ctx,
    f.hullText,
    left,
    HUD_UNDER_NUMERAL_TOP + HUD_LAYOUT.chipHeight + HUD_LAYOUT.chipGap,
    HUD_CHIP_COLOR.hull
  );

  // Top centre: BEST over the best score, the difficulty line under it
  ctx.textAlign = "center";
  line(ctx, "caption", f.bestCaption, centre, top);
  line(ctx, "best", String(f.best), centre, numeralTop);
  line(ctx, "difficulty", f.difficulty, centre, numeralTop + HUD_TEXT.best.lineHeight);

  // Top right: WAVE over the wave number; lives, then the power-up timer, right-aligned under it
  ctx.textAlign = "right";
  line(ctx, "caption", f.waveCaption, right, top);
  line(ctx, "numeral", String(f.wave), right, numeralTop);
  const lifeY = HUD_UNDER_NUMERAL_TOP;
  const size = HUD_LAYOUT.lifeIcon;
  for (let i = 0; i < f.lives; i++) {
    const x = right - size - i * (size + HUD_LAYOUT.lifeGap);
    if (f.lifeImage) {
      ctx.drawImage(f.lifeImage, x, lifeY, size, size);
    } else {
      ctx.fillStyle = f.lifeFallback;
      ctx.fillRect(x + 2, lifeY, size - 4, size);
    }
  }

  if (f.powerUp !== null) {
    const color = HUD_POWER_UP_COLOR[f.powerUp];
    const y = lifeY + size + HUD_LAYOUT.livesToTimerGap;
    const x0 = right - HUD_TIMER_WIDTH;
    const icon = HUD_LAYOUT.timerIcon;
    const barX = x0 + icon + HUD_LAYOUT.timerIconGap;
    const blockH =
      HUD_TEXT.powerUpName.lineHeight + HUD_LAYOUT.timerNameToBarGap + HUD_LAYOUT.segmentHeight;
    if (f.powerUpIcon) ctx.drawImage(f.powerUpIcon, x0, y + (blockH - icon) / 2, icon, icon);
    ctx.textAlign = "left";
    line(ctx, "powerUpName", f.powerUpName, barX, y, color, right - barX);
    const segY = y + HUD_TEXT.powerUpName.lineHeight + HUD_LAYOUT.timerNameToBarGap;
    const lit = segmentsLit(f.powerUpFraction);
    ctx.fillStyle = color;
    for (let k = 0; k < HUD_LAYOUT.segmentCount; k++) {
      ctx.globalAlpha = k < lit ? 1 : HUD_LAYOUT.segmentDimOpacity;
      ctx.fillRect(
        barX + k * (HUD_LAYOUT.segmentWidth + HUD_LAYOUT.segmentGap),
        segY,
        HUD_LAYOUT.segmentWidth,
        HUD_LAYOUT.segmentHeight
      );
    }
    ctx.globalAlpha = 1;
  }
}

/** The document's font set, where the browser has one. */
interface FontSetLike {
  load(font: string): Promise<unknown[]>;
}

/**
 * Ask the browser for every HUD canvas font. Resolves true when each matched a loaded face,
 * false when any did not (no such `@font-face`, a network failure) or the browser has no
 * `document.fonts`. Never rejects.
 */
export async function loadHudFonts(
  fonts: FontSetLike | undefined = typeof document !== "undefined"
    ? (document as { fonts?: FontSetLike }).fonts
    : undefined
): Promise<boolean> {
  if (!fonts || typeof fonts.load !== "function") return false;
  try {
    const faces = await Promise.all(HUD_CANVAS_FONTS.map((f) => fonts.load(f)));
    return faces.every((matched) => matched.length > 0);
  } catch {
    return false;
  }
}
