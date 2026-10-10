import React from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { LockableGrid } from "../shared/LockableGrid";
import type { LayoutMeta } from "../../game/mahjong/types";
import type { MahjongProgress } from "../../game/mahjong/storage";

const COLS = 2;

interface Props {
  readonly layouts: LayoutMeta[];
  readonly progress: MahjongProgress;
  readonly hasContinue: boolean;
  readonly onSelectLayout: (id: string) => void;
  readonly onContinue: () => void;
}

export default function LayoutSelectScreen({
  layouts,
  progress,
  hasContinue,
  onSelectLayout,
  onContinue,
}: Props) {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();

  return (
    <LockableGrid
      title={t("layoutSelect.title")}
      titleAccessibilityRole="header"
      continueLabel={hasContinue ? t("layoutSelect.continue") : undefined}
      onContinue={onContinue}
      items={layouts}
      columns={COLS}
      gap={12}
      keyOf={(layout) => layout.id}
      isUnlocked={(layout) => progress.unlockedLayouts.includes(layout.id)}
      onSelect={(layout) => onSelectLayout(layout.id)}
      testIDOf={(layout) => `mahjong-layout-${layout.id}`}
      accessibilityLabelOf={(layout, unlocked) =>
        unlocked
          ? t(`layout.${layout.id}`)
          : t("layoutSelect.lockedLayout", { name: t(`layout.${layout.id}`) })
      }
      cardStyle={styles.card}
      lockStyle={styles.lockIcon}
      renderContent={(layout, unlocked) => (
        <>
          <Text style={[styles.layoutName, { color: unlocked ? colors.text : colors.textMuted }]}>
            {t(`layout.${layout.id}`)}
          </Text>
          <Text style={[styles.tierBadge, { color: unlocked ? colors.accent : colors.textMuted }]}>
            T{layout.tier}
          </Text>
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 1.4,
    gap: 4,
    padding: 12,
  },
  layoutName: {
    fontFamily: typography.heading,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  tierBadge: {
    fontFamily: typography.label,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  lockIcon: {
    fontSize: 14,
    marginTop: 2,
  },
});
