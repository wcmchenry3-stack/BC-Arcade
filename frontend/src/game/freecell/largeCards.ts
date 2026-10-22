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

import { createRecord } from "../_shared/storageSlot";
import type { CardSizeContextValue } from "../_shared/CardSizeContext";

/**
 * Card width, in dp, with Large cards on. The fitted width is 36-52 dp (it
 * shrinks below the 52 dp natural size on phones narrower than ~430 dp), so
 * 64 dp is 1.23x a natural card and about 1.5x the fitted card on a 390-dp
 * phone: clearly bigger, yet a card is still under a fifth of the screen. The
 * board is then 8 x 64 + 7 x 2 = 526 dp wide, about 1.4 screens on a 390-dp phone.
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
 * The setting for a screen: `largeCards` (false until the stored choice is read),
 * `toggleLargeCards`, which stores the choice, and `shellLoading`: the screen's own
 * `loading` or the choice not read yet, so the board waits and a stored "on" never
 * flashes the fitted board first. A choice made before the read lands wins over the
 * stored value.
 */
export function useLargeCards(screenLoading: boolean) {
  const [largeCards, setLargeCards] = useState(false);
  const [largeCardsLoaded, setLargeCardsLoaded] = useState(false);
  const chosenRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void loadLargeCards().then((stored) => {
      if (!alive) return;
      if (!chosenRef.current) setLargeCards(stored);
      setLargeCardsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const toggleLargeCards = useCallback((value: boolean) => {
    chosenRef.current = true;
    setLargeCards(value);
    setLargeCardsLoaded(true);
    void saveLargeCards(value);
  }, []);
  return { largeCards, toggleLargeCards, shellLoading: screenLoading || !largeCardsLoaded };
}
