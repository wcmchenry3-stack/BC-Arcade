import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { loadDisplayName } from "../_shared/displayName";

const STORAGE_KEY = "hearts_player_names";
const MAX_NAME_LENGTH = 32;

export const DEFAULT_NAMES = ["You", "West", "North", "East"] as const;

export function validateName(raw: string, fallback: string): string {
  const trimmed = raw.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : fallback;
}

export async function loadPlayerNames(): Promise<string[]> {
  const names = await loadStoredNames();
  // The human seat follows the profile display name (#2502) until the player
  // gives that seat a name of its own here.
  if (names[0] === DEFAULT_NAMES[0]) {
    const displayName = await loadDisplayName();
    if (displayName) names[0] = displayName;
  }
  return names;
}

async function loadStoredNames(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_NAMES];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 4) return [...DEFAULT_NAMES];
    return parsed.map((n, i) => validateName(String(n), DEFAULT_NAMES[i] ?? "Player"));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "hearts.playerNames", op: "load" } });
    return [...DEFAULT_NAMES];
  }
}

export async function savePlayerNames(names: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "hearts.playerNames", op: "save" } });
  }
}
