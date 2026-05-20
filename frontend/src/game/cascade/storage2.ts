import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

const GAME_KEY = "cascade_game_v3";

export interface SavedState {
  version: 3;
  pieces: Array<{ tier: number; x: number; y: number }>;
  score: number;
  savedAt: number;
  queue: { current: number; next: number };
}

export function looksValid(data: unknown): data is SavedState {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (
    d.version !== 3 ||
    !Array.isArray(d.pieces) ||
    !(d.pieces as unknown[]).every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as Record<string, unknown>).tier === "number" &&
        typeof (p as Record<string, unknown>).x === "number" &&
        typeof (p as Record<string, unknown>).y === "number"
    ) ||
    typeof d.score !== "number" ||
    typeof d.savedAt !== "number"
  ) {
    return false;
  }
  const q = d.queue as Record<string, unknown> | undefined;
  return (
    typeof q === "object" &&
    q !== null &&
    typeof q.current === "number" &&
    typeof q.next === "number"
  );
}

export async function saveGame(snapshot: SavedState): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(snapshot));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "cascade.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<SavedState | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!looksValid(parsed)) {
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }
    return parsed;
  } catch (e) {
    Sentry.captureMessage("cascade.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: "cascade.storage", op: "load" },
      extra: { error: String(e), key: GAME_KEY, rawPayload: raw?.slice(0, 500) },
    });
    await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
    return null;
  }
}

export async function clearGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GAME_KEY);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "cascade.storage", op: "clear" } });
  }
}
