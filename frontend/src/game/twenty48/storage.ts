/**
 * AsyncStorage persistence for 2048 in-progress games and best score.
 *
 * Saves after every move so a crash or app-kill mid-game doesn't lose
 * progress. One slot per device (single-player, no account linkage).
 *
 * Storage key bumped to v2 because Twenty48State now includes `tiles` and
 * `scoreDelta` — v1 payloads are silently discarded on first load.
 *
 * The play clock is saved banked and restarted on load (`clockForSave`,
 * `clockOnLoad`, #2750): time played before an app kill is kept, and the
 * time the app was closed never counts.
 *
 * The old `twenty48_stats_v1` counters (best tile, games played, games won)
 * are no longer read or written (#2636): the Stats screen reads the server.
 * What a device already stored there is left alone.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { Twenty48State } from "./types";
import { seedNextTileId } from "./engine";
import { clockForSave, clockOnLoad } from "../_shared/playClock";

const GAME_KEY = "twenty48_game_v2";
const BEST_SCORE_KEY = "twenty48_best_score_v1";

export async function saveGame(state: Twenty48State): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(clockForSave(state)));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "twenty48.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<Twenty48State | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Twenty48State;
    // Minimum viability check — only discard if the core fields are missing.
    if (
      !Array.isArray(parsed.board) ||
      parsed.board.length !== 4 ||
      typeof parsed.score !== "number"
    ) {
      return null;
    }
    // Backfill tiles array for saves created before v2 tile animation data (#570).
    if (!Array.isArray(parsed.tiles)) {
      // Start at 1: id 0 is the engine's "empty cell" sentinel in idBoard.
      let nextId = 1;
      parsed.tiles = parsed.board.flatMap((row, r) =>
        row
          .map((val, c) =>
            val > 0
              ? {
                  id: nextId++,
                  value: val,
                  row: r,
                  col: c,
                  prevRow: null,
                  prevCol: null,
                  isNew: false,
                  isMerge: false,
                }
              : null
          )
          .filter((t): t is NonNullable<typeof t> => t !== null)
      );
    }
    if (typeof parsed.scoreDelta !== "number") {
      parsed.scoreDelta = 0;
    }
    if (typeof parsed.game_over !== "boolean") {
      parsed.game_over = false;
    }
    if (typeof parsed.has_won !== "boolean") {
      parsed.has_won = false;
    }
    // Normalize timer fields — absent in states saved before timer was added.
    parsed.startedAt = parsed.startedAt ?? null;
    parsed.accumulatedMs = parsed.accumulatedMs ?? 0;
    // Re-seed the engine's tile-ID counter above every restored ID so
    // subsequent spawns/merges don't collide with surviving tiles (#698).
    const maxId = parsed.tiles.reduce((m, t) => (t.id > m ? t.id : m), 0);
    seedNextTileId(maxId + 1);
    // Events are transient (one-shot per move) and must never be replayed on
    // reload. Strip any that slipped into storage from saves written before
    // Twenty48Screen stripped them at the call site.
    parsed.events = undefined;
    return clockOnLoad(parsed, parsed.game_over);
  } catch (e) {
    // Corrupt payload: recovery is complete (we remove the bad entry and
    // return null, so the caller starts a fresh game). This is not an
    // error — downgrade from captureException to a warning captureMessage
    // so it doesn't page as a crash in Sentry. See #501.
    Sentry.captureMessage("twenty48.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: "twenty48.storage", op: "load" },
      extra: { error: String(e), key: GAME_KEY, rawPayload: raw?.slice(0, 500) },
    });
    // Remove corrupted entry so it doesn't fail on every subsequent load.
    await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
    return null;
  }
}

export async function clearGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GAME_KEY);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "twenty48.storage", op: "clear" } });
  }
}

export async function saveBestScore(score: number): Promise<void> {
  try {
    await AsyncStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "twenty48.storage", op: "saveBest" } });
  }
}

export async function loadBestScore(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(BEST_SCORE_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "twenty48.storage", op: "loadBest" } });
    return 0;
  }
}
