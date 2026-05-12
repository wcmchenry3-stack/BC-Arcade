import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";
import ScoreRow from "./ScoreRow";
import { useTheme } from "../theme/ThemeContext";

const UPPER_CATEGORY_KEYS = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;
const LOWER_CATEGORY_KEYS = [
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

// 600dp catches tablets, Galaxy Fold unfolded (both orientations), and other wide-aspect
// devices. On wide screens both sections render side-by-side without tabs.
const WIDE_BREAKPOINT = 600;

interface ScorecardProps {
  scores: Record<string, number | null>;
  possibleScores: Record<string, number>;
  rollsUsed: number;
  gameOver: boolean;
  upperSubtotal: number;
  upperBonus: number;
  yachtBonusCount: number;
  yachtBonusTotal: number;
  totalScore: number;
  onScore: (category: string) => void;
}

type ActiveTab = "upper" | "lower";

function pairs<T>(arr: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += 2) {
    result.push(arr.slice(i, i + 2) as T[]);
  }
  return result;
}

export default function Scorecard({
  scores,
  possibleScores,
  rollsUsed,
  gameOver,
  upperSubtotal,
  upperBonus,
  yachtBonusCount,
  yachtBonusTotal,
  totalScore,
  onScore,
}: ScorecardProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<ActiveTab>("upper");
  const canScore = rollsUsed > 0 && !gameOver;
  const isWide = width >= WIDE_BREAKPOINT;

  function renderScoreRow(categoryKey: string, tone: "upper" | "lower") {
    return (
      <ScoreRow
        category={categoryKey}
        tone={tone}
        label={t(CATEGORY_I18N_KEY[categoryKey] ?? "")}
        score={scores[categoryKey] ?? null}
        potential={possibleScores[categoryKey]}
        canScore={canScore}
        onSelect={() => onScore(categoryKey)}
        compact
      />
    );
  }

  const upperPairs = pairs(UPPER_CATEGORY_KEYS);
  const lowerPairs = pairs(LOWER_CATEGORY_KEYS);

  function renderUpperContent() {
    return (
      <>
        <View style={styles.badgeRow}>
          <View
            style={[styles.badge, { backgroundColor: colors.surface, borderColor: colors.accent }]}
          >
            <Text style={[styles.badgeText, { color: colors.accent }]}>{t("bonus.badge")}</Text>
          </View>
        </View>
        {upperPairs.map((pair, i) => (
          <View key={i} style={styles.twoColRow}>
            <View style={styles.cell}>{renderScoreRow(pair[0]!, "upper")}</View>
            <View style={styles.cell}>
              {pair[1] != null ? renderScoreRow(pair[1], "upper") : null}
            </View>
          </View>
        ))}
        <View style={[styles.bonusRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.bonusLabel, { color: colors.textMuted }]}>{t("bonus.label")}</Text>
          <Text
            style={[styles.bonusValue, { color: upperBonus > 0 ? colors.bonus : colors.textMuted }]}
          >
            {upperBonus > 0
              ? t("bonus.achieved", { subtotal: upperSubtotal })
              : t("bonus.progress", { subtotal: upperSubtotal })}
          </Text>
        </View>
      </>
    );
  }

  function renderLowerContent() {
    return (
      <>
        {lowerPairs.map((pair, i) => (
          <View key={i} style={styles.twoColRow}>
            <View style={styles.cell}>{renderScoreRow(pair[0]!, "lower")}</View>
            <View style={styles.cell}>
              {pair[1] != null ? renderScoreRow(pair[1], "lower") : null}
            </View>
          </View>
        ))}
        {yachtBonusCount > 0 && (
          <View style={[styles.bonusRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.bonusLabel, { color: colors.textMuted }]}>
              {t("bonus.yachtLabel")}
            </Text>
            <Text style={[styles.bonusValue, { color: colors.bonus }]}>
              {t("bonus.yachtValue", { count: yachtBonusCount, total: yachtBonusTotal })}
            </Text>
          </View>
        )}
      </>
    );
  }

  function renderBento(section: "upper" | "lower") {
    const sectionColor = section === "upper" ? colors.accent : colors.secondary;
    return (
      <View
        style={[
          styles.bento,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
            borderTopColor: sectionColor,
          },
        ]}
      >
        {section === "upper" ? renderUpperContent() : renderLowerContent()}
      </View>
    );
  }

  return (
    <ScrollView
      // focusable on web satisfies axe's scrollable-region-focusable rule (#454)
      focusable={Platform.OS === "web"}
      style={styles.container}
      contentContainerStyle={styles.content}
    >
      {isWide ? (
        <View style={styles.gridWide}>
          <View style={styles.col}>{renderBento("upper")}</View>
          <View style={styles.col}>{renderBento("lower")}</View>
        </View>
      ) : (
        <>
          <View
            style={[styles.tabBar, { borderBottomColor: colors.border }]}
            accessibilityRole="tablist"
          >
            {(["upper", "lower"] as const).map((tab) => {
              const isActive = activeTab === tab;
              const tabColor = tab === "upper" ? colors.accent : colors.secondary;
              return (
                <Pressable
                  key={tab}
                  style={[styles.tab, { borderBottomColor: isActive ? tabColor : "transparent" }]}
                  onPress={() => setActiveTab(tab)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={t(tab === "upper" ? "tab.upper" : "tab.lower")}
                >
                  <Text
                    style={[styles.tabLabel, { color: isActive ? tabColor : colors.textMuted }]}
                  >
                    {t(tab === "upper" ? "tab.upper" : "tab.lower")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {renderBento(activeTab)}
        </>
      )}

      <View
        style={[
          styles.totalRow,
          { backgroundColor: colors.surfaceHigh, borderColor: colors.accent },
        ]}
      >
        <Text style={[styles.totalLabel, { color: colors.textMuted }]}>{t("section.total")}</Text>
        <Text style={[styles.totalValue, { color: colors.accent }]}>{totalScore}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  gridWide: {
    flexDirection: "row",
    gap: 12,
  },
  col: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    borderBottomWidth: 2,
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  bento: {
    borderRadius: 14,
    borderWidth: 1,
    borderTopWidth: 2,
    padding: 10,
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  twoColRow: {
    flexDirection: "row",
    gap: 6,
  },
  cell: {
    flex: 1,
  },
  bonusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    paddingHorizontal: 4,
    marginTop: 2,
    borderTopWidth: 1,
  },
  bonusLabel: {
    fontSize: 12,
    fontStyle: "italic",
  },
  bonusValue: {
    fontSize: 12,
    fontWeight: "700",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  totalValue: {
    fontSize: 22,
    fontWeight: "900",
  },
});
