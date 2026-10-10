/**
 * Today's-puzzle metadata helpers shared by DailyWordScreen and HomeScreen (#2925).
 *
 * The screen reads cached metadata under `localDateKey(...)` when it opens
 * offline; `warmTodayMeta` writes that same key while the app is online so the
 * screen can open offline later the same day.
 */
import i18n from "i18next";
import { dailyWordApi } from "./api";
import { loadTodayMeta, saveTodayMeta } from "./storage";

export function getTimezoneOffset(): number {
  return -new Date().getTimezoneOffset();
}

export function getLanguage(): string {
  return i18n.language?.startsWith("hi") ? "hi" : "en";
}

export function localDateKey(tzOffsetMinutes: number, lang: string): string {
  const localMs = Date.now() + tzOffsetMinutes * 60_000;
  const dayMs = Math.floor(localMs / 86_400_000) * 86_400_000;
  const d = new Date(dayMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}_${lang}`;
}

/**
 * Fetch and cache today's puzzle metadata unless already cached. Best-effort:
 * every failure is swallowed (httpClient reports what is worth reporting).
 */
export async function warmTodayMeta(
  tzOffset: number = getTimezoneOffset(),
  lang: string = getLanguage()
): Promise<void> {
  try {
    const dateKey = localDateKey(tzOffset, lang);
    if (await loadTodayMeta(dateKey)) return;
    await saveTodayMeta(dateKey, await dailyWordApi.getToday(tzOffset, lang));
  } catch {
    // Warming is an optimisation only.
  }
}
