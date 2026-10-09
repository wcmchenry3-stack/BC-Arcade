import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { useIsScreenFocused } from "../../hooks/useIsScreenFocused";
import { ResultCard, useResultTitle } from "./ResultCard";
import {
  formatValue,
  type GameOutcome,
  type GameResultModalProps,
  type ResultHero,
} from "./resultTypes";

/**
 * The one end-of-game result card every game uses (#2504, epic #2500).
 *
 * Games never build their own result screen: they pass data, and each slot
 * (stats, detail, submission line, second button) appears only when given.
 * Title text, colours, haptics, the scrim, Android back and the screen-reader
 * announcement are fixed here so every game ends the same way. The card's
 * parts live beside this file (#2990): `ResultCard`, `SubmissionLine`,
 * `resultButtons`, `resultTypes`.
 */

/** Safety net so a celebration that never calls `done` can't hide the card. */
export const CELEBRATION_MAX_MS = 4000;

/** Best-effort: a haptic that fails (sync or async) must never break the card. */
function fireHaptic(outcome: GameOutcome) {
  try {
    const run =
      outcome === "win"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : outcome === "loss"
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
          : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    run?.catch(() => undefined);
  } catch {
    // No haptics available (or a partial module): the card still shows.
  }
}

/**
 * The outcome haptic and screen-reader announcement, once each time `active`
 * turns on. `GameResultModal` runs it when its card appears; a screen that
 * renders a `ResultCard` inline (Blackjack's Goal Reached) runs it on mount.
 */
export function useResultFeedback({
  active,
  outcome,
  winnerName,
  subtitle,
  hero,
}: {
  active: boolean;
  outcome: GameOutcome;
  winnerName?: string;
  subtitle?: string;
  hero?: ResultHero;
}) {
  const { t } = useTranslation("result");
  const title = useResultTitle(outcome, winnerName);
  const heroA11y =
    hero?.kind === "score"
      ? t("a11y.heroScore", { label: hero.label, value: formatValue(t, hero.value) })
      : hero?.kind === "versus"
        ? t("a11y.heroVs", {
            you: formatValue(t, hero.you),
            opponent: hero.opponentLabel,
            opponentScore: formatValue(t, hero.opponent),
          })
        : "";

  const announcedRef = useRef(false);
  useEffect(() => {
    if (!active) {
      announcedRef.current = false;
      return;
    }
    if (announcedRef.current) return;
    announcedRef.current = true;
    fireHaptic(outcome);
    const detailText = [subtitle, heroA11y].filter(Boolean).join(". ");
    AccessibilityInfo.announceForAccessibility(
      detailText ? t("a11y.announce", { title, detail: detailText }) : title
    );
  }, [active, outcome, subtitle, heroA11y, title, t]);
}

/** The one end-of-game result card every game uses, in a modal. */
export default function GameResultModal({
  visible,
  celebration,
  onHome,
  testID = "game-result",
  ...card
}: GameResultModalProps) {
  const { colors } = useTheme();

  // "celebrating" → the celebration plays in the screen, card hidden;
  // "card" → the Modal is shown. The card only mounts after the celebration
  // so a native Modal never covers the animation.
  const [phase, setPhase] = useState<"hidden" | "celebrating" | "card">("hidden");
  useEffect(() => {
    if (!visible) {
      setPhase("hidden");
      return;
    }
    setPhase(celebration ? "celebrating" : "card");
    // Only re-run when visibility flips; a new `celebration` closure each
    // render must not restart the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (phase !== "celebrating") return;
    const timer = setTimeout(() => setPhase("card"), CELEBRATION_MAX_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // Announce + haptic once per appearance of the card.
  useResultFeedback({
    active: phase === "card",
    outcome: card.outcome,
    winnerName: card.winnerName,
    subtitle: card.subtitle,
    hero: card.hero,
  });

  // A native Modal is its own window: hide it while a screen pushed from the
  // card (the leaderboard, #2633) covers the game, and show it again, without
  // a second announcement, when the player comes back.
  const screenFocused = useIsScreenFocused();

  return (
    <>
      {phase === "celebrating" && celebration?.(() => setPhase("card"))}
      <Modal
        visible={phase === "card" && screenFocused}
        transparent
        animationType="fade"
        statusBarTranslucent
        accessibilityViewIsModal
        onRequestClose={onHome}
      >
        <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <ResultCard {...card} onHome={onHome} testID={testID} />
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
});
