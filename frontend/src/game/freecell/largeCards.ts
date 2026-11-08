/**
 * FreeCell "Large cards" setting (#3347): bigger cards for players who find the
 * fitted board too small. Off by default, so the board is exactly as before.
 *
 * On: every card is `LARGE_CARD_WIDTH` wide whatever the screen, the 8-column
 * board no longer fits a phone, and FreeCellBoard scrolls it sideways
 * (docs/games/freecell.md, "Large cards"). The choice is one boolean in
 * AsyncStorage, written once per toggle: no network, no telemetry.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAppOverlayOpen } from "../../hooks/appOverlay";
import { createRecord } from "../_shared/storageSlot";
import type { CardSizeContextValue } from "../_shared/CardSizeContext";

/**
 * Card width, in dp, with Large cards on. FreeCell's natural card is 40 x 57 dp
 * (FreeCellSlot `CARD_WIDTH` / `CARD_HEIGHT`) and the fitted width is 36 to 40
 * dp: the 8 columns need 334 dp, so a 390 dp phone already shows the natural
 * size. 64 dp is 1.6x that: clearly bigger, yet a card is still under a fifth
 * of the screen. The board is then 8 x 64 + 7 x 2 = 526 dp wide, about 1.35
 * screens on a 390 dp phone.
 */
export const LARGE_CARD_WIDTH = 64;

/** The card size with Large cards on, keeping the card's natural aspect ratio. */
export function largeCardSize(naturalWidth: number, naturalHeight: number): CardSizeContextValue {
  return {
    cardWidth: LARGE_CARD_WIDTH,
    cardHeight: Math.round((naturalHeight * LARGE_CARD_WIDTH) / naturalWidth),
  };
}

export const { load: loadLargeCards, save: saveLargeCards } = createRecord<boolean>({
  key: "freecell_large_cards",
  subsystem: "freecell.storage",
  ops: { load: "loadLargeCards", save: "saveLargeCards" },
  fallback: () => false,
  read: (raw) => raw === "1",
  write: (value) => (value ? "1" : "0"),
});

/**
 * The setting for a screen.
 *
 * - `largeCards`: the player's choice (false until the stored choice is read). The
 *   ⋯ menu's checkbox shows it, so a tap is reflected at once.
 * - `boardLargeCards`: the size the board is drawn at. It follows `largeCards`, but
 *   only once no app overlay is open (`useAppOverlayOpen`: the ⋯ menu stays open
 *   after the toggle) and two frames have passed, so the menu's native Modal has been
 *   dismissed and the tap that closed it has been handled (#3556). Resizing the board
 *   re-renders every card and swaps the horizontal scroller in or out; on Android
 *   that big commit, made while the Modal's dialog window held the touch that flipped
 *   the setting, left the main thread blocked until Android killed the app for an ANR.
 *   The stored choice read at start is applied at once (no overlay is involved), so
 *   a stored "on" never flashes the fitted board first.
 * - `toggleLargeCards`: stores the choice (async, fire-and-forget).
 * - `shellLoading`: the screen's own `loading` or the choice not read yet, so the
 *   board waits. A choice made before the read lands wins over the stored value.
 */
export function useLargeCards(screenLoading: boolean) {
  const [largeCards, setLargeCards] = useState(false);
  const [boardLargeCards, setBoardLargeCards] = useState(false);
  const [largeCardsLoaded, setLargeCardsLoaded] = useState(false);
  const chosenRef = useRef(false);
  const overlayOpen = useAppOverlayOpen();
  useEffect(() => {
    let alive = true;
    void loadLargeCards().then((stored) => {
      if (!alive) return;
      if (!chosenRef.current) {
        setLargeCards(stored);
        setBoardLargeCards(stored);
      }
      setLargeCardsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (overlayOpen || boardLargeCards === largeCards) return;
    // Two frames is a best-effort handoff, not a guarantee: JS can't observe
    // the native Dialog's dismissal, so this only gives the commit that closes
    // the menu (and the tap that closed it) time to reach the UI thread first.
    let inner: number | undefined;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setBoardLargeCards(largeCards));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner !== undefined) cancelAnimationFrame(inner);
    };
  }, [overlayOpen, largeCards, boardLargeCards]);
  const toggleLargeCards = useCallback((value: boolean) => {
    chosenRef.current = true;
    setLargeCards(value);
    setLargeCardsLoaded(true);
    void saveLargeCards(value);
  }, []);
  return {
    largeCards,
    boardLargeCards,
    toggleLargeCards,
    shellLoading: screenLoading || !largeCardsLoaded,
  };
}
