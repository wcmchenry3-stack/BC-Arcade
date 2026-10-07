/**
 * AsyncStorage persistence for 2048 in-progress games and best score,
 * through the shared `storageSlot` (#2987).
 *
 * Saves after every move so a crash or app-kill mid-game doesn't lose
 * progress. One slot per device (single-player, no account linkage).
 *
 * Storage key bumped to v2 because Twenty48State now includes `tiles` and
 * `scoreDelta` — v1 payloads are silently discarded on first load. A payload
 * missing the core fields loads as no game and is left stored.
 *
 * The play clock is saved banked and restarted on load (`clockForSave`,
 * `clockOnLoad`, #2750): time played before an app kill is kept, and the
 * time the app was closed never counts.
 *
 * The old `twenty48_stats_v1` counters (best tile, games played, games won)
 * are no longer read or written (#2636): the Stats screen reads the server.
 * What a device already stored there is left alone.
 */

import { Twenty48State } from "./types";
import { seedNextTileId } from "./engine";
import { clockForSave, clockOnLoad } from "../_shared/playClock";
import { createJsonSlot, createRecord } from "../_shared/storageSlot";

const SUBSYSTEM = "twenty48.storage";

/** Fill in what older saves lack, and re-seed the tile ids. */
function restore(parsed: Twenty48State): Twenty48State {
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
}

export const {
  save: saveGame,
  load: loadGame,
  clear: clearGame,
} = createJsonSlot<Twenty48State>({
  key: "twenty48_game_v2",
  subsystem: SUBSYSTEM,
  // Minimum viability check — only discard if the core fields are missing.
  isValid: (p): p is Twenty48State => {
    const parsed = p as Twenty48State;
    return (
      Array.isArray(parsed.board) && parsed.board.length === 4 && typeof parsed.score === "number"
    );
  },
  keepInvalid: true,
  corruptExtra: "keyAndRaw",
  onLoad: restore,
  beforeSave: clockForSave,
});

export const { save: saveBestScore, load: loadBestScore } = createRecord<number>({
  key: "twenty48_best_score_v1",
  subsystem: SUBSYSTEM,
  ops: { load: "loadBest", save: "saveBest" },
  fallback: () => 0,
  read: (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  },
  write: String,
});
