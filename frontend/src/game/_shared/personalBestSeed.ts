/**
 * Seeds the shared local personal best from the server's per-game stats, once (#3802; owner
 * decision #3798: the device stays authoritative, the server is only read, never written).
 *
 * After a reinstall or on a new device the local best (`personalBest.ts`) is empty even though the
 * player has a best on the server. The stats the app already fetches (`GET /stats/me`, by Home,
 * Profile and the stats screen) carry each game's `best_value`, so the seed rides on that
 * response: **no request of its own**. `useMyStats.rememberMyStats` hands every response it
 * keeps to `seedPersonalBests`.
 *
 * Which games: only where `best_value` is the same number the local best holds, checked by the
 * server's `best_label_key` too (a changed board seeds nothing). Cascade, 2048 and Star Swarm
 * (highest score; Star Swarm's local best is one across tiers, as is the server's) and FreeCell
 * (fewest moves). Not seeded, because `/stats/me` has no matching field: Solitaire (server best
 * is the score, local is the fastest win), Sudoku (local is per mode and difficulty; the server
 * has one best), Mahjong (per layout, a separate story), Yacht (the server best counts every
 * mode, local is solo only); Sort has its own story.
 *
 * Rules:
 *  - A game with a local best is never touched, so a better (or any) local best is never
 *    overwritten; with none, the value goes in through `recordResult`, which keeps the better one
 *    by the game's comparator and writes only when it improves. Once seeded the game has a local
 *    best, so it is never seeded again: once per game per install.
 *  - Offline, no stats, a game missing from them, or a value that cannot be a best: silent, and
 *    the next stats response tries again (nothing is requested for it).
 *  - Never throws, never reports to Sentry (`personalBest` reports its own storage failures).
 *
 * Kill switch (no app release): `GET /games/catalog` serves `personal_best_seed: {enabled}`
 * (backend env `PERSONAL_BEST_SEED_ENABLED`, Render), taken by `replayDialSync` on the fetch it
 * already makes (once per launch, at most hourly in the foreground). Off, nothing is seeded.
 * Held in AsyncStorage (`personalBestSeedDial.v1`, `{e, t}`; read once per process) so an "off"
 * holds across launches; a value no valid fetch confirmed for 7 days is the default: on. With no
 * value held or fetched yet (a fresh install whose catalog has not landed) nothing is seeded:
 * it fails toward the kill switch, and the next stats response retries.
 * A server value outside 1..`MAX_SEED_VALUE` is ignored. While "Delete my data" runs
 * (`deletingData.ts`) nothing is seeded.
 *
 * Cost (CLAUDE.md): no server I/O of its own: zero extra requests, zero bytes on the wire. On
 * device, per stats response: a cached read per seedable game (4), and at most one ~30-byte
 * write per game, ever. The catalog block is `"personal_best_seed":{"enabled":true}`, about 40
 * bytes on a response the app already fetches. Nothing on the frame or gesture path, and nothing
 * while a game is being played.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { StatsResponse } from "../../api/types";
import { getBest, seedBest, type PersonalBestGame } from "./personalBest";

/** Per seedable game: the server's board label that means the local best's metric. */
const SEEDABLE: Readonly<Partial<Record<PersonalBestGame, string>>> = {
  cascade: "score",
  freecell: "moves",
  starswarm: "score",
  twenty48: "score",
};

/** The most a seeded best can be: the backend's counter bound (`starswarm.models.MAX_COUNTER`). */
export const MAX_SEED_VALUE = 10_000_000;

const STORAGE_KEY = "personalBestSeedDial.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A switch no valid fetch has confirmed for this long falls back to the default (on).
 * @internal Exported for its tests.
 */
export const SEED_DIAL_MAX_AGE_MS = 7 * DAY_MS;

interface HeldDial {
  readonly enabled: boolean;
  /** When a valid fetch last confirmed it (ms since epoch). */
  readonly confirmedAt: number;
}

let held: HeldDial | null = null;
let hydrating: Promise<void> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether seeding is on at `now` (see the header). */
export function isSeedEnabled(now: number = Date.now()): boolean {
  // No value held or fetched yet (a fresh install whose catalog has not landed): fail toward the
  // kill switch. The next stats response retries.
  if (held === null) return false;
  const age = now - held.confirmedAt;
  // Stale, or dated in the future (the clock moved back): the default.
  return age >= 0 && age < SEED_DIAL_MAX_AGE_MS ? held.enabled : true;
}

/** Reads the last good switch once per process; a fetched one is fresher and wins. */
export function hydrateSeedDial(): Promise<void> {
  if (!hydrating) {
    hydrating = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return;
        const { e, t } = parsed;
        if (typeof e !== "boolean" || typeof t !== "number" || !Number.isFinite(t)) return;
        if (held === null) held = { enabled: e, confirmedAt: t };
      } catch {
        // Unreadable: the default until a fetch succeeds.
      }
    })();
  }
  return hydrating;
}

/**
 * Takes a fetched catalog body's `personal_best_seed` as the switch, confirmed at `now`, and
 * stores it, only when it is valid. Returns whether it was taken. Never throws.
 */
export async function acceptSeedDial(body: unknown, now: number = Date.now()): Promise<boolean> {
  const block = isRecord(body) ? body.personal_best_seed : undefined;
  if (!isRecord(block) || typeof block.enabled !== "boolean") return false;
  held = { enabled: block.enabled, confirmedAt: now };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ e: block.enabled, t: now }));
  } catch {
    // Kept in memory for this process; the next launch fetches again.
  }
  return true;
}

/**
 * Seeds the local best of each seedable game that has none from `stats` (see the header), while
 * `isCurrent()` holds: it is checked before each game and again right before each write, so a
 * response whose player was deleted meanwhile seeds nothing.
 * Resolves when done; never rejects.
 */
export async function seedPersonalBests(
  stats: StatsResponse,
  isCurrent: () => boolean = () => true
): Promise<void> {
  try {
    await hydrateSeedDial();
    if (!isCurrent()) return;
    if (!isSeedEnabled()) return;
    const byGame = isRecord(stats?.by_game) ? stats.by_game : {};
    for (const [game, labelKey] of Object.entries(SEEDABLE) as [PersonalBestGame, string][]) {
      const entry = byGame[game];
      if (!isRecord(entry) || entry.best_label_key !== labelKey) continue;
      const value = entry.best_value;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      // A hostile or buggy server must not plant an unbeatable (or zero-ish) best.
      if (value < 1 || value > MAX_SEED_VALUE) continue;
      if (!isCurrent()) return;
      if ((await getBest(game)) > 0) continue;
      // Only written while `isCurrent()` still holds, checked again inside the write itself.
      await seedBest(game, Math.floor(value), isCurrent);
    }
  } catch {
    // Nothing is seeded; the next stats response tries again.
  }
}

/**
 * Tests only: forget the held switch and the hydrate.
 * @internal
 */
export function __resetPersonalBestSeedForTests(): void {
  held = null;
  hydrating = null;
}
