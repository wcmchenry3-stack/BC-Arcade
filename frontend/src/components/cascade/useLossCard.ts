/**
 * #3701 (owner pick C): at a loss the pile dims and the lid flashes on the board first, and the
 * result card comes `MOTION.gameOver.cardAtMs` (1 s) after the game over. Reduce Motion keeps the
 * same time (its board shows a fade and a steady red lid instead), so switching it mid-way can
 * neither hold the card back nor skip the sequence. A win shows the card at once: its own
 * celebration (#3699) holds the card back.
 *
 * A JS timer, not a frame: the card must come even if the board never draws again.
 */
import { useEffect, useState } from "react";
import { MOTION } from "../../game/cascade/motion";

export function useLossCard(gameOver: boolean, won: boolean, gameKey: number): boolean {
  // The game whose card is due (a new game's key never matches an old timer's).
  const [dueFor, setDueFor] = useState<number | null>(null);
  useEffect(() => {
    if (!gameOver || won) return;
    const timer = setTimeout(() => setDueFor(gameKey), MOTION.gameOver.cardAtMs);
    return () => clearTimeout(timer);
  }, [gameOver, won, gameKey]);
  return gameOver && (won || dueFor === gameKey);
}
