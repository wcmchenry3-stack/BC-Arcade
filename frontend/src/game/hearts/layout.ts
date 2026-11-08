/**
 * Hearts card-table geometry (#3587): the pure maths behind the felt, the four seat
 * plates, the opponents' back fans, the trick and the fanned hand.
 *
 * Every number is in dp, in the table's own coordinates (origin at the top-left of the
 * area the table is given, i.e. under the header and above the tab bar). It is derived
 * from the approved "layout A" mockup, drawn on a 390 x 708 table: felt 362 x 392 at
 * (14, 64), 66 dp trick cards, 64 dp hand cards fanned +-14 degrees with a 26 dp arc.
 * Smaller and larger tables scale that drawing; a landscape table gets its own
 * vertical budget (the hand and the felt share a short height).
 *
 * Pure like `game/blackjack/layout.ts`, so the sizes are unit-tested instead of
 * eyeballed (game/hearts/__tests__/layout.test.ts).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TableMode = "portrait" | "landscape";
/** Seat positions relative to the human: self = bottom, left = West, top = North, right = East. */
export type SeatPosition = "self" | "left" | "top" | "right";
/** Trick slots, in the order TrickArea has always used. */
export type TrickPosition = "bottom" | "left" | "top" | "right";

export interface PlateGeometry {
  seat: SeatPosition;
  anchor: "center" | "left" | "right";
  /** Worst-case footprint (the plate never grows past its width); the test box for overlaps. */
  rect: Rect;
}

export interface FanCard {
  /** Top-left of the unrotated card box. */
  x: number;
  y: number;
  rotation: number;
}

export interface FanGeometry {
  seat: Exclude<SeatPosition, "self">;
  cardW: number;
  cardH: number;
  cards: FanCard[];
  /** Bounding box of the rotated cards. */
  rect: Rect;
}

export interface TrickSlot {
  /** Top-left of the unrotated card box, relative to `trick.area`. */
  x: number;
  y: number;
  rotation: number;
}

export interface TrickGeometry {
  cardW: number;
  cardH: number;
  /** The box the TrickArea lives in (table coordinates). */
  area: Rect;
  slots: Record<TrickPosition, TrickSlot>;
  /** The centre of each seat's plate, relative to `area`: where a won trick sweeps to. */
  plateCentres: Record<TrickPosition, { x: number; y: number }>;
}

export interface HandGeometry {
  cardW: number;
  cardH: number;
  /** The hand box in table coordinates; `computeHandPoses` places the cards inside it. */
  rect: Rect;
  /** Full rotation at the outer cards of a 13-card hand, in degrees. */
  spread: number;
  /** How much lower the outer cards sit than the middle one. */
  arcLift: number;
  /** How far a playable card is raised. */
  raise: number;
  /** How far a card selected for passing is raised. */
  selectLift: number;
  /** Space the 13 cards may spread over, after the rotation allowance. */
  fitWidth: number;
}

export interface HeartsTableGeometry {
  mode: TableMode;
  width: number;
  height: number;
  /** Scale against the 390 x 708 drawing. */
  scale: number;
  felt: Rect & { radius: number };
  plates: Record<SeatPosition, PlateGeometry>;
  plateHeight: number;
  fans: Record<Exclude<SeatPosition, "self">, FanGeometry>;
  trick: TrickGeometry;
  hand: HandGeometry;
  /** The pass banner's box while passing: inside the felt, under the north plate. */
  passBanner: Rect;
}

export interface HandPose {
  /** Top-left of the unrotated card box, inside `hand.rect`. */
  x: number;
  y: number;
  rotation: number;
}

/** Smallest card widths the layout ever draws (readable corner indices). */
export const MIN_HAND_CARD_W = 44;
export const MIN_TRICK_CARD_W = 40;
export const MIN_BACK_W = 20;
/** A card is 1.4 times as tall as it is wide. */
export const CARD_ASPECT = 1.4;

