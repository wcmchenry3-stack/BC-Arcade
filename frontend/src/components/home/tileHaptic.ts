import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * A light tap when a lobby tile is pressed down (#4007). iOS and Android only. `muted` is the
 * "Sound effects" setting: the app has no separate haptics preference, so that one gates it.
 */
export function tilePressHaptic(muted: boolean): void {
  if (muted || Platform.OS === "web") return;
  // It runs before the tile's navigation in the same handler: a synchronous throw from the native
  // module must not block opening the game, so both kinds of failure are swallowed.
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  } catch {
    // no haptic engine; the tap still navigates
  }
}
