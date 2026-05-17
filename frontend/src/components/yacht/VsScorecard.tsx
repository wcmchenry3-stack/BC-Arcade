import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";

const UPPER_KEYS = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
const LOWER_KEYS = [
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
] as const;

const CATEGORY_I18N_KEY: Record<string, string> = {
  ones: "category.ones",
  twos: "category.twos",
  threes: "category.threes",
  fours: "category.fours",
  fives: "category.fives",
  sixes: "category.sixes",
  three_of_a_kind: "category.threeOfAKind",
  four_of_a_kind: "category.fourOfAKind",
  full_house: "category.fullHouse",
  small_straight: "category.smallStraight",
  large_straight: "category.largeStraight",
  yacht: "category.yacht",
  chance: "category.chance",
};

export interface VsScorecardProps {
  playerScores: Record<string, number | null>;
  playerPossibleScores: Record<string, number>;
  playerRollsUsed: number;
  playerGameOver: boolean;
  playerUpperSubtotal: number;
  playerUpperBonus: number;
  playerTotalScore: number;
  cpuScores: Record<string, number | null>;
  cpuUpperSubtotal: number;
  cpuUpperBonus: number;
  cpuTotalScore: number;
  isAiTurn: boolean;
  onScore: (category: string) => void;
}

export default function VsScorecard({
  playerScores,
  playerPossibleScores,
  playerRollsUsed,
  playerGameOver,
  playerUpperSubtotal,
  playerUpperBonus,
  playerTotalScore,
  cpuScores,
  cpuUpperSubtotal,
  cpuUpperBonus,
  cpuTotalScore,
  isAiTurn,
  onScore,
}: VsScorecardProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const canScore = playerRollsUsed > 0 && !playerGameOver && !isAiTurn;

  const playerLowerSubtotal = (LOWER_KEYS as readonly string[]).reduce(
    (acc, key) => acc + (playerScores[key] ?? 0),
    0
  );
  const cpuLowerSubtotal = (LOWER_KEYS as readonly string[]).reduce(
    (acc, key) => acc + (cpuScores[key] ?? 0),
    0
  );
  const playerLeading = playerTotalScore > cpuTotalScore;
  const cpuLeading = cpuTotalScore > playerTotalScore;

  function renderCategoryRow(key: string, tone: "upper" | "lower", isLast: boolean) {
    const playerScore = playerScores[key] ?? null;
    const cpuScore = cpuScores[key] ?? null;
    const possible = playerPossibleScores[key];
    const playerFilled = playerScore !== null;
    const cpuFilled = cpuScore !== null;
    const isHot = !playerFilled && canScore;
    const dotColor = tone === "upper" ? colors.accent : colors.secondary;

    return (
      <View
        key={key}
        style={[styles.vsRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
      >
        <View style={styles.vsRowLeft}>
          <View style={[styles.sectionDot, { backgroundColor: dotColor }]} />
          <Text style={[styles.vsRowName, { color: colors.text }]} numberOfLines={1}>
            {t(CATEGORY_I18N_KEY[key] ?? "")}
          </Text>
        </View>

        {/* YOU cell */}
        <Pressable
          onPress={isHot ? () => onScore(key) : undefined}
          disabled={!isHot}
          style={[
            styles.vsCell,
            playerFilled
              ? { backgroundColor: colors.accent + "1a" }
              : isHot
                ? { backgroundColor: colors.accent + "33", borderWidth: 1, borderStyle: "dashed", borderColor: colors.accent }
                : { backgroundColor: colors.surfaceAlt },
          ]}
          accessibilityRole={isHot ? "button" : "text"}
          accessibilityLabel={t(CATEGORY_I18N_KEY[key] ?? "")}
          accessibilityState={{ disabled: !isHot }}
        >
          <Text
            style={[
              styles.vsCellText,
              {
                color: playerFilled
                  ? colors.accent
                  : isHot && possible !== undefined
                    ? colors.accent
                    : colors.textMuted,
              },
            ]}
          >
            {playerFilled
              ? String(playerScore)
              : isHot && possible !== undefined
                ? `+${possible}`
                : "—"}
          </Text>
        </Pressable>

        {/* CPU cell */}
        <View
          style={[
            styles.vsCell,
            cpuFilled ? { backgroundColor: colors.secondary + "1a" } : { backgroundColor: colors.surfaceAlt },
          ]}
        >
          <Text style={[styles.vsCellText, { color: cpuFilled ? colors.secondary : colors.textMuted }]}>
            {cpuFilled ? String(cpuScore) : "—"}
          </Text>
        </View>
      </View>
    );
  }

  function renderSubtotalRow(
    label: string,
    playerVal: number,
    cpuVal: number,
    withProgress: boolean
  ) {
    const playerPct = Math.min(playerVal / 63, 1);
    const cpuPct = Math.min(cpuVal / 63, 1);
    const playerBarColor = playerVal >= 63 ? colors.bonus : colors.accent;
    const cpuBarColor = cpuVal >= 63 ? colors.bonus : colors.secondary;

    return (
      <View
        style={[
          styles.vsRow,
          styles.vsSubtotalRow,
          { borderTopColor: colors.border, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.vsRowLeft}>
          <Text style={[styles.vsSubtotalLbl, { color: colors.textMuted }]}>{label}</Text>
          {withProgress && (
            <View style={[styles.vsBarTrack, { backgroundColor: colors.surfaceAlt }]}>
              {/* Player bar — full 4px height */}
              <View
                style={[
                  styles.vsBarFill,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  { width: `${playerPct * 100}%` as any, backgroundColor: playerBarColor },
                ]}
              />
              {/* CPU bar — bottom 2px */}
              <View
                style={[
                  styles.vsBarFillCpu,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  { width: `${cpuPct * 100}%` as any, backgroundColor: cpuBarColor },
                ]}
              />
            </View>
          )}
        </View>
        <View style={styles.vsCell}>
          <Text style={[styles.vsSubtotalCellText, { color: colors.accent }]}>{playerVal}</Text>
        </View>
        <View style={styles.vsCell}>
          <Text style={[styles.vsSubtotalCellText, { color: colors.secondary }]}>{cpuVal}</Text>
        </View>
      </View>
    );
  }

  function renderBonusRow() {
    const toGo = Math.max(0, 63 - playerUpperSubtotal);
    const playerBonusUnlocked = playerUpperBonus > 0;
    const cpuBonusUnlocked = cpuUpperBonus > 0;

    return (
      <View style={[styles.vsRow, styles.vsBonusRow, { borderBottomColor: colors.border }]}>
        <View style={styles.vsRowLeft}>
          <Text style={[styles.vsBonusLbl, { color: colors.textMuted }]}>
            {playerBonusUnlocked
              ? t("vsMode.bonusUnlocked")
              : t("vsMode.bonusProgress", { n: toGo })}
          </Text>
        </View>
        <View style={[styles.vsCell, { backgroundColor: "transparent" }]}>
          <Text style={{ color: playerBonusUnlocked ? colors.bonus : colors.textMuted, fontSize: 15, fontWeight: "700" }}>
            {playerBonusUnlocked ? `+${playerUpperBonus}` : "—"}
          </Text>
        </View>
        <View style={[styles.vsCell, { backgroundColor: "transparent" }]}>
          <Text style={{ color: cpuBonusUnlocked ? colors.bonus : colors.textMuted, fontSize: 15, fontWeight: "700" }}>
            {cpuBonusUnlocked ? `+${cpuUpperBonus}` : "—"}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      focusable={Platform.OS === "web"}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {/* Column header row */}
      <View style={styles.vsTableHead}>
        <View style={styles.vsRowLeft}>
          <Text style={[styles.th, { color: colors.textMuted }]}>{t("vsMode.category")}</Text>
        </View>
        <Text style={[styles.vsHeadYou, { color: colors.accent }]}>{t("score.you")}</Text>
        <Text style={[styles.vsHeadCpu, { color: colors.secondary }]}>{t("vsMode.cpu")}</Text>
      </View>

      {/* Table card */}
      <View style={[styles.vsTable, { backgroundColor: colors.surface }]}>
        {(UPPER_KEYS as readonly string[]).map((key) =>
          renderCategoryRow(key, "upper", false)
        )}
        {renderSubtotalRow(t("vsMode.upperSubtotal"), playerUpperSubtotal, cpuUpperSubtotal, true)}
        {renderBonusRow()}
        <Text style={[styles.vsSectionDivider, { color: colors.textMuted }]}>
          {t("vsMode.lower")}
        </Text>
        {(LOWER_KEYS as readonly string[]).map((key, i) =>
          renderCategoryRow(key, "lower", i === LOWER_KEYS.length - 1)
        )}
        {renderSubtotalRow(t("vsMode.lowerSubtotal"), playerLowerSubtotal, cpuLowerSubtotal, false)}
      </View>

      {/* TOTAL row */}
      <View
        style={[
          styles.vsTotalsRow,
          { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.vsTotalsLbl, { color: colors.textMuted }]}>
          {t("section.total")}
        </Text>
        <Text style={[styles.vsTotalsYou, { color: playerLeading ? colors.bonus : colors.text }]}>
          {playerTotalScore}
        </Text>
        <Text style={[styles.vsTotalsCpu, { color: cpuLeading ? colors.bonus : colors.text }]}>
          {cpuTotalScore}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1, paddingBottom: 8 },

  vsTableHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 2,
  },
  th: { fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  vsHeadYou: { width: 54, textAlign: "center", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  vsHeadCpu: { width: 54, textAlign: "center", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },

  vsTable: { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 2 },

  vsRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7, gap: 6 },
  vsRowLeft: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, gap: 8 },
  sectionDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  vsRowName: { fontSize: 13, fontWeight: "600", flexShrink: 1 },

  vsCell: {
    width: 54,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  vsCellText: { fontSize: 15, fontWeight: "700", textAlign: "center" },

  vsSubtotalRow: { borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 8 },
  vsSubtotalLbl: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  vsSubtotalCellText: { fontSize: 14, fontWeight: "700", textAlign: "center" },

  vsBarTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    marginLeft: 4,
    maxWidth: 110,
    overflow: "hidden",
    position: "relative",
  },
  vsBarFill: { position: "absolute", top: 0, left: 0, bottom: 0, borderRadius: 2 },
  vsBarFillCpu: { position: "absolute", bottom: 0, left: 0, height: 2, borderRadius: 2, opacity: 0.85 },

  vsBonusRow: { paddingVertical: 6, paddingBottom: 8, borderBottomWidth: 1 },
  vsBonusLbl: { fontSize: 11, fontWeight: "700", fontStyle: "italic" },

  vsSectionDivider: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.4,
    paddingTop: 10,
    paddingBottom: 4,
    textTransform: "uppercase",
  },

  vsTotalsRow: {
    flexDirection: "row",
    alignItems: "baseline",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  vsTotalsLbl: {
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  vsTotalsYou: { width: 54, textAlign: "center", fontSize: 22, fontWeight: "700" },
  vsTotalsCpu: { width: 54, textAlign: "center", fontSize: 22, fontWeight: "700" },
});
