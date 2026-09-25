import React from "react";
import { useTranslation } from "react-i18next";
import { DifficultyPicker } from "../shared/DifficultyPicker";
import { isPremiumLevel } from "../../entitlements/premiumLevels";
import type { AiPreset } from "../../game/hearts/types";
import { AI_PRESETS } from "../../game/hearts/types";

interface Props {
  value: AiPreset;
  onChange: (d: AiPreset) => void;
}

/** The three personas share a row; the Mixed Table takes the row below. */
export default function HeartsAiDifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("hearts");
  return (
    <DifficultyPicker
      options={AI_PRESETS.map((preset) => ({
        value: preset,
        label: t(`difficulty.${preset}`),
        description: t(`difficulty.${preset}.desc`),
        locked: isPremiumLevel("hearts", preset),
        fullWidth: preset === "mixed",
      }))}
      value={value}
      onChange={onChange}
      accessibilityLabel={t("difficulty.groupLabel")}
      testID="hearts-difficulty"
    />
  );
}
