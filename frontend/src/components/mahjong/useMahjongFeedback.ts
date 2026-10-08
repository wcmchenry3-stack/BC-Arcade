/**
 * useMahjongFeedback (#2981) — the Mahjong board's sound and motion.
 *
 * Diffs each new state against the previous one and answers the change:
 *
 *   - fewer tiles (a match): the match sound, and a flying pair for the two
 *     removed tiles;
 *   - otherwise a selected tile: the select sound;
 *   - a shuffle spent: the shuffle sound and a fade pulse on the board;
 *   - the board just cleared: the win sound;
 *   - the board just deadlocked: the deadlock sound and a sideways shake.
 *
 * Reduce Motion drops the flying pairs, pulse and shake; the sounds stay.
 * Background music plays while a board is live (not cleared, not deadlocked).
 * The first state, and the step from or to no board, make no sound.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { FlyingPairData } from "./FlyingPair";
import type { MahjongState } from "../../game/mahjong/types";
import { useMahjongAudio } from "../../game/mahjong/useMahjongAudio";

const PULSE_STEP_MS = 180;
const SHAKE_STEP_MS = 60;

export function useMahjongFeedback(state: MahjongState | null, reduceMotion: boolean) {
  const [flyingPairs, setFlyingPairs] = useState<FlyingPairData[]>([]);
  const boardShakeX = useSharedValue(0);
  const boardOpacity = useSharedValue(1);
  const boardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boardShakeX.value }],
    opacity: boardOpacity.value,
  }));

  const musicActive = state !== null && !state.isComplete && !state.isDeadlocked;
  const { playTileSelect, playTileMatch, playShuffle, playWin, playDeadlock } =
    useMahjongAudio(musicActive);

  // The state the last diff saw.
  const prevStateRef = useRef<MahjongState | null>(null);

  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev || !state) return;

    if (state.tiles.length < prev.tiles.length) {
      playTileMatch();
      if (!reduceMotion) {
        const removed = prev.tiles.filter((t) => !state.tiles.some((nt) => nt.id === t.id));
        if (removed.length >= 2) {
          setFlyingPairs((existing) => [
            ...existing,
            { id: `${Date.now()}`, tile1: removed[0]!, tile2: removed[1]! },
          ]);
        }
      }
    } else if (state.selected !== null) {
      playTileSelect();
    }

    if (state.shufflesLeft < prev.shufflesLeft) {
      playShuffle();
      if (!reduceMotion) {
        boardOpacity.value = withSequence(
          withTiming(0.35, { duration: PULSE_STEP_MS }),
          withTiming(1, { duration: PULSE_STEP_MS })
        );
      }
    }

    if (state.isComplete && !prev.isComplete) {
      playWin();
    }

    if (state.isDeadlocked && !prev.isDeadlocked) {
      playDeadlock();
      if (!reduceMotion) {
        boardShakeX.value = withSequence(
          withTiming(8, { duration: SHAKE_STEP_MS }),
          withTiming(-8, { duration: SHAKE_STEP_MS }),
          withTiming(6, { duration: SHAKE_STEP_MS }),
          withTiming(-6, { duration: SHAKE_STEP_MS }),
          withTiming(4, { duration: SHAKE_STEP_MS }),
          withTiming(-4, { duration: SHAKE_STEP_MS }),
          withTiming(0, { duration: SHAKE_STEP_MS })
        );
      }
    }
    // Only a new state is an event: reduceMotion and the sound callbacks are
    // read as they are when it lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** Drops a flying pair once its animation has finished. */
  const dismissFlyingPair = useCallback((id: string) => {
    setFlyingPairs((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { flyingPairs, dismissFlyingPair, boardAnimStyle };
}
