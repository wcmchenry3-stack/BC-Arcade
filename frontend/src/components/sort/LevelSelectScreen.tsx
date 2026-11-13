import React from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { LockableGrid } from "../shared/LockableGrid";
import { CHAPTER_SIZE, type LevelData } from "../../game/sort/catalog";
import type { BestMoves, SortProgress } from "../../game/sort/storage";
import { bestStarsFor } from "../../game/sort/stars";
import { StarRow } from "./StarRow";

const COLS = 4;

/** A level to show; `par` is the catalog's target, which the stars are judged against. */
type GridLevel = LevelData & { readonly par?: number };

interface Props {
  readonly levels: readonly GridLevel[];
  readonly progress: SortProgress;
  /** The player's best moves per level; each solved level's best stars derive from them (#3687). */
  readonly bestMoves?: BestMoves;
  readonly onSelectLevel: (id: number) => void;
  readonly onContinue: () => void;
}

const NO_BESTS: BestMoves = {};

export default function LevelSelectScreen({
  levels,
  progress,
  bestMoves = NO_BESTS,
  onSelectLevel,
  onContinue,
}: Props) {
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
      sectionSize={CHAPTER_SIZE}
      sectionTitleOf={(index) => t("levelSelect.chapter", { chapter: index + 1 })}
      sectionTestIDOf={(index) => `sort-chapter-${index + 1}`}
      // Open on the furthest unlocked level: a save moved onto the catalog
      // can start far down the grid (#2761).
      initialScrollIndex={Math.min(progress.unlockedLevel, levels.length) - 1}
      gap={8}
      keyOf={(level) => level.id}
      isUnlocked={(level) => level.id <= progress.unlockedLevel}
      onSelect={(level) => onSelectLevel(level.id)}
      testIDOf={(level) => `sort-level-${level.id}`}
      accessibilityLabelOf={(level, unlocked) => {
        if (!unlocked) return t("levelSelect.lockedLevel", { level: level.id });
        const stars = bestStarsFor(bestMoves, level.id, level.par);
        return stars > 0
          ? t("levelSelect.levelStars", { level: level.id, stars })
          : t("hud.level", { level: level.id });
      }}
      cardStyle={styles.card}
      lockStyle={styles.lockIcon}
      renderContent={(level, unlocked) => (
        <>
          <Text style={[styles.levelNum, { color: unlocked ? colors.text : colors.textMuted }]}>
            {level.id}
          </Text>
          {/* An unlocked level not solved yet shows three empty outlines: the
              goal is visible, and the tile keeps its height. Locked tiles show none. */}
          {unlocked ? (
            <StarRow
              stars={bestStarsFor(bestMoves, level.id, level.par)}
              size={14}
              testID={`sort-level-${level.id}-stars`}
            />
          ) : null}
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    aspectRatio: 1,
    // At least 44 pt each way even on a narrow screen (#3687).
    minHeight: 44,
    minWidth: 44,
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
