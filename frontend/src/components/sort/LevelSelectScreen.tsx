import React from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { LockableGrid } from "../shared/LockableGrid";
import type { LevelData } from "../../game/sort/api";
import type { SortProgress } from "../../game/sort/storage";

const COLS = 4;

interface Props {
  readonly levels: LevelData[];
  readonly progress: SortProgress;
  readonly onSelectLevel: (id: number) => void;
  readonly onContinue: () => void;
}

export default function LevelSelectScreen({ levels, progress, onSelectLevel, onContinue }: Props) {
  const { t } = useTranslation("sort");
  const { colors } = useTheme();

  const hasContinue = progress.currentLevelId !== null && progress.currentState !== null;

  return (
    <LockableGrid
      title={t("levelSelect.title")}
      continueLabel={
        hasContinue ? t("levelSelect.continue", { level: progress.currentLevelId }) : undefined
      }
      onContinue={onContinue}
      items={levels}
      columns={COLS}
      gap={8}
      keyOf={(level) => level.id}
      isUnlocked={(level) => level.id <= progress.unlockedLevel}
      onSelect={(level) => onSelectLevel(level.id)}
      testIDOf={(level) => `sort-level-${level.id}`}
      accessibilityLabelOf={(level, unlocked) =>
        unlocked
          ? t("hud.level", { level: level.id })
          : t("levelSelect.lockedLevel", { level: level.id })
      }
      cardStyle={styles.card}
      lockStyle={styles.lockIcon}
      renderContent={(level, unlocked) => (
        <Text style={[styles.levelNum, { color: unlocked ? colors.text : colors.textMuted }]}>
          {level.id}
        </Text>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 1,
    gap: 2,
  },
  levelNum: {
    fontFamily: typography.heading,
    fontSize: 18,
    fontWeight: "700",
  },
  lockIcon: {
    fontSize: 12,
  },
});
