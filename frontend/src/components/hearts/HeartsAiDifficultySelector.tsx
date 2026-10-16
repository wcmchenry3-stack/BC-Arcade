import React from "react";
import { useTranslation } from "react-i18next";
import { DifficultyPicker } from "../shared/DifficultyPicker";
import type { AiPreset } from "../../game/hearts/types";
import { AI_PRESETS } from "../../game/hearts/types";

interface Props {
  value: AiPreset;
  onChange: (d: AiPreset) => void;
}

/**
 * Dev / pre-launch builds only (#3158): Conservative takes the first row, the
 * three legacy personas share the next, the Mixed Table takes the last.
 */
export default function HeartsAiDifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("hearts");
  return (
    <DifficultyPicker
      gameKey="hearts"
      options={AI_PRESETS.map((preset) => ({
        value: preset,
        label: t(`difficulty.${preset}`),
        description: t(`difficulty.${preset}.desc`),
        fullWidth: preset === "mixed" || preset === "conservative",
      }))}
      value={value}
      onChange={onChange}
      accessibilityLabel={t("difficulty.groupLabel")}
      testID="hearts-difficulty"
    />
  );
}
