import { useCallback } from "react";
import { useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

export function useCardSelection(playInvalidMove: () => void): {
  shakeX: SharedValue<number>;
  triggerShake: () => void;
  triggerIllegal: () => void;
} {
  // useSharedValue returns a stable object — its reference never changes across renders.
  const shakeX = useSharedValue(0);

  const triggerShake = useCallback(() => {
    shakeX.value = withSequence(
      withTiming(4, { duration: 40 }),
      withTiming(-4, { duration: 40 }),
      withTiming(4, { duration: 40 }),
      withTiming(-4, { duration: 40 }),
      withTiming(0, { duration: 40 })
    );
  }, [shakeX]);

  const triggerIllegal = useCallback(() => {
    triggerShake();
    playInvalidMove();
  }, [triggerShake, playInvalidMove]);

  return { shakeX, triggerShake, triggerIllegal };
}
