/**
 * Reports cards that run off the table (#3653): one shared check for the card
 * games' screens (Solitaire, FreeCell, Hearts, Blackjack).
 *
 * Every card game draws its cards from pure geometry computed for a measured
 * container (the felt, or Hearts' table). Cards only run off when that geometry
 * and the container disagree: font scaling, safe-area insets, split screen, a
 * tablet in landscape, or a layout bug such as #3624. Those happen on real
 * devices, which CI and the web recordings do not cover, so the screens compare
 * the content's bounds with the measured container and this module reports a
 * miss to Sentry, with a screenshot (native only, see `utils/sentryConfig.ts`).
 *
 * When it runs: from a screen's effect after a layout change (the container was
 * measured, or the geometry or a card count changed), never per frame, never
 * from a gesture or an animation worklet. The check is a few comparisons on
 * numbers the screen already has; nothing is measured. The container's first-frame
 * estimate never counts: a check without a measured container is ignored.
 *
 * Volume (CLAUDE.md: Cost → Performance → Data):
 * - A layout that fits: nothing sent, nothing stored.
 * - `cards.offTable` event: about 3 KB of text plus one 50–200 KB PNG screenshot
 *   on iOS and Android (none on web, which never initialises Sentry).
 * - Caps: internal builds at most OFF_TABLE_MAX_EVENTS_INTERNAL (1) per app
 *   process; store builds at most OFF_TABLE_MAX_EVENTS_STORE (1) per process, and
 *   only in an OFF_TABLE_SAMPLE_RATE (25%) share of processes, decided once per
 *   process. On top, `captureThrottledMessage` sends one `cards.offTable` per
 *   session and counts against the shared hourly budget.
 * - Worst case (a layout bug hitting every store player): about
 *   0.25 × processes × 200 KB, bounded by the per-process cap; a healthy release
 *   sends close to 0. Sentry's attachment quota is the limiting cost.
 * - Dials (no release needed): the server Sentry dial (`utils/sentryDial.ts`,
 *   `CLIENT_SENTRY_ENABLED` / `CLIENT_SENTRY_SAMPLE_RATE`) applies in `beforeSend`
 *   like every other message; the targeted kill switch is a Sentry inbound filter
 *   on the `cards.offTable` message.
 */
import { Dimensions, PixelRatio, Platform } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { CARDS_OFF_TABLE_MESSAGE } from "../../../utils/sentryConfig";
import { isStoreBuild } from "../buildFlavour";
import { captureThrottledMessage, onSentryThrottleReset } from "../sentryThrottle";
import { columnHeight, type ColumnCounts, type TableGeometry } from "./tableLayout";

// The event's fixed message is also its throttle key and fingerprint; it is the
// only event `shouldAttachScreenshot` lets through (utils/sentryConfig.ts).
/** Content may poke this far past the container, in dp, before it counts (rounding, borders). */
export const OFF_TABLE_TOLERANCE = 3;
/** Internal builds: at most this many `cards.offTable` events per process. */
export const OFF_TABLE_MAX_EVENTS_INTERNAL = 1;
/** Store builds: at most this many `cards.offTable` events per process. */
export const OFF_TABLE_MAX_EVENTS_STORE = 1;
/** Store builds: share of processes that may send it at all (decided once). */
export const OFF_TABLE_SAMPLE_RATE = 0.25;

export type OffTableGame = "solitaire" | "freecell" | "hearts" | "blackjack";
export type OffTableEdge = "bottom" | "right" | "left" | "top";

export interface OffTableSize {
  readonly w: number;
  readonly h: number;
}

