/**
 * useMahjongFeedback (#2981) — the Mahjong board's sound and motion.
 *
 * Answers the events each engine action emits (#3087, `MahjongEvent`):
 *
 *   - a match: the match sound;
 *   - a selected tile: the select sound;
 *   - a shuffle spent: the shuffle sound;
 *   - the board just cleared: the win sound;
 *   - the board just deadlocked: the deadlock sound and a sideways shake of the board.
 *
 * The tiles' own motion (lift, match burst, swirl, cascade…) is `useBoardMotion` (#3613).
 * Reduce Motion drops the shake; the sounds stay.
 * Background music plays while a board is live (not cleared, not deadlocked).
 * A new deal, a restored game and a step to no board carry no events, so make
 * no sound.
 */
import { useCallback } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { MahjongState } from "../../game/mahjong/types";
import { useMahjongAudio } from "../../game/mahjong/useMahjongAudio";
import { useGameEvents } from "../../game/_shared/useGameEvents";

const SHAKE_STEP_MS = 60;

export function useMahjongFeedback(state: MahjongState | null, reduceMotion: boolean) {
  const boardShakeX = useSharedValue(0);
  const boardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boardShakeX.value }],
  }));

  const musicActive = state !== null && !state.isComplete && !state.isDeadlocked;
  const { playTileSelect, playTileMatch, playShuffle, playWin, playDeadlock } =
    useMahjongAudio(musicActive);

  const shakeBoard = useCallback(() => {
    boardShakeX.set(
      withSequence(
        withTiming(8, { duration: SHAKE_STEP_MS }),
        withTiming(-8, { duration: SHAKE_STEP_MS }),
        withTiming(6, { duration: SHAKE_STEP_MS }),
        withTiming(-6, { duration: SHAKE_STEP_MS }),
        withTiming(4, { duration: SHAKE_STEP_MS }),
        withTiming(-4, { duration: SHAKE_STEP_MS }),
        withTiming(0, { duration: SHAKE_STEP_MS })
      )
    );
  }, [boardShakeX]);

  // The engine's events for each action (#3087), fired once per array. A
  // restored game carries none (storage never keeps them), and a clock pause
  // or resume copies the state with the same array, so neither replays a sound.
  // reduceMotion and the sound callbacks are read as they are when it lands.
  useGameEvents(state?.events, {
    tileSelect: () => playTileSelect(),
    tileMatch: () => playTileMatch(),
    shuffle: () => playShuffle(),
    boardCleared: () => playWin(),
    deadlock: () => {
      playDeadlock();
      if (!reduceMotion) {
        shakeBoard();
      }
    },
  });

  return { boardAnimStyle };
}
