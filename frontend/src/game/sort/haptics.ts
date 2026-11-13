/**
 * Sort haptics (#3660): one small pulse per motion event, fired from the event itself
 * (a tap, a pour landing), never from a frame. Best-effort, as `GameResultModal`'s
 * `fireHaptic` is: a haptic that fails, synchronously or as a rejected promise, never breaks
 * play. None on web. The app has no shared haptics on/off setting today; if one is added,
 * honour it here, in the one place every Sort haptic goes through.
 *
 * The win's success pulse is not here: `GameResultModal` fires it when the card opens, which
 * is now after the win cascade, so the win has exactly one.
 */
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

export type SortHaptic =
  /** A bottle is selected by a tap. */
  | "select"
  /** A pour lands (the move commits). */
  | "land"
  /** A pour is refused. */
  | "refused"
  /** A pour completed a bottle (not the winning pour: the result card's pulse covers that). */
  | "complete";

export function fireSortHaptic(kind: SortHaptic): void {
  if (Platform.OS === "web") return;
  try {
    const run =
      kind === "select"
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        : kind === "land"
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
          : kind === "refused"
            ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
            : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    run?.catch(() => undefined);
  } catch {
    // No haptics available (or a partial module): play goes on.
  }
}
