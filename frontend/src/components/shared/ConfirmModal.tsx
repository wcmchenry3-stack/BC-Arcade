import React from "react";
import { useTranslation } from "react-i18next";
import { ModalActions, ModalCard, ModalPrimaryButton, ModalSecondaryButton } from "./ModalCard";

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  /** Defaults to the common "Cancel". */
  cancelLabel?: string;
  /** Confirm fills with the theme error color. */
  destructive?: boolean;
  /**
   * Put the safe (cancel) action above the confirm action. Defaults to
   * `destructive`, so an irreversible action is never the first pill.
   */
  cancelFirst?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Buttons get `${testID}-confirm` and `${testID}-cancel`. */
  testID?: string;
}

/** Two-button confirm dialog on ModalCard (#2602). Android back cancels. */
export function ConfirmModal({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  cancelFirst = destructive,
  onConfirm,
  onCancel,
  testID,
}: ConfirmModalProps) {
  const { t } = useTranslation("common");

  const confirm = (
    <ModalPrimaryButton
      key="confirm"
      label={confirmLabel}
      onPress={onConfirm}
      tone={destructive ? "danger" : "accent"}
      testID={testID ? `${testID}-confirm` : undefined}
    />
  );
  const cancel = (
    <ModalSecondaryButton
      key="cancel"
      label={cancelLabel ?? t("newGame.confirm.cancel")}
      onPress={onCancel}
      testID={testID ? `${testID}-cancel` : undefined}
    />
  );

  return (
    <ModalCard
      visible={visible}
      onRequestClose={onCancel}
      title={title}
      body={body}
      accentTop
      testID={testID}
    >
      <ModalActions>{cancelFirst ? [cancel, confirm] : [confirm, cancel]}</ModalActions>
    </ModalCard>
  );
}
