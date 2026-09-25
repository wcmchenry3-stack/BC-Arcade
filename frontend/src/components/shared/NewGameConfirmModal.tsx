import React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "./ConfirmModal";

interface Props {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Override the default "Start new game?" title. */
  title?: string;
  /** Override the default body copy about losing progress. */
  body?: string;
}

/** "Start new game?" confirm. A ConfirmModal with the common new-game copy. */
export default function NewGameConfirmModal({ visible, onConfirm, onCancel, title, body }: Props) {
  const { t } = useTranslation("common");
  return (
    <ConfirmModal
      visible={visible}
      title={title ?? t("newGame.confirm.title")}
      body={body ?? t("newGame.confirm.body")}
      confirmLabel={t("newGame.confirm.confirm")}
      cancelLabel={t("newGame.confirm.cancel")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
