/**
 * A paused Star Swarm run, restored the next time the screen opens (#1367).
 *
 * The in-memory copy is authoritative, so the screen reads it synchronously at mount.
 * AsyncStorage keeps the same run so it also survives the process (#2645): backgrounding
 * during a run saves it, and the OS may kill the app from there. Call
 * `hydratePausedState()` before mounting the screen; it loads the run a previous process
 * saved.
 *
 * A run restored from disk belongs to a dead process, so hydrating also:
 *   - continues the engine's id counter and rng seed, which a new process starts over;
 *   - abandons the dead process's sync session, which nothing else would ever close.
 * A save whose state shape doesn't match this build's engine is dropped, not restored.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { gameEventClient } from "../_shared/gameEventClient";
import {
  DIFFICULTY_TIERS,
  buildStateShape,
  restoreEngineCounters,
  stateShape,
  type EngineCounters,
} from "./engine";
import type { DifficultyTier, StarSwarmState } from "./types";

export const PAUSED_RUN_STORAGE_KEY = "starswarm.pausedRun";
/** Bump to drop every save made before a change {@link stateShape} can't see. */
const SAVE_VERSION = 1;

export interface SavedPauseState {
  gameState: StarSwarmState;
  difficulty: DifficultyTier;
  /** The run's sync session; a restore after a cold start abandons it. */
  gameId?: string | null;
  /** The engine's counters at save time; a restore after a cold start continues them. */
  counters?: EngineCounters;
}

interface PersistedPauseState extends SavedPauseState {
  v: number;
}

let _saved: SavedPauseState | null = null;
/** True once the in-memory copy is current: disk was read, or a save/clear has happened since. */
let _hydrated = false;
let _hydrating: Promise<void> | null = null;

export function savePausedState(state: SavedPauseState): void {
  _saved = state;
  _hydrated = true;
  let raw: string;
  try {
    const persisted: PersistedPauseState = { ...state, v: SAVE_VERSION };
    raw = JSON.stringify(persisted);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "starswarm.pauseStore", op: "save" } });
    return;
  }
  AsyncStorage.setItem(PAUSED_RUN_STORAGE_KEY, raw).catch((e) =>
    Sentry.captureException(e, { tags: { subsystem: "starswarm.pauseStore", op: "save" } })
  );
}

export function getSavedPausedState(): SavedPauseState | null {
  return _saved;
}

export function clearSavedPausedState(): void {
  const had = _saved !== null || !_hydrated;
  _saved = null;
  _hydrated = true;
  if (had) AsyncStorage.removeItem(PAUSED_RUN_STORAGE_KEY).catch(() => undefined);
}

export function isPausedStateHydrated(): boolean {
  return _hydrated;
}

/** Loads the run a previous process saved. Never rejects; runs once per process. */
export function hydratePausedState(): Promise<void> {
  if (_hydrated) return Promise.resolve();
  if (!_hydrating) {
    _hydrating = loadFromDisk().finally(() => {
      _hydrating = null;
    });
  }
  return _hydrating;
}

async function loadFromDisk(): Promise<void> {
  let restored: PersistedPauseState | null = null;
  try {
    const raw = await AsyncStorage.getItem(PAUSED_RUN_STORAGE_KEY);
    if (raw != null) {
      const parsed = JSON.parse(raw) as PersistedPauseState;
      if (isRestorable(parsed)) restored = parsed;
      else AsyncStorage.removeItem(PAUSED_RUN_STORAGE_KEY).catch(() => undefined);
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "starswarm.pauseStore", op: "load" } });
    AsyncStorage.removeItem(PAUSED_RUN_STORAGE_KEY).catch(() => undefined);
  }
  // A save or clear while reading wins: the in-memory copy is newer than the disk read.
  if (_hydrated) return;
  _hydrated = true;
  if (restored === null) return;

  if (restored.counters) restoreEngineCounters(restored.counters);
  _saved = {
    gameState: restored.gameState,
    difficulty: restored.difficulty,
    counters: restored.counters,
  };
  if (restored.gameId) await abandonDeadSession(restored.gameId);
}

function isRestorable(p: PersistedPauseState | null): p is PersistedPauseState {
  if (p === null || typeof p !== "object") return false;
  if (p.v !== SAVE_VERSION) return false;
  if (!(DIFFICULTY_TIERS as readonly string[]).includes(p.difficulty)) return false;
  const s = p.gameState;
  if (s === null || typeof s !== "object" || s.player === null || typeof s.player !== "object")
    return false;
  if (s.phase === "GameOver") return false;
  return stateShape(s) === buildStateShape();
}

/** The process that owned this session is gone; close it the way an unmount would have. */
async function abandonDeadSession(gameId: string): Promise<void> {
  try {
    // The pending-games store must be loaded, or the completion is dropped as unknown.
    await gameEventClient.init();
    gameEventClient.completeGame(gameId, { outcome: "abandoned" }, { outcome: "abandoned" });
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "starswarm.pauseStore", op: "abandon" } });
  }
}

/** Test-only: forget everything, as a new process would. */
export function _resetPauseStoreForTests(): void {
  _saved = null;
  _hydrated = false;
  _hydrating = null;
}
