/**
 * The games whose replay rows the queue evicted whole (#3276). Once a game's
 * replay is cut, its later replay events are dropped on enqueue and the
 * remnants a partly failed eviction left are never synced: a replay missing
 * its start (or middle) is useless, and storing the rest only costs queue
 * space. The set is bounded (`EVICTED_GAMES_MAX`, oldest id forgotten first —
 * whether a game's session is over is not known to the store, so the bound is
 * the only forgetting) and persisted under `EVICTED_KEY`, so it survives a
 * restart that resumes the game.
 *
 * Write-ahead: when an eviction selects games, `reserve` writes them into the
 * marker BEFORE their rows are deleted (one extra write per evicting
 * transaction; ordinary saves write nothing). After the commit and any
 * recovery, `settle` forgets the games none of whose selected rows left (their
 * writes failed and were put back) and writes again only if that changed the
 * set. So a kill after the delete always leaves a durable marker; a kill
 * before it can leave an intact game marked, which loses that one game's
 * remaining replay, never corrupts one. A failed marker write is reported
 * through the throttle, never fails the caller, leaves the set dirty in
 * memory, and is retried (`flush`) at the start of every later transaction.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { EVICTED_KEY, GAME_TIERS, type Tiers, tierRows } from "./eventStoreChunks";
import { sentryThrottle } from "./sentryThrottle";

/** How many evicted games are remembered. */
const EVICTED_GAMES_MAX = 64;

export class EvictedGames {
  private readonly ids = new Set<string>();
  /** What `EVICTED_KEY` holds. */
  private persisted = "[]";
  /** The set differs from `persisted`: a write is owed. */
  dirty = false;

  has(gameId: string): boolean {
    return this.ids.has(gameId);
  }

  clear(): void {
    this.ids.clear();
    this.persisted = "[]"; // `clearAll` removed the key
    this.dirty = false;
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
    this.dirty = JSON.stringify([...this.ids]) !== this.persisted;
  }

  private add(id: string): void {
    this.ids.delete(id);
    this.ids.add(id);
    for (const old of this.ids) {
      if (this.ids.size <= EVICTED_GAMES_MAX) break;
      this.ids.delete(old);
    }
  }

  /** Write-ahead: mark the games an eviction selected, durably, before their rows go. */
  async reserve(selected: Iterable<string>): Promise<void> {
    let any = false;
    for (const id of selected) {
      this.add(id);
      any = true;
    }
    if (any) {
      this.dirty = true;
      await this.flush();
    }
  }

  /**
   * After the commit and any recovery: `selected` maps each game the eviction
   * chose to the ids of the rows it selected; `final` is the mirror now (null
   * when it could not be reloaded). A game none of whose selected rows left
   * is forgotten; one that lost any (rows of its own batch that never landed
   * count) stays. With `final` unknown, all stay: the safe side.
   */
  async settle(
    selected: ReadonlyMap<string, readonly string[]>,
    final: Tiers | null
  ): Promise<void> {
    if (selected.size === 0) return;
    const present = new Set<string>();
    if (final !== null) {
      for (const tier of GAME_TIERS) for (const row of tierRows(final[tier])) present.add(row.id);
    }
    for (const [id, rowIds] of selected) {
      const intact = final !== null && rowIds.every((rid) => present.has(rid));
      if (intact && this.ids.delete(id)) this.dirty = true;
    }
    await this.flush();
  }

  /** Write the set if a write is owed. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    const json = JSON.stringify([...this.ids]);
    if (json === this.persisted) {
      this.dirty = false;
      return;
    }
    try {
      await AsyncStorage.setItem(EVICTED_KEY, json);
      this.persisted = json;
      this.dirty = JSON.stringify([...this.ids]) !== json; // an add during the write stays owed
    } catch (e) {
      if (!sentryThrottle.allow("eventStore.evicted", "error")) return;
      Sentry.captureException(e, {
        fingerprint: ["eventStore.evicted"],
        tags: { subsystem: "eventStore", op: "evicted_marker" },
      });
    }
  }
}
