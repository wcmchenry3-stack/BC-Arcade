/**
 * Blackjack's sounds, one per moment of the motion (#3581, the approved table on the issue): the
 * deal, the hole card's flip, a chip into the circle, the result's chime and the chips after it.
 * The motion (useBlackjackMotion) says when; this plays the sound, and hands the result's own
 * effect (a flash, the celebration) to the screen. A result the player cut short (`skipped`)
 * still sounds, once, with no effect over the next hand.
 */
import { useCallback, useLayoutEffect, useRef } from "react";

import { useSound } from "../../game/_shared/useSound";
import { useSoundVariants } from "../../game/_shared/useSoundVariants";
import {
  BLACKJACK_CARD_DEAL,
  BLACKJACK_CARD_FLIP,
  BLACKJACK_CHIP_BET,
  BLACKJACK_SOUNDS,
} from "../../game/blackjack/sounds";
import type { SoundCue } from "./blackjackMotion";

/** The effects some results have on the felt. */
export interface CueEffects {
  readonly onWin: () => void;
  readonly onBust: () => void;
  readonly onBlackjack: () => void;
}

export function useBlackjackCues(effects: CueEffects): (cue: SoundCue, skipped: boolean) => void {
  const deal = useSoundVariants(BLACKJACK_CARD_DEAL, BLACKJACK_SOUNDS);
  const flip = useSoundVariants(BLACKJACK_CARD_FLIP, BLACKJACK_SOUNDS);
  const chipBet = useSoundVariants(BLACKJACK_CHIP_BET, BLACKJACK_SOUNDS);
  const blackjack = useSound("blackjack.blackjack", BLACKJACK_SOUNDS);
  const bust = useSound("blackjack.bust", BLACKJACK_SOUNDS);
  const win = useSound("blackjack.win", BLACKJACK_SOUNDS);
  const lose = useSound("blackjack.lose", BLACKJACK_SOUNDS);
  const push = useSound("blackjack.push", BLACKJACK_SOUNDS);
  const payout = useSound("blackjack.chipPayout", BLACKJACK_SOUNDS);
  const collect = useSound("blackjack.chipCollect", BLACKJACK_SOUNDS);
  const nudge = useSound("blackjack.chipNudge", BLACKJACK_SOUNDS);
  // The latest effects (they read the settled chips), never a stale closure.
  const effectsRef = useRef(effects);
  useLayoutEffect(() => {
    effectsRef.current = effects;
  });

  const players: Record<SoundCue, { play: () => boolean }> = {
    deal,
    flip,
    chipBet,
    blackjack,
    bust,
    win,
    lose,
    push,
    payout,
    collect,
    nudge,
  };
  const playersRef = useRef(players);
  useLayoutEffect(() => {
    playersRef.current = players;
  });

  return useCallback((cue: SoundCue, skipped: boolean) => {
    playersRef.current[cue].play();
    if (skipped) return;
    if (cue === "win") effectsRef.current.onWin();
    else if (cue === "bust") effectsRef.current.onBust();
    else if (cue === "blackjack") effectsRef.current.onBlackjack();
  }, []);
}
