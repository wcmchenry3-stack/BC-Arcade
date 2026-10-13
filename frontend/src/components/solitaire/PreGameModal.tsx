import React from "react";
import { useTranslation } from "react-i18next";

import {
  ModalActions,
  ModalCard,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from "../shared/ModalCard";
import type { DrawMode } from "../../game/solitaire/types";

// ---------------------------------------------------------------------------
// Pre-game draw-mode modal
// ---------------------------------------------------------------------------

export default function PreGameModal({
  onChoose,
}: {
  readonly onChoose: (mode: DrawMode) => void;
}) {
  const { t } = useTranslation("solitaire");

  return (
    <ModalCard visible title={t("drawMode.title")} body={t("drawMode.body")}>
      <ModalActions>
        <ModalPrimaryButton
          testID="solitaire-draw-1"
          label={t("drawMode.one")}
          onPress={() => onChoose(1)}
        />
        <ModalSecondaryButton
          testID="solitaire-draw-3"
          tone="accent"
          label={t("drawMode.three")}
          onPress={() => onChoose(3)}
        />
      </ModalActions>
    </ModalCard>
  );
}
