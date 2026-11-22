/**
 * Daily Word's lobby tile status (#4008): "Done today" once today's puzzle is finished, won or
 * lost. Today's puzzle is the cached metadata for today's date key (`warmTodayMeta`, #2925); with
 * none cached there is no status. Reads two keys and writes nothing.
 */
import type { TileStatus } from "../_shared/lobbyStatus";
import { getLanguage, getTimezoneOffset, localDateKey } from "./todayMeta";
import { isBoardFinished, loadTodayMeta } from "./storage";

export async function getLobbyStatus(): Promise<TileStatus | undefined> {
  const meta = await loadTodayMeta(localDateKey(getTimezoneOffset(), getLanguage()));
  if (!meta?.puzzle_id) return undefined;
  return (await isBoardFinished(meta.puzzle_id)) ? { kind: "doneToday" } : undefined;
}