/** A box in the container's own coordinates (origin at its top-left). */
export interface OffTableBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What the event carries besides the overflow: the numbers that reproduce the board. */
export interface OffTableContext {
  /** The felt (or table) as measured, when it differs from the container. */
  readonly felt?: { readonly width: number; readonly height: number };
  readonly cardWidth: number;
  readonly cardHeight: number;
  /** The face-up step, or a fan's step. */
  readonly step?: number;
  /** `TableGeometry.compression` (Solitaire / FreeCell), or the table's mode. */
  readonly compression?: string;
  readonly columnLengths?: readonly number[];
  readonly handLengths?: readonly number[];
  readonly trickLength?: number;
  /** Blackjack: the dealer's card count. */
  readonly dealerLength?: number;
  /** The screen's safe-area insets; launch-time ones are used when absent. */
  readonly insets?: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

export interface OffTableCheck {
  readonly game: OffTableGame;
  /**
   * False while the container is still the first-frame estimate. Only measured
   * layouts are checked.
   */
  readonly measured: boolean;
  readonly container: OffTableSize;
  readonly content: OffTableBounds;
  /** The active deck's id (`useDeck().activeDeck.id`). */
  readonly deck: string;
  /** FreeCell's Large cards as drawn; false elsewhere. */
  readonly largeCards?: boolean;
  readonly context: OffTableContext;
}

export interface OffTableOverflow {
  /** The edge that overflows the most. */
  readonly edge: OffTableEdge;
  /** How far past that edge, in dp. */
  readonly overflow: number;
  readonly byEdge: Readonly<Record<OffTableEdge, number>>;
}

/**
 * How far `content` runs past `container`, or null when it fits within
 * OFF_TABLE_TOLERANCE on every edge. Pure.
 */
export function offTableOverflow(
  container: OffTableSize,
  content: OffTableBounds,
  tolerance: number = OFF_TABLE_TOLERANCE
): OffTableOverflow | null {
  const byEdge: Record<OffTableEdge, number> = {
    bottom: content.bottom - container.h,
    right: content.right - container.w,
    // `|| 0`: a flush edge reads 0, not -0.
    left: 0 - content.left || 0,
    top: 0 - content.top || 0,
  };
  let edge: OffTableEdge = "bottom";
  for (const e of ["right", "left", "top"] as const) if (byEdge[e] > byEdge[edge]) edge = e;
  const overflow = byEdge[edge];
  if (!Number.isFinite(overflow) || overflow <= tolerance) return null;
  return { edge, overflow, byEdge };
}

let eventsSent = 0;
let sampledIn: boolean | null = null;

function maxEvents(): number {
  return isStoreBuild() ? OFF_TABLE_MAX_EVENTS_STORE : OFF_TABLE_MAX_EVENTS_INTERNAL;
}

/** Whether this process may still send one (decides the store sample on first use). */
function allowed(): boolean {
  if (eventsSent >= maxEvents()) return false;
  if (!isStoreBuild()) return true;
  if (sampledIn === null) sampledIn = Math.random() < OFF_TABLE_SAMPLE_RATE;
  return sampledIn;
}

const r1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : -1);

/** The card size, step and card counts, each only when the screen has it. */
function cardExtras(c: OffTableContext): Record<string, unknown> {
  const out: Record<string, unknown> = { cardWidth: r1(c.cardWidth), cardHeight: r1(c.cardHeight) };
  if (c.step !== undefined) out.step = r1(c.step);
  if (c.compression !== undefined) out.compression = c.compression;
  if (c.columnLengths) out.columnLengths = [...c.columnLengths];
  if (c.handLengths) out.handLengths = [...c.handLengths];
  if (c.trickLength !== undefined) out.trickLength = c.trickLength;
  if (c.dealerLength !== undefined) out.dealerLength = c.dealerLength;
  return out;
}

/** Safe-area insets; -1 each when none are known. */
function insetExtras(insets: OffTableContext["insets"] | null): Record<string, number> {
  return {
    insetsTop: insets ? r1(insets.top) : -1,
    insetsBottom: insets ? r1(insets.bottom) : -1,
    insetsLeft: insets ? r1(insets.left) : -1,
    insetsRight: insets ? r1(insets.right) : -1,
  };
}

/**
 * Checks one measured layout and, when its cards run off the container and the
 * caps allow, sends one `cards.offTable` warning. Returns whether it sent.
 * Cheap when there is nothing to send: a spent cap returns before any maths.
 */