const REF_W = 390;
const REF_H = 640;
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.2;
/** The mockup leaves this much below the hand; only height beyond it grows the felt. */
const REF_BOTTOM_SLACK = 80;
const HAND_COUNT = 13;
const HAND_SPREAD_DEG = 14;
const PLATE_H = 34;
const SIDE_PAD = 4;

const rad = (deg: number) => (deg * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Bounding box of a w x h box with its top-left at (x, y), rotated about its centre. */
export function rotatedBounds(x: number, y: number, w: number, h: number, deg: number): Rect {
  const a = Math.abs(rad(deg));
  const bw = w * Math.cos(a) + h * Math.sin(a);
  const bh = w * Math.sin(a) + h * Math.cos(a);
  const cx = x + w / 2;
  const cy = y + h / 2;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

function union(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** @internal Used by the geometry tests only; no production caller (knip --production, #3126). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** How much wider (x) and taller (y) than the card a card tilted `HAND_SPREAD_DEG` is, per side. */
function tiltExtra(cardW: number, cardH: number): { x: number; y: number } {
  const a = rad(HAND_SPREAD_DEG);
  return {
    x: (cardW / 2) * (Math.cos(a) - 1) + (cardH / 2) * Math.sin(a),
    y: (cardW / 2) * Math.sin(a),
  };
}

/** The hand's card width: the drawing's 64 dp scaled, but never so wide that cards overlap past 24 dp. */
function handCardWidth(width: number, scale: number): number {
  const perCard = 1 + 2 * tiltExtra(1, CARD_ASPECT).x;
  const fitsAt24 = (width - 2 * SIDE_PAD - 24 * (HAND_COUNT - 1)) / perCard;
  return Math.round(clamp(Math.min(64 * scale, fitsAt24), MIN_HAND_CARD_W, 78));
}

function makeHand(
  x: number,
  width: number,
  top: number,
  cardW: number,
  raise: number,
  selectLift: number,
  arcLift: number
): HandGeometry {
  const cardH = Math.round(cardW * CARD_ASPECT);
  const extra = tiltExtra(cardW, cardH);
  return {
    cardW,
    cardH,
    rect: { x, y: top, w: width, h: Math.ceil(selectLift + arcLift + cardH + extra.y) },
    spread: HAND_SPREAD_DEG,
    arcLift,
    raise,
    selectLift,
    fitWidth: width - 2 * SIDE_PAD - cardW - 2 * extra.x,
  };
}

/**
 * Where each of `count` hand cards sits inside `hand.rect`: an even fan whose outer cards
 * tilt `spread` degrees and sit `arcLift` lower (a shallow parabola). A hand that has
 * played down fans less and keeps its cards close.
 */
export function computeHandPoses(hand: HandGeometry, count: number): HandPose[] {
  if (count <= 0) return [];
  const half = (count - 1) / 2;
  const step = count > 1 ? Math.min(hand.cardW * 0.62, hand.fitWidth / (count - 1)) : 0;
  const rowW = hand.cardW + step * (count - 1);
  const x0 = (hand.rect.w - rowW) / 2;
  const spread = hand.spread * Math.min(1, (count - 1) / (HAND_COUNT - 1));
  const poses: HandPose[] = [];
  for (let i = 0; i < count; i++) {
    const t = half > 0 ? (i - half) / half : 0;
    poses.push({
      x: x0 + i * step,
      y: hand.selectLift + t * t * hand.arcLift,
      rotation: t * spread,
    });
  }
  return poses;
}

/**
 * Bounding boxes of the rotated cards of a hand, in table coordinates (none raised).
 * @internal Used by the geometry tests only; no production caller (knip --production, #3126).
 */
export function handCardBounds(hand: HandGeometry, count: number): Rect[] {
  return computeHandPoses(hand, count).map((p) =>
    rotatedBounds(hand.rect.x + p.x, hand.rect.y + p.y, hand.cardW, hand.cardH, p.rotation)
  );
}

function makeFan(
  seat: Exclude<SeatPosition, "self">,
  centre: { x: number; y: number },
  backW: number
): FanGeometry {
  const backH = Math.round(backW * CARD_ASPECT);
  const off = backW * 0.3;
  const cards: FanCard[] = [];
  for (let i = 0; i < 4; i++) {
    const along = (i - 1.5) * off;
    const fanRot = (i - 1.5) * 5;
    if (seat === "top") {
      cards.push({ x: centre.x + along - backW / 2, y: centre.y - backH / 2, rotation: fanRot });
    } else {
      cards.push({
        x: centre.x - backW / 2,
        y: centre.y + along - backH / 2,
        rotation: (seat === "left" ? 90 : -90) + fanRot,
      });
    }
  }
  const rect = union(cards.map((c) => rotatedBounds(c.x, c.y, backW, backH, c.rotation)));
  return { seat, cardW: backW, cardH: backH, cards, rect };
}

function plateRect(anchor: PlateGeometry["anchor"], x: number, y: number, maxW: number): Rect {
  const left = anchor === "center" ? x - maxW / 2 : anchor === "left" ? x : x - maxW;
  return { x: left, y, w: maxW, h: PLATE_H };
}

const SEAT_OF: Record<TrickPosition, SeatPosition> = {
  bottom: "self",
  left: "left",
  top: "top",
  right: "right",
};

function makeTrick(
  cx: number,
  cy: number,
  cardW: number,
  gap: number,
  nudge: number,
  plates: Record<SeatPosition, PlateGeometry>
): TrickGeometry {
  const cardH = Math.round(cardW * CARD_ASPECT);
  // The mockup's spots: each card nudged and tilted a little around the centre.
  const spots: Record<TrickPosition, TrickSlot> = {
    top: { x: cx - cardW / 2, y: cy - cardH - gap / 2 + 6 * nudge, rotation: -4 },
    left: { x: cx - cardW - gap, y: cy - cardH / 2 + 4 * nudge, rotation: -10 },
    right: { x: cx + gap, y: cy - cardH / 2 - 4 * nudge, rotation: 8 },
    bottom: { x: cx - cardW / 2, y: cy + gap / 2 - 6 * nudge, rotation: 3 },
  };
  const positions = Object.keys(spots) as TrickPosition[];
  const inner = union(
    positions.map((p) => rotatedBounds(spots[p].x, spots[p].y, cardW, cardH, spots[p].rotation))
  );
  const pad = 6;
  const area: Rect = {
    x: inner.x - pad,
    y: inner.y - pad,
    w: inner.w + 2 * pad,
    h: inner.h + 2 * pad,
  };
  const slots = {} as Record<TrickPosition, TrickSlot>;
  const plateCentres = {} as Record<TrickPosition, { x: number; y: number }>;
  for (const p of positions) {
    const spot = spots[p];
    slots[p] = { x: spot.x - area.x, y: spot.y - area.y, rotation: spot.rotation };
    const plate = plates[SEAT_OF[p]];
    // A side plate is as wide as its text, so aim at the end it is anchored to.
    const reach = Math.min(plate.rect.w / 2, 40);
    const centreX =
      plate.anchor === "left"
        ? plate.rect.x + reach
        : plate.anchor === "right"
          ? plate.rect.x + plate.rect.w - reach
          : plate.rect.x + plate.rect.w / 2;
    plateCentres[p] = { x: centreX - area.x, y: plate.rect.y + plate.rect.h / 2 - area.y };
  }
  return { cardW, cardH, area, slots, plateCentres };
}

/** The portrait table at scale `s`; `grow` is extra felt height. */
function portraitAt(width: number, height: number, s: number, grow: number): HeartsTableGeometry {
  const mx = Math.round(clamp(width * 0.036, 8, 24));
  const plateMaxW = Math.round(clamp(width * 0.36, 96, 220));
  const handW = handCardWidth(width, s);
  const selectLift = 16 * s;

  // The drawing's vertical layout (the 390 x 708 mockup, less its 64 dp header).
  const northPlateY = 56 * s;
  const feltTop = 64 * s;
  const feltH = 392 * s + grow;
  const selfY = feltTop + feltH + 8 * s;
  const cx = width / 2;
  const cy = feltTop + feltH / 2 + 6 * s;
  const sideY = cy - 100 * s;

  const plates: Record<SeatPosition, PlateGeometry> = {
    top: { seat: "top", anchor: "center", rect: plateRect("center", cx, northPlateY, plateMaxW) },
    left: { seat: "left", anchor: "left", rect: plateRect("left", mx + 4 * s, sideY, plateMaxW) },
    right: {
      seat: "right",
      anchor: "right",
      rect: plateRect("right", width - mx - 4 * s, sideY, plateMaxW),
    },
    self: { seat: "self", anchor: "center", rect: plateRect("center", cx, selfY, plateMaxW) },
  };

  const backW = Math.max(MIN_BACK_W, Math.round(30 * s));
  const fans = {
    // The north fan stands behind the plate, 6 dp of it covered (as drawn).
    top: makeFan("top", { x: cx, y: northPlateY + 6 * s - (backW * CARD_ASPECT) / 2 }, backW),
    left: makeFan("left", { x: mx + backW / 2, y: cy + 4 * s }, backW),
    right: makeFan("right", { x: width - mx - backW / 2, y: cy + 4 * s }, backW),
  };

  const trick = makeTrick(
    cx,
    cy,
    Math.max(MIN_TRICK_CARD_W, Math.round(66 * s)),
    14 * s,
    s,
    plates
  );

  // The hand's box starts `selectLift` above the middle card, so a selected card never leaves it.
  const hand = makeHand(
    0,
    width,
    selfY + PLATE_H + 16 * s - selectLift,
    handW,
    10 * s,
    selectLift,
    26 * s
  );

  const passBanner: Rect = {
    x: mx + 10 * s,
    y: northPlateY + PLATE_H + 8 * s,
    w: width - 2 * mx - 20 * s,
    h: 56,
  };

  return {
    mode: "portrait",
    width,
    height,
    scale: s,
    felt: { x: mx, y: feltTop, w: width - 2 * mx, h: feltH, radius: Math.round(48 * s) },
    plates,
    plateHeight: PLATE_H,
    fans,
    trick,
    hand,
    passBanner,
  };
}

function portrait(width: number, height: number): HeartsTableGeometry {
  // The largest scale (the drawing's, or a little more on a big phone) whose hand still ends
  // inside the table. The plates do not scale, so this is searched rather than divided.
  let s = clamp(Math.min(width / REF_W, height / REF_H), MIN_SCALE, MAX_SCALE);
  const bottomOf = (g: HeartsTableGeometry) => g.hand.rect.y + g.hand.rect.h;
  let g = portraitAt(width, height, s, 0);
  while (bottomOf(g) > height && s > MIN_SCALE) {
    s = Math.max(MIN_SCALE, s - 0.01);
    g = portraitAt(width, height, s, 0);
  }
  // Height beyond the drawing's blank strip under the hand goes to the felt.
  const grow = Math.max(0, height - bottomOf(g) - REF_BOTTOM_SLACK * s);
  return grow > 0 ? portraitAt(width, height, s, grow) : g;
}

function landscape(width: number, height: number): HeartsTableGeometry {
  const half = PLATE_H / 2;
  const topInset = 2;
  const feltTop = topInset + half;
  const mx = Math.round(clamp(width * 0.02, 8, 24));

  // The hand takes the bottom band; its cards grow a little with the height.
  const handW = clamp(Math.round(MIN_HAND_CARD_W + (height - 285) * 0.35), MIN_HAND_CARD_W, 64);
  const k = handW / 64;
  const raise = 8 * k;
  const selectLift = 14 * k;
  const arcLift = 22 * k;
  // The hand box is as wide as 13 cards at their natural step, so the You plate fits beside it.
  const extra = tiltExtra(handW, Math.round(handW * CARD_ASPECT));
  const natural = Math.ceil(handW + handW * 0.62 * (HAND_COUNT - 1) + 2 * extra.x + 2 * SIDE_PAD);
  const boxW = Math.min(width, natural);
  const sized = makeHand(0, boxW, 0, handW, raise, selectLift, arcLift);
  const handTop = height - sized.rect.h;
  const hand: HandGeometry = {
    ...sized,
    rect: { ...sized.rect, x: (width - boxW) / 2, y: handTop },
  };

  const feltBottom = handTop - 2;
  const feltH = Math.max(0, feltBottom - feltTop);
  const cx = width / 2;
  const cy = feltTop + feltH / 2;
  const plateMaxW = Math.round(clamp(Math.min(width * 0.2, hand.rect.x - mx - 12), 80, 180));
  const sideY = cy - PLATE_H - 4;
  const selfY = handTop + selectLift + (hand.cardH - PLATE_H) / 2;

  const plates: Record<SeatPosition, PlateGeometry> = {
    top: { seat: "top", anchor: "center", rect: plateRect("center", cx, topInset, plateMaxW) },
    left: { seat: "left", anchor: "left", rect: plateRect("left", mx + 4, sideY, plateMaxW) },
    right: {
      seat: "right",
      anchor: "right",
      rect: plateRect("right", width - mx - 4, sideY, plateMaxW),
    },
    self: { seat: "self", anchor: "left", rect: plateRect("left", mx + 4, selfY, plateMaxW) },
  };

  const backW = Math.max(MIN_BACK_W, Math.round(30 * k));
  const fans = {
    // Beside the plate instead of above it: the height is spent on the felt and the hand.
    top: makeFan(
      "top",
      {
        x: cx + plateMaxW / 2 + 8 + backW * 1.2,
        y: Math.max(topInset + half, (backW * CARD_ASPECT) / 2 + 4),
      },
      backW
    ),
    left: makeFan("left", { x: mx + 4 + backW * 0.7, y: sideY + PLATE_H + 8 + backW * 0.9 }, backW),
    right: makeFan(
      "right",
      { x: width - mx - 4 - backW * 0.7, y: sideY + PLATE_H + 8 + backW * 0.9 },
      backW
    ),
  };

  // The largest trick card that keeps the whole trick between the north plate and the felt's edge.
  const clearTop = topInset + PLATE_H + 3;
  const clearBottom = feltBottom - 3;
  let trick = makeTrick(cx, cy, MIN_TRICK_CARD_W, 8 * k, k * 0.5, plates);
  for (let w = Math.min(66, Math.round(handW + 2)); w >= MIN_TRICK_CARD_W; w--) {
    trick = makeTrick(cx, cy, w, 8 * k, k * 0.5, plates);
    if (trick.area.y + 6 >= clearTop && trick.area.y + trick.area.h - 6 <= clearBottom) break;
  }

  const passBanner: Rect = {
    x: cx - Math.min(220, width * 0.3),
    y: topInset + PLATE_H + 4,
    w: Math.min(440, width * 0.6),
    h: 44,
  };

  return {
    mode: "landscape",
    width,
    height,
    scale: k,
    felt: { x: mx, y: feltTop, w: width - 2 * mx, h: feltH, radius: Math.round(40 * k) },
    plates,
    plateHeight: PLATE_H,
    fans,
    trick,
    hand,
    passBanner,
  };
}

/** The table's geometry for an area of `width` x `height` dp (under the header, above the tab bar). */
export function computeHeartsGeometry(input: {
  width: number;
  height: number;
}): HeartsTableGeometry {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  return width > height ? landscape(width, height) : portrait(width, height);
}
