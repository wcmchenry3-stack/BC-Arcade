/**
 * The Yacht scorecard (#3748): one table for solo and for a game against the computer — one score
 * column for you, two with the computer's — with all 13 rows, the upper subtotal band and the
 * total on one screen: no tabs, no scrolling. The row height is measured, not assumed
 * (`scoreRowHeight.ts`, #3968): 26 to 32 pt from the height the screen gives the table. Below the
 * height 13 rows of 26 pt need, the table scrolls, and the computer's last row is scrolled into view.
 *
 * Row look, in both modes (#3968): a scored row has a muted fill, a check mark before its label, a
 * dimmer label and a bold score (a scored 0 too, so it never reads as an open "—"); an open row has
 * no fill, with the points on the table in the potential (teal) colour, 0s dimmed, and the best row
 * boxed. The Hint's row is tinted green with a bar; the row the computer just scored is tinted
 * purple with a bar (over the fill when you have scored it too). The check, not the colour, is the
 * cue. The upper subtotal is a band of its own (not a score row, not tappable). Text ignores
 * system font scaling above 1.2x so the rows keep their height.
 *
 * Motion (#3749, `scoreMotion.tsx`): a score's cell pops and the total counts up, for you and the
 * computer; the "+35" pulses when the upper bonus is earned. None of it under Reduce Motion.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import MaterialIcons from "../icons/MaterialIcons";
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
import { DEFAULT_ROW_HEIGHT, clampRowHeight } from "./scoreRowHeight";

/**
 * Dynamic Type / font scale is capped on the card's text (#3968): the 13 rows, the band and the
 * total are sized to fit one screen, so a large system font must not grow them. 1.2 keeps the
 * text readable (a 13 pt label becomes 15.6 pt) and the rows' height holds.
 */
const MAX_FONT_SCALE = 1.2;

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

/** Size (pt) of the scored row's check mark. */
const CHECK_SIZE = 14;
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
  // A scored row's fill (#3968): the band's quiet surface. Only ~1.15 to 1.2:1 against the card, so
  // it is never the only cue: the check mark, the dimmer label and the bold score carry the meaning.
  const scoredBg = bandBg;

  // Row height from the height the table is given (#3968); 29 pt until it is measured.
  const [availH, setAvailH] = useState<number | null>(null);
  const rowH = availH === null ? DEFAULT_ROW_HEIGHT : clampRowHeight(availH);

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
      // A scored value is bold, a scratched 0 too: it is a result, not an open "—" (#3968).
      playerColor = colors.text;
      playerWeight = "700";
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
          accessibilityState={{ disabled: !hot || inputLocked, checked: filled, selected: filled }}
          style={[
            styles.row,
            { minHeight: rowH },
            !isLast && {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.border,
            },
            { backgroundColor: filled ? scoredBg : tint },
          ]}
        >
          {filled && isCpuRow && (
            // The computer's tint sits over the scored row's fill, so both read (#3968).
            <View
              pointerEvents="none"
              testID="yacht-cpu-row-tint"
              style={[styles.tintOverlay, { backgroundColor: tint }]}
            />
          )}
          {barColor !== null && (
            <View
              testID={isCpuRow ? "yacht-cpu-row-bar" : "yacht-hint-row-bar"}
              style={[styles.bar, { backgroundColor: barColor }]}
            />
          )}
          {filled && (
            <MaterialIcons
              testID={`score-row-check-${key}`}
              name="check"
              size={CHECK_SIZE}
              color={colors.text}
              style={styles.check}
            />
          )}
          <Text
            style={[
              styles.label,
              filled && styles.labelAfterCheck,
              { color: filled ? colors.textMuted : colors.text },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
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
                { height: rowH - 3 },
              ]}
            >
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.value, { color: playerColor, fontWeight: playerWeight }]}
              >
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
                maxFontSizeMultiplier={MAX_FONT_SCALE}
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
          <Text
            style={[styles.bandLabel, { color: colors.text }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {t("vsMode.upperSubtotal")}
          </Text>
          <Text
            testID="yacht-upper-bonus-line"
            style={[styles.bandLine, { color: colors.textMuted }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {line}
          </Text>
        </View>
        <View style={styles.cell}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.bandValue, { color: colors.text }]}
          >
            {playerUpper}
          </Text>
          <Pop
            on={playerEarned}
            peak={BONUS_PULSE_SCALE}
            ms={BONUS_PULSE_MS}
            reduceMotion={reduceMotion}
          >
            {playerEarned && (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.bandBonus, { color: colors.text }]}
              >
                +{UPPER_BONUS_VALUE}
              </Text>
            )}
          </Pop>
        </View>
        {isVs && (
          <View style={styles.cell}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.bandValue, { color: cpuText }]}
            >
              {cpuUpper}
            </Text>
            <Pop
              on={cpuEarned}
              peak={BONUS_PULSE_SCALE}
              ms={BONUS_PULSE_MS}
              reduceMotion={reduceMotion}
            >
              {cpuEarned && (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.bandBonus, { color: cpuText }]}
                >
                  +{UPPER_BONUS_VALUE}
                </Text>
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
      // The height the screen gives the table sets the row height (#3968).
      onLayout={(e) => setAvailH(e.nativeEvent.layout.height)}
    >
      <View
        testID="yacht-score-card"
        onLayout={(e) => {
          cardY.current = e.nativeEvent.layout.y;
        }}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.head}>
          <Text
            style={[styles.headLabel, { color: colors.textMuted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {t("vsMode.category")}
          </Text>
          <Text
            style={[styles.headCol, { color: colors.accentText }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {t("score.you")}
          </Text>
          {isVs && (
            <Text
              style={[styles.headCol, { color: cpuText }]}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
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
            <Text
              style={[styles.totalLabel, { color: colors.text }]}
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
            >
              {t("score.total")}
            </Text>
            {anyYachtBonus && (
              <Text
                style={[styles.bandLine, { color: colors.textMuted }]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {t("bonus.yachtLabel")}
              </Text>
            )}
          </View>
          <View style={styles.cell}>
            <CountUpText
              value={playerTotalScore}
              reduceMotion={reduceMotion}
              testID="yacht-total-you"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[
                styles.totalValue,
                { color: playerLeading ? colors.outcomeWin : colors.text },
              ]}
            />
            {anyYachtBonus && (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.bandBonus, { color: colors.textMuted }]}
              >
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
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.totalValue, { color: cpuLeading ? colors.outcomeWin : colors.text }]}
              />
              {anyYachtBonus && (
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={[styles.bandBonus, { color: colors.textMuted }]}
                >
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
    minHeight: DEFAULT_ROW_HEIGHT,
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
  labelAfterCheck: { paddingLeft: 0 },
  check: { marginLeft: 4 },
  tintOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: 4 },
  cell: { width: COL_W, alignItems: "center", justifyContent: "center" },
  valueBox: {
    minWidth: COL_W - 8,
    height: DEFAULT_ROW_HEIGHT - 3,
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
