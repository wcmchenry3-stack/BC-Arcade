/**
 * The Yacht scorecard (#3748): one table for solo and for a game against the computer — one score
 * column for you, two with the computer's — with all 13 rows, the upper subtotal band and the
 * total on a 390 x 844 phone: no tabs, no scrolling. Below the height that takes (a 320 x 568
 * phone) the table scrolls, and the computer's last row is scrolled into view.
 *
 * Row look, in both modes: an open row with points on the table shows them in the potential
 * (teal) colour, 0s dimmed, and the best row boxed; a scored row shows its score in bold; the
 * Hint's row is tinted green with a bar; the row the computer just scored is tinted purple with
 * a bar. The upper subtotal is a band of its own (not a score row, not tappable).
 *
 * Motion (#3749, `scoreMotion.tsx`): a score's cell pops and the total counts up, for you and the
 * computer; the "+35" pulses when the upper bonus is earned. None of it under Reduce Motion.
 */
import React, { useCallback, useEffect, useRef } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { useReduceMotion } from "../shared/useReduceMotion";
import {
  UPPER_CATEGORY_KEYS,
  LOWER_CATEGORY_KEYS,
  CATEGORY_I18N_KEY,
} from "../../game/yacht/categories";
import { bestPotentialKey } from "../../game/yacht/scoreSummary";
import { UPPER_BONUS_VALUE, bonusEarned, upperSum } from "../scorecard/yachtScorecardModel";
import {
  BONUS_PULSE_MS,
  BONUS_PULSE_SCALE,
  SCORE_POP_MS,
  SCORE_POP_SCALE,
} from "../../game/yacht/motion";
import { CountUpText, usePop } from "./scoreMotion";

/** A view that pops when `on` turns true (a score lands, a bonus is earned). */
function Pop({
  on,
  peak,
  ms,
  reduceMotion,
  style,
  testID,
  children,
}: {
  on: boolean;
  peak: number;
  ms: number;
  reduceMotion: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children?: React.ReactNode;
}) {
  const popStyle = usePop(on, peak, ms, reduceMotion);
  return (
    <Animated.View style={[style, popStyle]} testID={testID}>
      {children}
    </Animated.View>
  );
}

/** Row height (pt): 13 rows fit a 390 x 844 phone with the band, the total and the tray. */
export const SCORE_ROW_HEIGHT = 29;
/** Width (pt) of a score column. */
const COL_W = 56;
/** How far above a row to leave when it is scrolled into view. */
const SCROLL_MARGIN = 48;

export interface ScoreTableProps {
  playerScores: Record<string, number | null>;
  playerPossibleScores: Record<string, number>;
  playerRollsUsed: number;
  playerGameOver: boolean;
  playerTotalScore: number;
  playerYachtBonusTotal: number;
  /** The computer's card: present in a game against it, which adds its column. */
  cpu?: {
    scores: Record<string, number | null>;
    totalScore: number;
    yachtBonusTotal: number;
  } | null;
  /** The computer is playing: nothing can be scored. */
  isAiTurn: boolean;
  onScore: (category: string) => void;
  /** The row the Hint suggests (solo). */
  hintCategory?: string | null;
  /** The row the computer scored last. */
  cpuLastScored?: string | null;
  /** Your dice are still tumbling (#3749): no row takes a press, though the rows keep their look. */
  inputLocked?: boolean;
  /** Scores land with no pop or count-up: the computer's last turn scored on reopening, under the card. */
  still?: boolean;
}

