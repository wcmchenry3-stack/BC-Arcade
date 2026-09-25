import React from "react";
import { useTranslation } from "react-i18next";
import { DifficultyPicker } from "../shared/DifficultyPicker";
import type { AiDifficulty } from "../../game/yacht/types";
import { AI_DIFFICULTIES } from "../../game/yacht/types";

interface Props {
  value: AiDifficulty;
  onChange: (d: AiDifficulty) => void;
}

export default function AiDifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("yacht");
  return (
    <DifficultyPicker
      gameKey="yacht"
      options={AI_DIFFICULTIES.map((d) => ({
        value: d,
        label: t(`difficulty.${d}`),
      }))}
      value={value}
      onChange={onChange}
      accessibilityLabel={t("difficulty.groupLabel")}
      testID="yacht-difficulty"
    />
  );
}
