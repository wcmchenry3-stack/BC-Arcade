import React from "react";
import { useTranslation } from "react-i18next";
import { ModalActions, ModalCard, ModalPrimaryButton } from "./ModalCard";

export interface PremiumLevelNoticeProps {
  visible: boolean;
  onClose: () => void;
  /** The OK button gets `${testID}-ok`. */
  testID?: string;
}

/**
 * Shown when the player taps a premium level (#1129): says the level is
 * part of BC Arcade Premium instead of starting it. Android back closes it.
 */
export function PremiumLevelNotice({ visible, onClose, testID }: PremiumLevelNoticeProps) {
  const { t } = useTranslation("common");
  return (
    <ModalCard
      visible={visible}
      onRequestClose={onClose}
      title={t("premiumLevel.title")}
      body={t("premiumLevel.body")}
      accentTop
      testID={testID}
    >
      <ModalActions>
        <ModalPrimaryButton
          label={t("premiumLevel.ok")}
          onPress={onClose}
          testID={testID ? `${testID}-ok` : undefined}
        />
      </ModalActions>
    </ModalCard>
  );
}