export default function ScoreTable({
  playerScores,
  playerPossibleScores,
  playerRollsUsed,
  playerGameOver,
  playerTotalScore,
  playerYachtBonusTotal,
  cpu = null,
  isAiTurn,
  onScore,
  hintCategory = null,
  cpuLastScored = null,
  inputLocked = false,
  still = false,
}: ScoreTableProps) {
  const { t } = useTranslation("yacht");
  const { colors, theme } = useTheme();
  // `still`: scores land with no pop or count-up (a reopened computer last turn, under the card).
  const reduceMotion = useReduceMotion() || still;
  const isVs = cpu !== null;
  const canScore = playerRollsUsed > 0 && !playerGameOver && !isAiTurn;

  // The computer's column is purple in text: the outcome "draw" purple reaches AA on cream.
  const cpuText = colors.outcomeDraw;
  const bandBg = theme === "dark" ? colors.surfaceHigh : colors.surfaceAlt;

  const playerUpper = upperSum(playerScores);
  const cpuUpper = cpu ? upperSum(cpu.scores) : 0;

  const potentials = canScore ? playerPossibleScores : {};
  const bestKey = bestPotentialKey(potentials, [...UPPER_CATEGORY_KEYS, ...LOWER_CATEGORY_KEYS]);

  // Scroll the computer's row into view when the table has to scroll (a small phone).
  const scrollRef = useRef<ScrollView>(null);
  const rowY = useRef<Record<string, number>>({});
  // Row y is relative to the card, not to the scroll content: add where the card starts.
  const cardY = useRef(0);
  const onRowLayout = useCallback(
    (key: string) => (e: LayoutChangeEvent) => {
      rowY.current[key] = e.nativeEvent.layout.y;
    },
    []
  );
  useEffect(() => {
    if (!cpuLastScored) return;
    const y = rowY.current[cpuLastScored];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({
      y: Math.max(0, cardY.current + y - SCROLL_MARGIN),
      animated: !reduceMotion,
    });
  }, [cpuLastScored, reduceMotion]);

  function renderRow(key: string, isLast: boolean) {
    const label = t(CATEGORY_I18N_KEY[key] ?? "");
    const playerScore = playerScores[key] ?? null;
    const cpuScore = cpu ? (cpu.scores[key] ?? null) : null;
    const filled = playerScore !== null;
    const possible = potentials[key];
    const hot = !filled && canScore;
    const hasPotential = hot && possible !== undefined;
    const isBest = hasPotential && key === bestKey;
    const isHint = hot && key === hintCategory;
    const isCpuRow = isVs && key === cpuLastScored;

    const stateText = filled
      ? t("score.scored", { score: playerScore })
      : hasPotential
        ? t("score.potential", { potential: possible })
        : t("score.notAvailable");

    const barColor = isCpuRow ? colors.secondary : isHint ? colors.outcomeWin : null;
    const tint = isCpuRow
      ? colors.secondary + "26"
      : isHint
        ? colors.outcomeWin + "26"
        : "transparent";

    let playerText = "—";
    let playerColor = colors.textMuted;
    let playerWeight: "400" | "700" = "400";
    if (filled) {
      playerText = String(playerScore);
      // A scratched row (0) is dimmed, like a 0 potential.
      playerColor = playerScore === 0 ? colors.textMuted : colors.text;
      playerWeight = playerScore === 0 ? "400" : "700";
    } else if (hasPotential) {
      playerText = String(possible);
      // Zeros are dimmed: a wasted row reads quieter than a row with points in it.
      playerColor = possible === 0 ? colors.textMuted : colors.potential;
      playerWeight = isBest ? "700" : "400";
    }

    return (
      // The wrapper carries the layout: where the row is, for scrolling it into view.
      <View key={key} testID={`yacht-row-wrap-${key}`} onLayout={onRowLayout(key)}>
        <Pressable
          testID={`score-row-${key}`}
          onPress={hot ? () => onScore(key) : undefined}
          disabled={!hot || inputLocked}
          accessibilityRole="button"
          accessibilityLabel={
            cpu
              ? t("score.labelVs", {
                  category: label,
                  state: stateText,
                  cpu: cpuScore !== null ? String(cpuScore) : t("score.cpuOpen"),
                })
              : t("score.label", { category: label, state: stateText })
          }
          accessibilityState={{ disabled: !hot || inputLocked }}
          style={[
            styles.row,
            !isLast && {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.border,
            },
            { backgroundColor: tint },
          ]}
        >
          {barColor !== null && (
            <View
              testID={isCpuRow ? "yacht-cpu-row-bar" : "yacht-hint-row-bar"}
              style={[styles.bar, { backgroundColor: barColor }]}
            />
          )}
          <Text style={[styles.label, { color: colors.text }]} numberOfLines={2}>
            {label}
          </Text>
          <View style={styles.cell}>
            <Pop
              on={filled}
              peak={SCORE_POP_SCALE}
              ms={SCORE_POP_MS}
              reduceMotion={reduceMotion}
              testID={isBest ? "yacht-best-potential" : undefined}
              style={[
                styles.valueBox,
                isBest && {
                  borderWidth: 2,
                  borderColor: colors.accentText,
                  backgroundColor: colors.heldBg,
                },
              ]}
            >
              <Text style={[styles.value, { color: playerColor, fontWeight: playerWeight }]}>
                {playerText}
              </Text>
            </Pop>
          </View>
          {isVs && (
            <Pop
              on={cpuScore !== null}
              peak={SCORE_POP_SCALE}
              ms={SCORE_POP_MS}
              reduceMotion={reduceMotion}
              style={styles.cell}
            >
              <Text
                style={[
                  styles.value,
                  cpuScore !== null && cpuScore > 0
                    ? { color: cpuText, fontWeight: "700" }
                    : { color: colors.textMuted },
                ]}
              >
                {cpuScore !== null ? String(cpuScore) : "—"}
              </Text>
            </Pop>
          )}
        </Pressable>
      </View>
    );
  }

  function renderSubtotalBand() {
    const playerEarned = bonusEarned(playerUpper);
    const cpuEarned = bonusEarned(cpuUpper);
    const line = t(playerEarned ? "bonus.lineEarned" : "bonus.line", {
      subtotal: playerUpper,
      bonus: UPPER_BONUS_VALUE,
    });
    return (
      <View
        testID="yacht-upper-subtotal"
        style={[
          styles.band,
          {
            backgroundColor: bandBg,
            borderTopColor: colors.textMuted,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.bandLabelBox}>
          <Text style={[styles.bandLabel, { color: colors.text }]} numberOfLines={1}>
            {t("vsMode.upperSubtotal")}
          </Text>
          <Text
            testID="yacht-upper-bonus-line"
            style={[styles.bandLine, { color: colors.textMuted }]}
            numberOfLines={2}
          >
            {line}
          </Text>
        </View>
        <View style={styles.cell}>
          <Text style={[styles.bandValue, { color: colors.text }]}>{playerUpper}</Text>
          <Pop
            on={playerEarned}
            peak={BONUS_PULSE_SCALE}
            ms={BONUS_PULSE_MS}
            reduceMotion={reduceMotion}
          >
            {playerEarned && (
              <Text style={[styles.bandBonus, { color: colors.text }]}>+{UPPER_BONUS_VALUE}</Text>
            )}
          </Pop>
        </View>
        {isVs && (
          <View style={styles.cell}>
            <Text style={[styles.bandValue, { color: cpuText }]}>{cpuUpper}</Text>
            <Pop
              on={cpuEarned}
              peak={BONUS_PULSE_SCALE}
              ms={BONUS_PULSE_MS}
              reduceMotion={reduceMotion}
            >
              {cpuEarned && (
                <Text style={[styles.bandBonus, { color: cpuText }]}>+{UPPER_BONUS_VALUE}</Text>
              )}
            </Pop>
          </View>
        )}
      </View>
    );
  }

  const playerLeading = cpu !== null && playerTotalScore > cpu.totalScore;
  const cpuLeading = cpu !== null && cpu.totalScore > playerTotalScore;
  const anyYachtBonus = playerYachtBonusTotal > 0 || (cpu?.yachtBonusTotal ?? 0) > 0;

  return (
    <ScrollView
      ref={scrollRef}
      // focusable on web satisfies axe's scrollable-region-focusable rule (#454)
      focusable={Platform.OS === "web"}
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="yacht-scorecard"
    >
      <View
        testID="yacht-score-card"
        onLayout={(e) => {
          cardY.current = e.nativeEvent.layout.y;
        }}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.head}>
          <Text style={[styles.headLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {t("vsMode.category")}
          </Text>
          <Text style={[styles.headCol, { color: colors.accentText }]} numberOfLines={1}>
            {t("score.you")}
          </Text>
          {isVs && (
            <Text style={[styles.headCol, { color: cpuText }]} numberOfLines={1}>
              {t("vsMode.cpu")}
            </Text>
          )}
        </View>

        {(UPPER_CATEGORY_KEYS as readonly string[]).map((key) => renderRow(key, false))}
        {renderSubtotalBand()}
        {(LOWER_CATEGORY_KEYS as readonly string[]).map((key, i) =>
          renderRow(key, i === LOWER_CATEGORY_KEYS.length - 1)
        )}

        <View
          testID="yacht-total-row"
          style={[
            styles.total,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
          ]}
        >
          <View style={styles.bandLabelBox}>
            <Text style={[styles.totalLabel, { color: colors.text }]} numberOfLines={1}>
              {t("score.total")}
            </Text>
            {anyYachtBonus && (
              <Text style={[styles.bandLine, { color: colors.textMuted }]} numberOfLines={1}>
                {t("bonus.yachtLabel")}
              </Text>
            )}
          </View>
          <View style={styles.cell}>
            <CountUpText
              value={playerTotalScore}
              reduceMotion={reduceMotion}
              testID="yacht-total-you"
              style={[
                styles.totalValue,
                { color: playerLeading ? colors.outcomeWin : colors.text },
              ]}
            />
            {anyYachtBonus && (
              <Text style={[styles.bandBonus, { color: colors.textMuted }]}>
                {playerYachtBonusTotal > 0 ? `+${playerYachtBonusTotal}` : "—"}
              </Text>
            )}
          </View>
          {cpu !== null && (
            <View style={styles.cell}>
              <CountUpText
                value={cpu.totalScore}
                reduceMotion={reduceMotion}
                testID="yacht-total-cpu"
                style={[styles.totalValue, { color: cpuLeading ? colors.outcomeWin : colors.text }]}
              />
              {anyYachtBonus && (
                <Text style={[styles.bandBonus, { color: colors.textMuted }]}>
                  {cpu.yachtBonusTotal > 0 ? `+${cpu.yachtBonusTotal}` : "—"}
                </Text>
              )}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 22,
    gap: 6,
    paddingHorizontal: 2,
  },
  headLabel: {
    flex: 1,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  headCol: {
    width: COL_W,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: SCORE_ROW_HEIGHT,
    gap: 6,
    paddingHorizontal: 2,
    borderRadius: 4,
  },
  bar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderRadius: 2,
  },
  label: { flex: 1, fontSize: 13, lineHeight: 15, fontWeight: "500", paddingLeft: 4 },
  cell: { width: COL_W, alignItems: "center", justifyContent: "center" },
  valueBox: {
    minWidth: COL_W - 8,
    height: SCORE_ROW_HEIGHT - 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  value: { fontSize: 15, textAlign: "center" },
  band: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
    gap: 6,
    paddingHorizontal: 2,
    marginVertical: 2,
    borderTopWidth: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
  },
  bandLabelBox: { flex: 1, minWidth: 0, paddingLeft: 4 },
  bandLabel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  bandLine: { fontSize: 10.5, lineHeight: 13 },
  bandValue: { fontSize: 15, fontWeight: "800", textAlign: "center" },
  bandBonus: { fontSize: 10, fontWeight: "800", textAlign: "center" },
  total: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 38,
    gap: 6,
    paddingHorizontal: 2,
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  totalValue: { fontSize: 20, fontWeight: "800", textAlign: "center" },
});
