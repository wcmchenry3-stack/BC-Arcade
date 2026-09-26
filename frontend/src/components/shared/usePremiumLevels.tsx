import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { isPremiumLevel } from "../../entitlements/premiumLevels";
import { PremiumLevelNotice } from "./PremiumLevelNotice";

/** Opacity of a premium level's option, row or card. */
export const PREMIUM_LEVEL_OPACITY = 0.6;

/**
 * Everything a level picker needs to show a game's premium levels (#1129):
 * whether a level is locked, how it reads, and the "part of BC Arcade
 * Premium" notice to open when one is tapped. Render `notice` once.
 *
 * DifficultyPicker, the Star Swarm tier picker and the Blackjack table cards
 * all go through this, so a change to how premium levels look or unlock is
 * made here.
 */
export function usePremiumLevels(gameKey: string, testID?: string) {
  const { t } = useTranslation("common");
  const [noticeVisible, setNoticeVisible] = useState(false);

  const isLocked = useCallback((level: string) => isPremiumLevel(gameKey, level), [gameKey]);
  /** Visible text: the label behind a lock. */
  const lockedText = useCallback((label: string) => `🔒 ${label}`, []);
  /** Screen-reader label for a locked option named `label`. */
  const lockedLabel = useCallback(
    (label: string) => t("premiumLevel.lockedLabel", { level: label }),
    [t]
  );
  const explain = useCallback(() => setNoticeVisible(true), []);

  const notice = (
    <PremiumLevelNotice
      visible={noticeVisible}
      onClose={() => setNoticeVisible(false)}
      testID={testID}
    />
  );

  return { isLocked, lockedText, lockedLabel, explain, notice };
}