export function reportCardsOffTable(check: OffTableCheck): boolean {
  if (!check.measured) return false;
  if (eventsSent >= maxEvents()) return false;
  const miss = offTableOverflow(check.container, check.content);
  if (miss === null) return false;
  if (!allowed()) return false;

  const { context } = check;
  const win = Dimensions.get("window");
  const sent = captureThrottledMessage(CARDS_OFF_TABLE_MESSAGE, CARDS_OFF_TABLE_MESSAGE, {
    level: "warning",
    tags: {
      game: check.game,
      edge: miss.edge,
      deck: check.deck,
      largeCards: String(check.largeCards ?? false),
      platform: Platform.OS,
    },
    extra: {
      overflow: r1(miss.overflow),
      overflowBottom: r1(miss.byEdge.bottom),
      overflowRight: r1(miss.byEdge.right),
      overflowLeft: r1(miss.byEdge.left),
      overflowTop: r1(miss.byEdge.top),
      windowWidth: r1(win.width),
      windowHeight: r1(win.height),
      feltWidth: r1(context.felt?.width ?? check.container.w),
      feltHeight: r1(context.felt?.height ?? check.container.h),
      containerWidth: r1(check.container.w),
      containerHeight: r1(check.container.h),
      contentLeft: r1(check.content.left),
      contentTop: r1(check.content.top),
      contentRight: r1(check.content.right),
      contentBottom: r1(check.content.bottom),
      ...cardExtras(context),
      fontScale: r1(PixelRatio.getFontScale()),
      ...insetExtras(context.insets ?? initialWindowMetrics?.insets ?? null),
      orientation: win.width > win.height ? "landscape" : "portrait",
    },
  });
  if (sent) eventsSent += 1;
  return sent;
}

// ---------------------------------------------------------------------------
// Solitaire and FreeCell: the tableau against the felt
// ---------------------------------------------------------------------------

export interface TableauOffTableInput {
  readonly game: "solitaire" | "freecell";
  /** The felt as measured (outer size, rim included); null until it is measured. */
  readonly measuredFelt: { readonly width: number; readonly height: number } | null;
  /** The felt's rim, in dp: the board sits inside it. */
  readonly feltBorder: number;
  readonly geometry: TableGeometry;
  readonly faceUpStep: number;
  readonly columns: readonly ColumnCounts[];
  readonly boardWidth: number;
  /** Space above the board inside the felt (FreeCell's Large-cards scroller). Default 0. */
  readonly topOffset?: number;
  /**
   * False when the board may be wider than the felt by design (FreeCell's Large
   * cards scroll sideways): only the height is checked then.
   */
  readonly checkWidth: boolean;
  readonly deck: string;
  readonly largeCards?: boolean;
  readonly insets?: OffTableContext["insets"];
}

/**
 * The tableau's tallest column against the felt's inner height less the bottom
 * band (the board is padded, then the top row, the row gap and the columns), and
 * the centred board against the felt's inner width.
 */
export function reportTableauOffTable(input: TableauOffTableInput): boolean {
  const { measuredFelt, geometry: g } = input;
  if (measuredFelt === null) return false;
  const inner = {
    w: measuredFelt.width - 2 * input.feltBorder,
    h: measuredFelt.height - 2 * input.feltBorder,
  };
  const tallest = input.columns.reduce(
    (max, counts) =>
      Math.max(max, columnHeight(g.cardHeight, g.faceDownStep, input.faceUpStep, counts)),
    0
  );
  const top = (input.topOffset ?? 0) + g.padding;
  const left = input.checkWidth ? (inner.w - input.boardWidth) / 2 : 0;
  return reportCardsOffTable({
    game: input.game,
    measured: true,
    // The band sits above the felt's bottom padding: the larger of the two is kept clear.
    container: { w: inner.w, h: inner.h - Math.max(g.padding, g.bottomBand) },
    content: {
      left,
      top,
      right: input.checkWidth ? left + input.boardWidth : 0,
      bottom: top + g.topCardHeight + g.rowGap + tallest,
    },
    deck: input.deck,
    largeCards: input.largeCards ?? false,
    context: {
      felt: measuredFelt,
      cardWidth: g.cardWidth,
      cardHeight: g.cardHeight,
      step: input.faceUpStep,
      compression: g.compression,
      columnLengths: input.columns.map((c) => c.down + c.up),
      insets: input.insets,
    },
  });
}

/**
 * Tests only: forget the per-process count and the store sample.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function resetOffTableReportForTests(): void {
  eventsSent = 0;
  sampledIn = null;
}

onSentryThrottleReset(resetOffTableReportForTests);
