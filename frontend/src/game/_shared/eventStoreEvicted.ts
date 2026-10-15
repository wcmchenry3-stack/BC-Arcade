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
 * Write-ahead: when an eviction selects games (one eviction can select
 * several), `reserve` writes them into the marker BEFORE their rows are
 * deleted (one extra write per evicting transaction; ordinary saves write
 * nothing). If that write fails no replay row is deleted: the set is put
 * back and the transaction is rerun without the replay-game eviction (the
 * batch is stored, so its game has no hole; the queue may sit over its cap
 * until a later save's marker write works). After the commit and any recovery, `settle`
 * unmarks the games none of whose selected rows left (their writes failed
 * and were put back) and writes again only if that changed the set. So a kill
 * after the delete always leaves a durable marker. Two crash paths can leave
 * an intact game marked, which loses the rest of that game's replay and never
 * corrupts one: a kill after the marker write but before the delete, and a
 * failed unmark write followed by a kill. A failed write of that kind is
 * reported through the throttle, leaves the set dirty in memory, and is
 * retried (`flush`) at the start of every later transaction.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import type { Priority } from "./eventQueueConfig";
import { EVICTED_KEY, GAME_TIERS, type Tiers, tierRows } from "./eventStoreChunks";
import type { Row } from "./eventStore";
import { sentryThrottle } from "./sentryThrottle";

/** How many evicted games are remembered. */
const EVICTED_GAMES_MAX = 64;

/** One game's rows in a replay tier, by position, and where its latest row sits. */
interface GameRows {
  readonly id: string | null;
  last: number;
  readonly rows: { tier: Priority; ci: number; ri: number; row: Row }[];
}

/**
 * The games with rows in `from`, in the order to evict them: the remnants of
 * games already marked (`isMarked`) first, then the least recently active game
 * (the one whose LATEST row comes first). One pass over the rows. A row with no
 * game id (not expected in a replay tier) is its own "game".
 */
export function groupByGame(
  tiers: Tiers,
  from: readonly Priority[],
  isMarked: (id: string) => boolean
): GameRows[] {
  const games = new Map<string, GameRows>();
  let n = 0;
  for (const tier of from) {
    tiers[tier].forEach((chunk, ci) =>
      chunk.rows.forEach((row, ri) => {
        const id = row.log_type === "game_event" && row.game_id ? row.game_id : null;
        const key = id ?? `row:${row.id}`;
        let game = games.get(key);
        if (game === undefined) {
          game = { id, last: 0, rows: [] };
          games.set(key, game);
        }
        game.last = n;
        n += 1;
        game.rows.push({ tier, ci, ri, row });
      })
    );
  }
  const marked = (g: GameRows) => (g.id !== null && isMarked(g.id) ? 0 : 1);
  return [...games.values()].sort((x, y) => marked(x) - marked(y) || x.last - y.last);
}

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

  /**
   * Write-ahead: mark the games an eviction selected, durably, before their
   * rows go. Resolves undefined on success. If the marker cannot be written
   * the set is put back as it was and the error is returned: the caller must
   * not delete any replay row.
   */
  async reserve(selected: Iterable<string>): Promise<{ error: unknown } | undefined> {
    const before = [...this.ids];
    const wasDirty = this.dirty;
    let any = false;
    for (const id of selected) {
      this.add(id);
      any = true;
    }
    if (!any) return undefined;
    this.dirty = true;
    const error = await this.flush();
    if (error === undefined) return undefined;
    this.ids.clear();
    for (const id of before) this.ids.add(id);
    this.dirty = wasDirty;
    return { error };
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

  /** Write the set if a write is owed. Resolves the error of a failed write (reported, never thrown). */
  async flush(): Promise<unknown> {
    if (!this.dirty) return undefined;
    const json = JSON.stringify([...this.ids]);
    if (json === this.persisted) {
      this.dirty = false;
      return undefined;
    }
    try {
      await AsyncStorage.setItem(EVICTED_KEY, json);
      this.persisted = json;
      this.dirty = JSON.stringify([...this.ids]) !== json; // an add during the write stays owed
      return undefined;
    } catch (e) {
      if (sentryThrottle.allow("eventStore.evicted", "error")) {
        Sentry.captureException(e, {
          fingerprint: ["eventStore.evicted"],
          tags: { subsystem: "eventStore", op: "evicted_marker" },
        });
      }
      return e ?? new Error("evicted marker write failed");
    }
  }
}
