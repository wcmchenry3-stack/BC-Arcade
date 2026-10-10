import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import {
  ModalActions,
  ModalCard,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from "../shared/ModalCard";
import DifficultySelector from "./DifficultySelector";
import VariantSelector from "./VariantSelector";
import type { Difficulty, Variant } from "../../game/sudoku/types";

// ---------------------------------------------------------------------------
// New Game modal — settings selection after abandon confirmation
// ---------------------------------------------------------------------------

export default function NewGameModal({
  currentDifficulty,
  currentVariant,
  onQuickRestart,
  onStart,
}: {
  readonly currentDifficulty: Difficulty;
  readonly currentVariant: Variant;
  readonly onQuickRestart: () => void;
  readonly onStart: (d: Difficulty, v: Variant) => void;
}) {
  const { t } = useTranslation("sudoku");
  const [pendingDifficulty, setPendingDifficulty] = useState(currentDifficulty);
  const [pendingVariant, setPendingVariant] = useState(currentVariant);

  return (
    <ModalCard visible title={t("newGame.title")}>
      <View style={styles.newGameSelector}>
        <VariantSelector value={pendingVariant} onChange={setPendingVariant} />
      </View>
      <View style={[styles.newGameSelector, { marginTop: 8 }]}>
        <DifficultySelector value={pendingDifficulty} onChange={setPendingDifficulty} />
      </View>
      <ModalActions style={styles.newGameActions}>
        <ModalPrimaryButton
          label={t("action.start")}
          onPress={() => onStart(pendingDifficulty, pendingVariant)}
        />
        <ModalSecondaryButton
          tone="accent"
          label={t("action.quickRestart")}
          onPress={onQuickRestart}
        />
      </ModalActions>
    </ModalCard>
  );
}

const styles = StyleSheet.create({
  newGameSelector: {
    alignSelf: "stretch",
    marginBottom: 4,
  },
  newGameActions: {
    marginTop: 14,
  },
});
