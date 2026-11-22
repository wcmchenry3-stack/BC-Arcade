import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { useTransientToast } from "../shared/useTransientToast";
import { suggestHint, type YachtHint } from "../../game/yacht/hint";
import { CATEGORY_I18N_KEY } from "../../game/yacht/categories";
import { possibleScores } from "../../game/yacht/engine";
import { preloadOracleTable } from "../../game/yacht/oracle/oracle";
import type { GameState } from "../../game/yacht/types";

/** How long (ms) a hint, or the "no hint" message, stays up: the same 2 s as the other games. */
const HINT_MS = 2000;

interface Options {
  /** The Hint exists only in a solo game: a game against the computer is not made easier. */
  readonly available: boolean;
  readonly gameState: GameState;
  /** Off while the computer plays, while the dice roll and once the game is over. */
  readonly disabled: boolean;
}

/**
 * The solo Hint (#3748): the suggestion for the dice on the table, up for 2 s; with nothing to
 * suggest (before the first roll), a 2 s "no hint" message, as in 2048 and Mahjong
 * (`useTransientToast`). A hint changes no state of the game and is not recorded.
 */
export function useYachtHint({ available, gameState, disabled }: Options) {
  const { t } = useTranslation("yacht");
  const [hint, setHint] = useState<YachtHint | null>(null);
  // Warm the oracle once the first roll is down (solo only: a VS game warms it for the computer,
  // and a player who never rolls never needs it). The decode (hundreds of ms on a phone) is
  // scheduled on a timer, after this render and off any press, so the first Hint is instant. It
  // waits for the dice to land (`disabled` is set while they tumble, #3749): the decode blocks the
  // JS thread, and must not stall the tumble or hold the input lock past it.
  const warmedRef = useRef(false);
  const rolled = gameState.rolls_used >= 1;
  useEffect(() => {
    if (!available || !rolled || disabled || warmedRef.current) return;
    warmedRef.current = true;
    preloadOracleTable().catch((e: unknown) => Sentry.captureException(e));
  }, [available, rolled, disabled]);
  const { visible: hintVisible, show: showHint, hide: hideHint } = useTransientToast(HINT_MS);
  const { visible: noHintVisible, show: showNoHint, hide: hideNoHint } = useTransientToast(HINT_MS);

  /** Drop whatever is showing: a roll, a hold or a score makes it stale. */
  const clearHint = useCallback(() => {
    hideHint();
    hideNoHint();
  }, [hideHint, hideNoHint]);

  const textOf = useCallback(
    (h: YachtHint): string => {
      if (h.kind === "score") {
        return t("hint.score", { category: t(CATEGORY_I18N_KEY[h.category] ?? "") });
      }
      return h.held.some(Boolean) ? t("hint.hold") : t("hint.holdNone");
    },
    [t]
  );

  /** What a screen reader hears: names the dice to keep, or the row and its points. */
  const spokenOf = useCallback(
    (h: YachtHint): string => {
      if (h.kind === "score") {
        return t("hint.scoreFor", {
          category: t(CATEGORY_I18N_KEY[h.category] ?? ""),
          points: possibleScores(gameState)[h.category] ?? 0,
        });
      }
      const kept = gameState.dice.filter((_, i) => h.held[i]);
      if (kept.length === 0) return t("hint.holdNone");
      // "4, 4, 4 and 6": the list's separator and its "and" are the language's own.
      const dice =
        kept.length === 1
          ? String(kept[0])
          : t("hint.listAnd", {
              head: kept.slice(0, -1).join(t("hint.listSep")),
              last: kept[kept.length - 1],
            });
      return t("hint.holdDice", { dice });
    },
    [t, gameState]
  );

  const onHint = useCallback(() => {
    if (disabled || !available) return;
    let suggestion: YachtHint | null = null;
    try {
      suggestion = suggestHint(gameState);
    } catch (e: unknown) {
      // The oracle failing is no reason to stop the game: say there is no hint.
      Sentry.captureException(e);
    }
    if (suggestion === null) {
      hideHint();
      setHint(null);
      showNoHint();
      AccessibilityInfo.announceForAccessibility(t("hint.none"));
      return;
    }
    hideNoHint();
    setHint(suggestion);
    showHint();
    AccessibilityInfo.announceForAccessibility(spokenOf(suggestion));
  }, [disabled, available, gameState, hideHint, hideNoHint, showHint, showNoHint, t, spokenOf]);

  /** The suggestion while it is up (and still meaningful: not on the computer's turn). */
  const active = hintVisible && available && !disabled ? hint : null;
  const message = noHintVisible
    ? { text: t("hint.none"), none: true }
    : active
      ? { text: textOf(active), none: false }
      : null;

  return { onHint, clearHint, active, message };
}
