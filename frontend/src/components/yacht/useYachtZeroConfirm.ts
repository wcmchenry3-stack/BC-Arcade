/**
 * Zero confirm (#4092): a zero takes two taps. The first tap on an open row whose points would be 0
 * only arms it (the table shows it, `ScoreTable`'s `armedCategory`); the second tap on the same row
 * scores it. UI state only: not in the engine or the saved game, gone on a relaunch.
 *
 * An arm belongs to the game state it was made on: any roll, hold, score or new game makes a new
 * state, so the arm is gone with no step to remember (Hint changes no state, so the
 * wrapped `onHint` clears it). The computer's turn never shows one.
 */
import { useCallback, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useTranslation } from "react-i18next";
import { CATEGORY_I18N_KEY } from "../../game/yacht/categories";
import type { GameState } from "../../game/yacht/types";

export function useYachtZeroConfirm({
  gameState,
  possibleScores,
  isAiTurn,
  onHint,
}: {
  gameState: GameState;
  possibleScores: Record<string, number>;
  isAiTurn: boolean;
  /** The screen's Hint press: wrapped here, since a Hint changes no game state. */
  onHint: () => void;
}) {
  const { t } = useTranslation("yacht");
  const [armed, setArmed] = useState<{ category: string; on: GameState } | null>(null);
  const armedCategory = !isAiTurn && armed?.on === gameState ? armed.category : null;

  const hint = useCallback(() => {
    setArmed(null);
    onHint();
  }, [onHint]);

  /**
   * A tap on `category`: true when it only armed the row (the caller stops there), false when the
   * tap should score. Another zero row moves the arm.
   */
  const armOrConfirm = useCallback(
    (category: string): boolean => {
      if (
        gameState.rolls_used > 0 &&
        possibleScores[category] === 0 &&
        armedCategory !== category
      ) {
        setArmed({ category, on: gameState });
        AccessibilityInfo.announceForAccessibility(
          t("score.label", {
            category: t(CATEGORY_I18N_KEY[category] ?? ""),
            state: t("score.armed"),
          })
        );
        return true;
      }
      setArmed(null);
      return false;
    },
    [armedCategory, gameState, possibleScores, t]
  );

  return { armedCategory, armOrConfirm, onHint: hint };
}
