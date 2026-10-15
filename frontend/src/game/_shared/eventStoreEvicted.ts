/**
 * The games whose replay rows the queue evicted whole (#3276). Once a game's
 * replay is cut, its later replay events are dropped on enqueue and the
 * remnants a partly failed eviction left are never synced: a replay missing
 * its start (or middle) is useless, and storing the rest only costs queue
 * space. The set is bounded (`EVICTED_GAMES_MAX`, oldest id forgotten first —
 * whether a game's session is over is not known to the store, so the bound is
 * the only forgetting) and persisted under `EVICTED_KEY`, written only when it
 * changes (after an eviction, never on an ordinary save), so it survives a
 * restart that resumes the game.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { EVICTED_KEY, GAME_TIERS, type Tiers, tierRows } from "./eventStoreChunks";
import { sentryThrottle } from "./sentryThrottle";

/** How many evicted games are remembered. */
const EVICTED_GAMES_MAX = 64;

export class EvictedGames {
  private readonly ids = new Set<string>();
  /** What `EVICTED_KEY` holds, to write only when the set changes. */
  private persisted = "[]";

  has(gameId: string): boolean {
    return this.ids.has(gameId);
  }

  clear(): void {
    this.ids.clear();
    this.persisted = "[]"; // `clearAll` removed the key
  }

  /** Take the raw `EVICTED_KEY` value `loadTiers` read, merged with what memory holds (newest last). */
  load(raw: string | null | undefined): void {
    let disk: string[] = [];
    try {
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) disk = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // A corrupt marker is dropped.
    }
    const memory = [...this.ids];
    this.ids.clear();
    for (const id of [...disk, ...memory]) this.add(id);
    this.persisted = JSON.stringify(disk);
  }

  private add(id: string): void {
    this.ids.delete(id);
    this.ids.add(id);
    for (const old of this.ids) {
      if (this.ids.size <= EVICTED_GAMES_MAX) break;
      this.ids.delete(old);
    }
  }

  /**
   * Settle the games an eviction chose against the replay rows `pre` held
   * before the transaction and `final` (the mirror after its commit and any
   * recovery; null when it could not be reloaded). A game that lost none of
   * those rows was not evicted (its writes failed and were put back): it is
   * forgotten and keeps accepting rows. A game that lost some or all is
   * remembered. With `final` unknown, remember: the safe side. Then persist
   * if the set changed; a failed write never fails the caller, it is reported
   * through the throttle and the in-memory set stays.
   */
  async settle(chosen: readonly string[], pre: Tiers, final: Tiers | null): Promise<void> {
    if (chosen.length === 0) return;
    const games = new Set(chosen);
    const before = new Map<string, string[]>();
    const after = new Set<string>();
    for (const tier of GAME_TIERS) {
      for (const row of tierRows(pre[tier])) {
        if (row.log_type !== "game_event" || !games.has(row.game_id)) continue;
        let list = before.get(row.game_id);
        if (list === undefined) before.set(row.game_id, (list = []));
        list.push(row.id);
      }
      if (final !== null) for (const row of tierRows(final[tier])) after.add(row.id);
    }
    for (const id of games) {
      const intact = final !== null && (before.get(id) ?? []).every((rid) => after.has(rid));
      if (!intact) this.add(id);
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    const json = JSON.stringify([...this.ids]);
    if (json === this.persisted) return;
    try {
      await AsyncStorage.setItem(EVICTED_KEY, json);
      this.persisted = json;
    } catch (e) {
      if (!sentryThrottle.allow("eventStore.evicted", "error")) return;
      Sentry.captureException(e, {
        fingerprint: ["eventStore.evicted"],
        tags: { subsystem: "eventStore", op: "evicted_marker" },
      });
    }
  }
}
