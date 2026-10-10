import React from "react";
import { useTranslation } from "react-i18next";

import { DifficultyPicker } from "../shared/DifficultyPicker";
import type { Variant } from "../../game/sudoku/types";
import { VARIANTS } from "../../game/sudoku/types";

// ---------------------------------------------------------------------------
// Variant selector — Classic (9×9) vs Mini (6×6)
// ---------------------------------------------------------------------------

export default function VariantSelector({
  value,
  onChange,
}: {
  readonly value: Variant;
  readonly onChange: (v: Variant) => void;
}) {
  const { t } = useTranslation("sudoku");

  return (
    <DifficultyPicker
      // No variant is a premium level: this key has none listed.
      gameKey="sudoku-variant"
      options={VARIANTS.map((v) => ({
        value: v,
        label: t(`variant.${v}`, {
          defaultValue: v === "classic" ? "Classic 9×9" : "Mini 6×6",
        }),
      }))}
      value={value}
      onChange={onChange}
      accessibilityLabel={t("variant.groupLabel", { defaultValue: "Variant" })}
      testID="sudoku-variant"
    />
  );
}
