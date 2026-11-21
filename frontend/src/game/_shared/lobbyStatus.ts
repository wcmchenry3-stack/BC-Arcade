/**
 * What a lobby tile can say about a game, read from this device only (#4008).
 *
 * The lobby shows one status in the description's slot: a game to resume, Daily Word done today,
 * or the player's personal best. Each game contributes a small `getLobbyStatus()` next to its
 * storage module; `useLobbyTileStatus` batches them after first paint.
 *
 * Cost: reads only. About one AsyncStorage key per visible game per Home focus (the personal best
 * is held in memory after its first read), 0 bytes written, 0 network, 0 Sentry events. A save that
 * can't be read or parsed reads as no status and is left exactly as stored: unlike a game's own
 * `loadGame`, nothing here removes or reports a corrupt payload.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

/** How a personal best is written: a score, a time (ms), or a move count. */
export type BestUnit = "score" | "time" | "moves";

export type TileStatus =
  /** A saved game that tapping the tile continues. */
  | { readonly kind: "resume" }
  /** Daily Word: today's puzzle is finished, won or lost. */
  | { readonly kind: "doneToday" }
  /** The player's personal best, in the game's own unit. */
  | { readonly kind: "best"; readonly value: number; readonly unit: BestUnit };

/** Highest priority first: Resume > Done today > Best. */
export function pickStatus(
  candidates: readonly (TileStatus | undefined)[]
): TileStatus | undefined {
  for (const kind of ["resume", "doneToday", "best"] as const) {
    const found = candidates.find((c) => c?.kind === kind);
    if (found) return found;
  }
  return undefined;
}

/**
 * The saved game under `key` when it parses and passes the game's own shape check, else null.
 * Read-only and silent: never removes, writes or reports (see the header).
 */
export async function readSavedGame<T>(
  key: string,
  isValid: (parsed: unknown) => parsed is T
): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A personal best as a status, or none when the game has no best on record. */
export function bestStatus(value: number, unit: BestUnit): TileStatus | undefined {
  return value > 0 ? { kind: "best", value, unit } : undefined;
}
