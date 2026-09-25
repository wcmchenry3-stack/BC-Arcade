/**
 * A paused Star Swarm run, restored the next time the screen opens (#1367).
 *
 * The in-memory copy is authoritative, so the screen reads it synchronously at mount.
 * AsyncStorage keeps the same run so it also survives the process (#2645): backgrounding
 * during a run saves it, and the OS may kill the app from there. Call
 * `hydratePausedState()` before mounting the screen; it loads the run a previous process
 * saved.
 *
 * A save read from disk belongs to a dead process, so hydrating also:
 *   - abandons that process's sync session, which nothing else would ever close — whether
 *     or not the run itself can be restored (#2654 tracks doing this for every game);
 *   - continues the engine's id counter and rng seed, which a new process starts over.
 * A save that doesn't fit this build (see saveShape.ts) is dropped, not restored.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { gameEventClient } from "../_shared/gameEventClient";
import {
  DIFFICULTY_TIERS,
  isEngineCounters,
  restoreEngineCounters,
  type EngineCounters,
} from "./engine";
import { SAVE_FINGERPRINT, fitsSaveShape } from "./saveShape";
import type { DifficultyTier, StarSwarmState } from "./types";

export const PAUSED_RUN_STORAGE_KEY = "starswarm.pausedRun";
/**
 * Bump for a change the shape can't show — a field whose meaning or units changed. Shape
 * changes are covered by SAVE_FINGERPRINT on their own.
 */
const SAVE_VERSION = 1;
/** How long the screen waits for the disk read before starting without it. */
export const HYDRATE_TIMEOUT_MS = 2000;

export interface SavedPauseState {
  gameState: StarSwarmState;
  difficulty: DifficultyTier;
  /** The run's open sync session; a restore after a cold start abandons it. */
  gameId?: string | null;
  /** The engine's counters at save time; a restore after a cold start continues them. */
  counters?: EngineCounters;
}

interface PersistedPauseState extends SavedPauseState {
  v: number;
  fp: string;
}

let _saved: SavedPauseState | null = null;
/** True once the in-memory copy is current: disk was read, or a save/clear has happened since. */
let _hydrated = false;
let _hydrating: Promise<void> | null = null;

function writeToDisk(state: SavedPauseState): void {
  let raw: string;
  try {
    const persisted: PersistedPauseState = { ...state, v: SAVE_VERSION, fp: SAVE_FINGERPRINT };
    raw = JSON.stringify(persisted);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "starswarm.pauseStore", op: "save" } });
    return;
  }
  AsyncStorage.setItem(PAUSED_RUN_STORAGE_KEY, raw).catch((e) =>
    Sentry.captureException(e, { tags: { subsystem: "starswarm.pauseStore", op: "save" } })
  );
}

export function savePausedState(state: SavedPauseState): void {
  _saved = state;
  _hydrated = true;
  writeToDisk(state);
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

/**
 * The screen unmounted, which abandons its sync session: keep the saved run, drop the
 * session, so a later cold start doesn't close it a second time. A session in memory is
 * always this process's (a run restored from disk carries none).
 */
export function releaseSavedSession(): void {
  if (!_saved?.gameId) return;
  savePausedState({ ..._saved, gameId: null });
}

export function isPausedStateHydrated(): boolean {
  return _hydrated;
}

/**
 * Loads the run a previous process saved. Never rejects; reads disk once per process. If the
 * read takes longer than HYDRATE_TIMEOUT_MS it resolves without it, and the late read then
 * restores nothing (it still closes the dead session).
 */
export function hydratePausedState(): Promise<void> {
  if (_hydrated) return Promise.resolve();
  if (!_hydrating) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        _hydrated = true;
        resolve();
      }, HYDRATE_TIMEOUT_MS);
    });
    _hydrating = Promise.race([loadFromDisk(), timeout]).finally(() => {
      clearTimeout(timer);
      _hydrating = null;
    });
  }
  return _hydrating;
}

async function loadFromDisk(): Promise<void> {
  let parsed: unknown = null;
  try {
    const raw = await AsyncStorage.getItem(PAUSED_RUN_STORAGE_KEY);
    if (raw != null) parsed = JSON.parse(raw);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "starswarm.pauseStore", op: "load" } });
    AsyncStorage.removeItem(PAUSED_RUN_STORAGE_KEY).catch(() => undefined);
  }

  // The session belongs to a dead process whatever becomes of the run.
  const deadGameId = sessionOf(parsed);
  if (deadGameId !== null) void abandonDeadSession(deadGameId);

  // A save or clear while reading — or the timeout — wins: memory is newer than this read.
  if (_hydrated) return;
  _hydrated = true;
  if (parsed === null) return;
  if (!isRestorable(parsed)) {
    AsyncStorage.removeItem(PAUSED_RUN_STORAGE_KEY).catch(() => undefined);
    return;
  }
  restoreEngineCounters(parsed.counters);
  _saved = {
    gameState: parsed.gameState,
    difficulty: parsed.difficulty,
    counters: parsed.counters,
  };
}

function sessionOf(parsed: unknown): string | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const { gameId } = parsed as Record<string, unknown>;
  return typeof gameId === "string" && gameId !== "" ? gameId : null;
}

function isRestorable(p: unknown): p is PersistedPauseState & { counters: EngineCounters } {
  if (p === null || typeof p !== "object") return false;
  const { v, fp, difficulty, counters, gameState } = p as Record<string, unknown>;
  return (
    v === SAVE_VERSION &&
    fp === SAVE_FINGERPRINT &&
    (DIFFICULTY_TIERS as readonly unknown[]).includes(difficulty) &&
    isEngineCounters(counters) &&
    fitsSaveShape(gameState) &&
    gameState.phase !== "GameOver"
  );
}

/**
 * The process that owned this session is gone; close it the way an unmount would have.
 * Fire-and-forget: the restore never waits on the event client.
 */
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
