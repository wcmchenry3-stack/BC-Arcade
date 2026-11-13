/**
 * Mahjong's bottom action bar (#3614): Undo, Hint and Shuffle within thumb reach, above the tab
 * bar. Each is an icon over a short label, at least 44 x 44 pt; Shuffle carries a badge with the
 * shuffles left. The labels, accessibility labels and test ids are the ones the header pills had,
 * so screen readers and the e2e helpers find the same controls. The bar itself is the shared
 * `GameActionBar` (#3688), which 2048's Hint button uses too.
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { MAHJONG_SHUFFLE_COLOR } from "../../theme/theme.mahjong";
import GameActionBar from "../shared/GameActionBar";
import { MAHJONG_ACTION_BAR_H } from "../../game/mahjong/layout";

export interface MahjongActionBarProps {
  readonly undoDisabled: boolean;
  readonly hintDisabled: boolean;
  readonly shuffleDisabled: boolean;
  readonly shufflesLeft: number;
  readonly onUndo: () => void;
  readonly onHint: () => void;
  readonly onShuffle: () => void;
}

export default function MahjongActionBar({
  undoDisabled,
  hintDisabled,
  shuffleDisabled,
  shufflesLeft,
  onUndo,
  onHint,
  onShuffle,
}: MahjongActionBarProps) {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();
  return (
    <GameActionBar
      testID="mahjong-action-bar"
      height={MAHJONG_ACTION_BAR_H}
      actions={[
        {
          key: "undo",
          icon: "undo",
          label: t("action.undo"),
          accessibilityLabel: t("action.undoLabel"),
          color: colors.accentText,
          disabled: undoDisabled,
          onPress: onUndo,
          testID: "mahjong-undo-button",
        },
        {
          key: "hint",
          icon: "lightbulb",
          label: t("action.hint"),
          accessibilityLabel: t("action.hintLabel"),
          color: colors.bonus,
          labelColor: colors.bonusText,
          disabled: hintDisabled,
          onPress: onHint,
          testID: "mahjong-hint-button",
        },
        {
          key: "shuffle",
          icon: "shuffle",
          label: t("action.shuffle"),
          accessibilityLabel: t("action.shuffleLabel"),
          accessibilityValue: t("hud.shufflesLeft", { count: shufflesLeft }),
          color: MAHJONG_SHUFFLE_COLOR,
          disabled: shuffleDisabled,
          onPress: onShuffle,
          testID: "mahjong-shuffle-button",
          badge: shufflesLeft,
        },
      ]}
    />
  );
}
