/**
 * TableFelt — the Blackjack table (#3580): the dealer at the top, the player's
 * hand(s) low near the dock, and the result on the felt between them.
 *
 *   - One hand: a fan with its label (total pill and bet) above it.
 *   - Two split hands: fans side by side; the active one outlined.
 *   - Three or four: one full-width row per hand (number, total and bet on the
 *     left), the active row larger and outlined; hands already played dimmed.
 *   - A split hand's result (total, tag, payout as a signed number) on a one-line
 *     label (fans, the grid) takes the name's place (`splitResultLabel`, #3771);
 *     a row keeps it, the name and total over the tag and payout (#3782).
 *
 * All positions come from `computeTableGeometry` (game/blackjack/layout.ts),
 * which keeps every corner index readable and the result band clear of the
 * hands. The felt reports its size through `onLayout` so the screen can size
 * the geometry to it. Overlays (flashes, toasts) and the betting spot are
 * passed as children and drawn on top.
 *
 * Motion (#3581): the cards are drawn by FeltCards (dealt, slid and turned on
 * the UI thread), the moving chips by FeltChips, and the result banner and a
 * split hand's result pop in while the motion runs. The screen's motion
 * (useBlackjackMotion) decides what is shown when.
 */
import React from "react";
import { View, Text, StyleSheet, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { HandResponse } from "../../game/blackjack/types";
import {
  showsResult,
  splitResultLabel,
  type TableGeometry,
  type Rect,
  type SplitResultLabel,
} from "../../game/blackjack/layout";
import FeltCards, { type FeltHand } from "./FeltCards";
import { FeltChips, PopIn } from "./FeltChips";
import { ChipFace } from "./ChipButton";

/** The stake chip beside a hand's total. */
const STAKE_CHIP = 11;
import { feltColor, naturalColors } from "./tableColors";
import ResultBanner from "./ResultBanner";
import {
  BANNER_POP_MS,
  dealOrigin,
  TAG_POP_MS,
  type CardIds,
  type ChipShown,
} from "./blackjackMotion";
import type { CardMotion, FeltNatural } from "./useBlackjackMotion";
import { NaturalSweep } from "./NaturalMoment";

export interface FeltResult {
  outcome: string;
  payout: number;
  detail: string | null;
  /**
   * A split round's summary ("Won: 1 · Lost: 2"), shown in the strip in place of the outcome's
   * words (#3581 spec, #3720 round 2); null for one hand.
   */
  summary?: string | null;
}

interface Props {
  geometry: TableGeometry;
  phase: string;
  dealerHand: HandResponse;
  hands: readonly HandResponse[];
  handBets: readonly number[];
  activeHandIndex: number;
  handOutcomes: readonly (string | null)[];
  handPayouts: readonly number[];
  result: FeltResult | null;
  /** Each card's id (#3581); left out: by place. */
  cardIds?: CardIds;
  /** How the cards move (#3581); left out: they never do. */
  cardMotion?: CardMotion;
  /** Hands whose own result shows (a split round reveals them in turn); left out: all. */
  revealedHands?: number;
  /**
   * The dealer's total reads "?" (#3581: until the hole card has turned); left out: while the
   * player plays and the hole card is down.
   */
  dealerConcealed?: boolean;
  /** Chips moving on the felt. */
  chips?: readonly ChipShown[];
  /** The moving chips' colour (the table's accent). */
  chipColor?: string;
  /** The motion is running: a result shown now pops in. */
  animating?: boolean;
  /** The naturals marked, and the player's natural moment (#3621); left out: none. */
  natural?: FeltNatural;
  onLayout?: (e: LayoutChangeEvent) => void;
  children?: React.ReactNode;
}

const STILL: CardMotion = { dealing: new Set(), flipping: new Set(), slideMs: 0, epoch: 0 };
const NO_NATURAL: FeltNatural = { player: false, dealer: false, since: null };

type Tone = "plain" | "active" | "bust" | "win" | "lose" | "push";

const abs = (r: Rect) => ({ left: r.x, top: r.y, width: r.width, height: r.height });

function toneForOutcome(outcome: string | null | undefined): Tone {
  if (outcome === "win" || outcome === "blackjack") return "win";
  if (outcome === "lose") return "lose";
  if (outcome === "push") return "push";
  return "plain";
}

function TotalPill({
  text,
  tone,
  label,
  testID,
}: {
  text: string;
  tone: Tone;
  label: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const bg =
    tone === "active"
      ? colors.accent
      : tone === "bust" || tone === "lose"
        ? colors.error
        : tone === "win"
          ? colors.bonus
          : colors.surfaceHigh;
  const fg = tone === "plain" || tone === "push" ? colors.text : colors.textOnAccent;
  const border = tone === "plain" ? colors.border : tone === "push" ? colors.textMuted : bg;
  return (
    <View
      testID={testID}
      style={[styles.pill, { backgroundColor: bg, borderColor: border }]}
      accessibilityLabel={label}
    >
      <Text style={[styles.pillText, { color: fg, fontFamily: typography.heading }]}>{text}</Text>
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation>["t"];

function payoutTextFor(payout: number, t: Translate): string {
  if (payout > 0) return t("payout.positive", { amount: payout });
  if (payout < 0) return t("payout.negative", { amount: payout });
  return t("payout.zero");
}

function DealerLabel({
  hand,
  concealed,
  compact,
}: {
  hand: HandResponse;
  concealed: boolean;
  /** One line (the dealer collapsed beside the result). */
  compact: boolean;
}) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const text = concealed ? "?" : String(hand.value);
  return (
    <>
      <Text
        style={[
          styles.zoneLabel,
          styles.shrink,
          { color: colors.textMuted, fontFamily: typography.label },
        ]}
        numberOfLines={compact ? 1 : 2}
      >
        {t("hand.dealer")}
      </Text>
      <TotalPill
        text={text}
        tone={!concealed && hand.value > 21 ? "bust" : "plain"}
        label={concealed ? t("a11y.dealerScoreHidden") : t("a11y.dealerScore", { score: text })}
      />
    </>
  );
}

interface HandLabelProps {
  hand: HandResponse;
  index: number;
  rect: Rect;
  /**
   * How the label is drawn (`splitResultLabel`, #3771): a column or one line, whether a split
   * hand's name stays at the result, and whether its total sits beside the name there (#3782).
   */
  layout: SplitResultLabel;
  split: boolean;
  active: boolean;
  played: boolean;
  bet: number | undefined;
  /** The hand's outcome once the result shows, else null. */
  outcome: string | null;
  /** A split hand's own payout once the result shows, else null. */
  payout: number | null;
  /** A split hand's result pops in as it is revealed. */
  pops: boolean;
  /** The stake chip's colour (the table's chips). */
  chipColor: string;
  /** The cards' landing epoch: a new one shows a pop-in at once. */
  epoch: number;
}

/**
 * A hand label's accessibility name: the hand, its total and bet, and once a split hand's result
 * shows its tag and payout ("Hand 1, Player score 21, Bet 25 chips, Win, +25 chips"), whether or
 * not its name is drawn (#3771).
 */
function handA11yLabel(
  t: Translate,
  name: string,
  valueText: string,
  bet: number | undefined,
  outcome: string | null,
  payoutText: string | null
): string {
  return [
    name,
    t("a11y.playerScore", { score: valueText }),
    bet != null ? t("a11y.handBet", { amount: bet }) : null,
    outcome !== null ? t(tagKeyOf(outcome)) : null,
    payoutText,
  ]
    .filter(Boolean)
    .join(", ");
}

/** A player hand's total pill: bust, the hand being played, then its outcome. */
function handTone(value: number, active: boolean, outcome: string | null): Tone {
  if (value > 21) return "bust";
  if (active) return "active";
  return outcome !== null ? toneForOutcome(outcome) : "plain";
}

function HandLabel({
  hand,
  index,
  rect,
  layout,
  split,
  active,
  played,
  bet,
  outcome,
  payout,
  pops,
  epoch,
  chipColor,
}: HandLabelProps) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const name = split ? t("hand.playerHand", { number: index + 1 }) : t("hand.player");
  const valueText = hand.soft ? `${hand.value}*` : String(hand.value);
  const tone = handTone(hand.value, active, outcome);
  const payoutText = payout === null ? null : payoutTextFor(payout, t);
  const named = payoutText === null || layout.named;
  const a11y = handA11yLabel(
    t,
    name,
    valueText,
    bet,
    payoutText === null ? null : outcome,
    payoutText
  );

  const twoLines = payoutText !== null && layout.totalBesideName;
  const nameText = (dimmed: boolean) => (
    <Text
      testID="hand-name"
      style={[
        styles.zoneLabel,
        { color: active ? colors.accentText : colors.textMuted, fontFamily: typography.label },
        styles.shrink,
        dimmed && styles.dimmed,
      ]}
      numberOfLines={1}
    >
      {name}
    </Text>
  );
  const total = (
    <TotalPill
      testID="hand-total"
      text={valueText}
      tone={tone}
      label={t("a11y.playerScore", { score: valueText })}
    />
  );
  // A split hand's own result: it pops in as the hands are revealed in turn (#3581).
  const resultTag = payout !== null && (
    <PopIn
      animate={pops}
      epoch={epoch}
      durationMs={TAG_POP_MS}
      fromScale={0.8}
      style={styles.shrink}
    >
      <View testID="hand-result" style={[styles.labelLine, styles.shrink]}>
        {outcome !== null && <HandTag outcome={outcome} />}
        <PayoutText payout={payout} />
      </View>
    </PopIn>
  );

  return (
    <View
      testID={`hand-label-${index}`}
      style={[styles.abs, abs(rect), layout.column ? styles.rowLabel : styles.fanLabel]}
      accessible
      accessibilityLabel={a11y}
    >
      {twoLines ? (
        <>
          <View style={[styles.labelLine, played && styles.dimmed]}>
            {nameText(false)}
            {total}
          </View>
          <View style={[styles.labelLine, played && styles.dimmed]}>{resultTag}</View>
        </>
      ) : (
        <>
          {named && nameText(played)}
          <View style={[styles.labelLine, played && styles.dimmed]}>
            {total}
            {bet != null && payoutText === null && <HandStake bet={bet} chipColor={chipColor} />}
            {resultTag}
          </View>
        </>
      )}
    </View>
  );
}

/**
 * The stake: a chip (decorative) beside the amount (#3720, as the mockup). The amount shrinks to
 * fit a tight row label; the label's accessibility name says the bet.
 */
function HandStake({ bet, chipColor }: { bet: number; chipColor: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stake, styles.shrink]}>
      <ChipFace testID="hand-stake-chip" size={STAKE_CHIP} color={chipColor} />
      <Text
        testID="hand-bet"
        style={[
          styles.bet,
          styles.shrink,
          { color: colors.celebration, fontFamily: typography.heading },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {bet}
      </Text>
    </View>
  );
}

/** A split hand's WIN / LOSE / PUSH tag, popping in with its chips (#3581 spec). */
function HandTag({ outcome }: { outcome: string }) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const key = tagKeyOf(outcome);
  const color =
    key === "tag.win" ? colors.bonusText : key === "tag.lose" ? colors.error : colors.textMuted;
  return (
    <Text
      testID="hand-tag"
      style={[
        styles.tag,
        styles.shrink,
        { color, borderColor: color, fontFamily: typography.heading },
      ]}
      // Every locale's tag fits its line (#3782, tableGeometry.test.ts); the shrink is a backstop.
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
    >
      {t(key)}
    </Text>
  );
}

/** A split hand's tag key for its outcome: its tag, and the word its accessibility label says. */
function tagKeyOf(outcome: string): "tag.win" | "tag.lose" | "tag.push" {
  if (outcome === "win" || outcome === "blackjack") return "tag.win";
  return outcome === "lose" ? "tag.lose" : "tag.push";
}

/**
 * A split hand's payout, always a signed number ("+25", "-400", "0"; #3779): its words ("+25
 * chips") are in the label's accessibility name.
 */
function PayoutText({ payout }: { payout: number }) {
  const { colors } = useTheme();
  return (
    <Text
      testID="hand-payout"
      style={[
        styles.payout,
        styles.shrink,
        { color: payout > 0 ? colors.bonusText : payout < 0 ? colors.error : colors.textMuted },
      ]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
    >
      {payout > 0 ? `+${payout}` : String(payout)}
    </Text>
  );
}

/** A chip's stake: its hand's label (the bet shows there), or the betting circle. */
function stakeOf(geometry: TableGeometry, chip: ChipShown): Rect | null {
  return chip.kind === "bet" ? geometry.betSpot : (geometry.hands[chip.hand]?.label ?? null);
}

function HandBox({ rect, active, rows }: { rect: Rect; active: boolean; rows: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      pointerEvents="none"
      style={[
        styles.abs,
        styles.box,
        abs(rect),
        active
          ? { borderColor: colors.accent, backgroundColor: colors.surfaceHigh }
          : {
              borderColor: "transparent",
              backgroundColor: rows ? colors.surfaceAlt : "transparent",
            },
      ]}
    />
  );
}

/**
 * The cards FeltCards draws: the dealer's (unless collapsed beside the result), then each hand's,
 * with a natural's edges (#3621): the dealer's silver, and one hand's gold with its moment.
 */
function feltHandsOf(p: {
  readonly geometry: TableGeometry;
  readonly dealerHand: HandResponse;
  readonly hands: readonly HandResponse[];
  readonly cardIds: CardIds | undefined;
  readonly isPlayed: (i: number) => boolean;
  readonly natural: FeltNatural;
}): FeltHand[] {
  const { geometry, dealerHand, hands, cardIds, isPlayed, natural } = p;
  const gold = natural.player && hands.length === 1;
  return [
    ...(dealerHand.cards.length > 0 && !geometry.dealer.collapsed
      ? [
          {
            id: "dealer",
            cards: dealerHand.cards,
            ids: cardIds?.dealer ?? [],
            fan: geometry.dealer.fan,
            natural: natural.dealer ? ("silver" as const) : null,
          },
        ]
      : []),
    ...hands.flatMap((hand, i) => {
      const g = geometry.hands[i];
      if (!g) return [];
      return [
        {
          id: `hand-${i}`,
          cards: hand.cards,
          ids: cardIds?.hands[i] ?? [],
          fan: g.fan,
          dimmed: isPlayed(i),
          natural: gold ? ("gold" as const) : null,
          moment: gold ? natural.since : null,
        },
      ];
    }),
  ];
}

/** The player's natural moment's light sweep, while it plays (#3621). */
function sweepOf(natural: FeltNatural, geometry: TableGeometry) {
  if (natural.since === null) return null;
  return (
    <NaturalSweep
      key={natural.since}
      since={natural.since}
      feltWidth={geometry.feltWidth}
      feltHeight={geometry.feltHeight}
    />
  );
}

export default function TableFelt({
  geometry,
  phase,
  dealerHand,
  hands,
  handBets,
  activeHandIndex,
  handOutcomes,
  handPayouts,
  result,
  cardIds,
  cardMotion = STILL,
  revealedHands,
  dealerConcealed,
  chips = [],
  chipColor,
  animating = false,
  natural = NO_NATURAL,
  onLayout,
  children,
}: Props) {
  const { colors, theme } = useTheme();
  const playing = phase === "player";
  const showResult = showsResult(phase) && result !== null;
  const split = hands.length > 1;
  const rows = geometry.mode === "rows";
  const compact = rows || geometry.mode === "grid";
  const labelLayout = splitResultLabel(geometry.mode);
  const concealed = dealerConcealed ?? (playing && dealerHand.cards.some((c) => c.face_down));
  const revealed = revealedHands ?? hands.length;
  // While the dealer plays every hand is played: none is outlined, all are dimmed.
  const isPlayed = (i: number) => playing && split && i < activeHandIndex;
  const feltHands = feltHandsOf({ geometry, dealerHand, hands, cardIds, isPlayed, natural });
  return (
    <View
      testID="blackjack-felt"
      style={[styles.felt, { backgroundColor: feltColor(colors), borderColor: colors.border }]}
      onLayout={onLayout}
    >
      {/* Split boxes first, so labels and cards draw over them. */}
      {split &&
        geometry.hands.map((g, i) => (
          <View key={`box-${i}`} testID={`hand-box-${i}`} style={[styles.abs, abs(g.box)]}>
            <HandBox
              rect={{ x: 0, y: 0, width: g.box.width, height: g.box.height }}
              active={playing && i === activeHandIndex}
              rows={rows}
            />
          </View>
        ))}

      {/* Dealer */}
      {dealerHand.cards.length > 0 && (
        <>
          <View
            testID="dealer-label"
            style={[
              styles.abs,
              abs(geometry.dealer.label),
              geometry.dealer.labelBeside ? styles.rowLabel : styles.fanLabel,
            ]}
          >
            <DealerLabel
              hand={dealerHand}
              concealed={concealed}
              compact={geometry.dealer.collapsed}
            />
          </View>
        </>
      )}

      {/* Result, between the dealer and the hands */}
      {showResult && geometry.result && (
        <PopIn
          testID="blackjack-felt-result"
          animate={animating}
          epoch={cardMotion.epoch}
          durationMs={BANNER_POP_MS}
          fromScale={0.9}
          style={[styles.abs, styles.result, abs(geometry.result)]}
        >
          <ResultBanner
            variant="felt"
            compact={compact}
            outcome={result.outcome}
            payout={result.payout}
            detail={result.detail}
            summary={result.summary ?? null}
            // 3–4 hands: each hand shows its own tag and payout, so the banner shows the net
            // alone; the summary does not fit beside it in every locale (#3781, owner decision).
            netOnly={hands.length >= 3}
          />
        </PopIn>
      )}

      {/* Player hand(s) */}
      {hands.map((hand, i) => {
        const g = geometry.hands[i];
        if (!g) return null;
        const played = isPlayed(i);
        const shows = showResult && i < revealed;
        return (
          <HandLabel
            key={`hand-${i}`}
            hand={hand}
            index={i}
            rect={g.label}
            layout={labelLayout}
            split={split}
            active={playing && i === activeHandIndex}
            played={played}
            bet={handBets[i]}
            outcome={shows ? (handOutcomes[i] ?? (split ? "push" : result.outcome)) : null}
            payout={shows && split ? (handPayouts[i] ?? 0) : null}
            pops={animating}
            epoch={cardMotion.epoch}
            chipColor={chipColor ?? colors.accent}
          />
        );
      })}

      {/* A natural's light sweep across the felt, under the cards (#3621). */}
      {sweepOf(natural, geometry)}
      {/* The cards, above the labels and the result: a dealt card flies in over them. */}
      <FeltCards hands={feltHands} motion={cardMotion} origin={dealOrigin(geometry.feltWidth)} />
      <FeltChips
        chips={chips}
        feltWidth={geometry.feltWidth}
        feltHeight={geometry.feltHeight}
        stakeOf={(chip) => stakeOf(geometry, chip)}
        color={chipColor ?? colors.accent}
        rim={colors.surface}
        naturalRim={naturalColors(theme).gold}
      />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  felt: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
  },
  abs: {
    position: "absolute",
  },
  box: {
    borderRadius: 12,
    borderWidth: 1.5,
  },
  fanLabel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  rowLabel: {
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "flex-start",
    gap: 3,
  },
  labelLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  zoneLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  pill: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "700",
  },
  bet: {
    fontSize: 11,
    fontWeight: "700",
  },
  stake: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  payout: {
    fontSize: 11,
    fontWeight: "700",
  },
  tag: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  shrink: {
    flexShrink: 1,
  },
  dimmed: {
    opacity: 0.55,
  },
  result: {
    alignItems: "center",
    justifyContent: "center",
  },
});
