import React from "react";
import { useTranslation } from "react-i18next";
import { DifficultyPicker } from "../shared/DifficultyPicker";
import type { Difficulty } from "../../game/sudoku/types";
import { DIFFICULTIES } from "../../game/sudoku/types";

interface Props {
  value: Difficulty;
  onChange: (d: Difficulty) => void;
}

export default function DifficultySelector({ value, onChange }: Props) {
  const { t } = useTranslation("sudoku");
  return (
    <DifficultyPicker
      gameKey="sudoku"
      options={DIFFICULTIES.map((d) => ({
        value: d,
        label: t(`difficulty.${d}`),
      }))}
      value={value}
      onChange={onChange}
      accessibilityLabel={t("difficulty.groupLabel")}
      testID="sudoku-difficulty"
    />
  );
}
