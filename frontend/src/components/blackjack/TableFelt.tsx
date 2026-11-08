/**
 * TableFelt — the Blackjack table (#3580): the dealer at the top, the player's
 * hand(s) low near the dock, and the result on the felt between them.
 *
 *   - One hand: a fan with its label (total pill and bet) above it.
 *   - Two split hands: fans side by side; the active one outlined.
 *   - Three or four: one full-width row per hand (number, total and bet on the
 *     left), the active row larger and outlined; hands already played dimmed.
 *
 * All positions come from `computeTableGeometry` (game/blackjack/layout.ts),
 * which keeps every corner index readable and the result band clear of the
 * hands. The felt reports its size through `onLayout` so the screen can size
 * the geometry to it. Overlays (flashes, toasts) and the betting spot are
 * passed as children and drawn on top.
 */
import React from "react";
import { View, Text, StyleSheet, type LayoutChangeEvent } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import type { HandResponse } from "../../game/blackjack/types";
import type { TableGeometry, Rect } from "../../game/blackjack/layout";
import FannedHand from "./FannedHand";
import ResultBanner from "./ResultBanner";

export interface FeltResult {
  outcome: string;
  payout: number;
  detail: string | null;
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
  onLayout?: (e: LayoutChangeEvent) => void;
  children?: React.ReactNode;
}

type Tone = "plain" | "active" | "bust" | "win" | "lose" | "push";

const abs = (r: Rect) => ({ left: r.x, top: r.y, width: r.width, height: r.height });

function toneForOutcome(outcome: string | null | undefined): Tone {
  if (outcome === "win" || outcome === "blackjack") return "win";
  if (outcome === "lose") return "lose";
  if (outcome === "push") return "push";
  return "plain";
}

function TotalPill({ text, tone, label }: { text: string; tone: Tone; label: string }) {
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

function DealerLabel({ hand, concealed }: { hand: HandResponse; concealed: boolean }) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const text = concealed ? "?" : String(hand.value);
  return (
    <>
      <Text
        style={[styles.zoneLabel, { color: colors.textMuted, fontFamily: typography.label }]}
        numberOfLines={2}
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
  rows: boolean;
  split: boolean;
  active: boolean;
  played: boolean;
  bet: number | undefined;
  /** The hand's outcome once the result shows, else null. */
  outcome: string | null;
  /** A split hand's own payout once the result shows, else null. */
  payout: number | null;
}

function HandLabel({
  hand,
  index,
  rect,
  rows,
  split,
  active,
  played,
  bet,
  outcome,
  payout,
}: HandLabelProps) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const name = split ? t("hand.playerHand", { number: index + 1 }) : t("hand.player");
  const valueText = hand.soft ? `${hand.value}*` : String(hand.value);
  let tone: Tone = "plain";
  if (hand.value > 21) tone = "bust";
  else if (active) tone = "active";
  else if (outcome !== null) tone = toneForOutcome(outcome);
  const payoutText = payout === null ? null : payoutTextFor(payout, t);
  const a11y = [
    name,
    t("a11y.playerScore", { score: valueText }),
    bet != null ? t("a11y.handBet", { amount: bet }) : null,
    payoutText,
  ]
    .filter(Boolean)
    .join(", ");
  const payoutNode =
    payoutText === null ? null : (
      <Text
        testID="hand-payout"
        style={[
          styles.payout,
          {
            color: payout! > 0 ? colors.bonus : payout! < 0 ? colors.error : colors.textMuted,
          },
        ]}
        numberOfLines={1}
      >
        {payoutText}
      </Text>
    );

  return (
    <View
      testID={`hand-label-${index}`}
      style={[styles.abs, abs(rect), rows ? styles.rowLabel : styles.fanLabel]}
      accessible
      accessibilityLabel={a11y}
    >
      <Text
        style={[
          styles.zoneLabel,
          { color: active ? colors.accent : colors.textMuted, fontFamily: typography.label },
          played && styles.dimmed,
        ]}
        numberOfLines={1}
      >
        {name}
      </Text>
      <View style={[styles.labelLine, played && styles.dimmed]}>
        <TotalPill
          text={valueText}
          tone={tone}
          label={t("a11y.playerScore", { score: valueText })}
        />
        {bet != null && payoutText === null && (
          <Text style={[styles.bet, { color: colors.celebration, fontFamily: typography.heading }]}>
            ● {bet}
          </Text>
        )}
        {!rows && payoutNode}
      </View>
      {rows && payoutNode}
    </View>
  );
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
  onLayout,
  children,
}: Props) {
  const { colors } = useTheme();
  const playing = phase === "player";
  const showResult = phase === "result" && result !== null;
  const split = hands.length > 1;
  const rows = geometry.mode === "rows";
  const concealed = playing && dealerHand.cards.some((c) => c.face_down);

  return (
    <View
      testID="blackjack-felt"
      style={[styles.felt, { backgroundColor: colors.surface, borderColor: colors.border }]}
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
            <DealerLabel hand={dealerHand} concealed={concealed} />
          </View>
          <FannedHand cards={dealerHand.cards} fan={geometry.dealer.fan} id="dealer" />
        </>
      )}

      {/* Result, between the dealer and the hands */}
      {showResult && geometry.result && (
        <View
          testID="blackjack-felt-result"
          style={[styles.abs, styles.result, abs(geometry.result)]}
        >
          <ResultBanner
            variant="felt"
            outcome={result.outcome}
            payout={result.payout}
            detail={result.detail}
          />
        </View>
      )}

      {/* Player hand(s) */}
      {hands.map((hand, i) => {
        const g = geometry.hands[i];
        if (!g) return null;
        const played = playing && split && i < activeHandIndex;
        return (
          <React.Fragment key={`hand-${i}`}>
            <HandLabel
              hand={hand}
              index={i}
              rect={g.label}
              rows={rows}
              split={split}
              active={playing && i === activeHandIndex}
              played={played}
              bet={handBets[i]}
              outcome={showResult ? (handOutcomes[i] ?? (split ? "push" : result.outcome)) : null}
              payout={showResult && split ? (handPayouts[i] ?? 0) : null}
            />
            <FannedHand cards={hand.cards} fan={g.fan} id={`hand-${i}`} dimmed={played} />
          </React.Fragment>
        );
      })}

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
  payout: {
    fontSize: 11,
    fontWeight: "700",
  },
  dimmed: {
    opacity: 0.55,
  },
  result: {
    alignItems: "center",
    justifyContent: "center",
  },
});
