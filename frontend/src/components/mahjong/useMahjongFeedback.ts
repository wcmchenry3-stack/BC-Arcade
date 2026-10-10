/**
 * useMahjongFeedback (#2981) — the Mahjong board's sound and motion.
 *
 * Answers the events each engine action emits (#3087, `MahjongEvent`):
 *
 *   - a match: the match sound, and a flying pair for the two removed tiles;
 *   - a selected tile: the select sound;
 *   - a shuffle spent: the shuffle sound and a fade pulse on the board;
 *   - the board just cleared: the win sound;
 *   - the board just deadlocked: the deadlock sound and a sideways shake.
 *
 * Reduce Motion drops the flying pairs, pulse and shake; the sounds stay.
 * Background music plays while a board is live (not cleared, not deadlocked).
 * A new deal, a restored game and a step to no board carry no events, so make
 * no sound.
 */
import { useCallback, useState } from "react";
import {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { FlyingPairData } from "./FlyingPair";
import type { MahjongState } from "../../game/mahjong/types";
import { useMahjongAudio } from "../../game/mahjong/useMahjongAudio";
import { useGameEvents } from "../../game/_shared/useGameEvents";

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

  const pulseBoard = useCallback(() => {
    boardOpacity.set(
      withSequence(
        withTiming(0.35, { duration: PULSE_STEP_MS }),
        withTiming(1, { duration: PULSE_STEP_MS })
      )
    );
  }, [boardOpacity]);

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
    tileMatch: ({ tiles: [tile1, tile2] }) => {
      playTileMatch();
      if (!reduceMotion) {
        setFlyingPairs((existing) => [...existing, { id: `${Date.now()}`, tile1, tile2 }]);
      }
    },
    shuffle: () => {
      playShuffle();
      if (!reduceMotion) {
        pulseBoard();
      }
    },
    boardCleared: () => playWin(),
    deadlock: () => {
      playDeadlock();
      if (!reduceMotion) {
        shakeBoard();
      }
    },
  });

  /** Drops a flying pair once its animation has finished. */
  const dismissFlyingPair = useCallback((id: string) => {
    setFlyingPairs((prev) => prev.filter((p) => p.id !== id));
  }, []);

  return { flyingPairs, dismissFlyingPair, boardAnimStyle };
}
