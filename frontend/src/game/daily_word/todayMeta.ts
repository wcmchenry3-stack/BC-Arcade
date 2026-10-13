/**
 * Today's-puzzle metadata helpers shared by DailyWordScreen and HomeScreen (#2925).
 *
 * The screen reads cached metadata under `localDateKey(...)` when it opens
 * offline; `warmTodayMeta` writes that same key while the app is online so the
 * screen can open offline later the same day. It also stores the puzzles
 * fetched ahead for offline play (`warmUpcoming`, #3230).
 */
import i18n from "i18next";
import { Platform } from "react-native";
import { isStoreBuild } from "../_shared/buildFlavour";
import { dailyWordApi } from "./api";
import { warmUpcoming } from "./offlinePuzzles";
import { loadTodayMeta, saveTodayMeta } from "./storage";

export function getTimezoneOffset(): number {
  return -new Date().getTimezoneOffset();
}

/** Puzzle languages every build ships. Add launched languages (es, fr) here. */
const LAUNCHED_DAILY_WORD_LANGUAGES: readonly string[] = ["en"];

/**
 * Puzzle languages held back from native store builds until launch-ready
 * (#3153). French and Spanish (#3241) wait for native sign-off (#3201): the
 * `fr-CA` app language plays the `fr` puzzle and `es` the `es` one, on
 * internal and web builds only.
 */
const UNLAUNCHED_DAILY_WORD_LANGUAGES: readonly string[] = ["hi", "fr", "es"];

const ALL_DAILY_WORD_LANGUAGES: readonly string[] = [
  ...LAUNCHED_DAILY_WORD_LANGUAGES,
  ...UNLAUNCHED_DAILY_WORD_LANGUAGES,
];

/**
 * Puzzle languages playable on the given platform. Mirrors `availableLocales`
 * (`i18n/resolveLocale.ts`): native store builds get only the launched ones;
 * web (free games + testing, not a store platform), dev, e2e and pre-launch
 * builds get every language. A function so the `__forceStoreBuildForTests`
 * seam applies.
 */
export function dailyWordLanguages(os: string = Platform.OS): readonly string[] {
  return os !== "web" && isStoreBuild() ? LAUNCHED_DAILY_WORD_LANGUAGES : ALL_DAILY_WORD_LANGUAGES;
}

/**
 * The puzzle language: the app language's base code when this build offers a
 * puzzle in it, else "en". The one place puzzle and keyboard language is chosen.
 * (`languageOf` needs a `t`, which this non-React helper doesn't have.)
 */
export function getLanguage(os: string = Platform.OS): string {
  const base = (i18n.language ?? "").split("-")[0] ?? "";
  return dailyWordLanguages(os).includes(base) ? base : "en";
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
 * Fetch and cache today's puzzle metadata unless already cached, and the
 * puzzles ahead for offline play (`warmUpcoming`, #3230: offline-playable
 * languages only, skipped once fetched today). Best-effort: every failure is
 * swallowed (httpClient reports what is worth reporting).
 */
export async function warmTodayMeta(
  tzOffset: number = getTimezoneOffset(),
  lang: string = getLanguage()
): Promise<void> {
  await Promise.all([warmTodayMetaOnly(tzOffset, lang), warmUpcoming(tzOffset, lang)]);
}

async function warmTodayMetaOnly(tzOffset: number, lang: string): Promise<void> {
  try {
    const dateKey = localDateKey(tzOffset, lang);
    if (await loadTodayMeta(dateKey)) return;
    await saveTodayMeta(dateKey, await dailyWordApi.getToday(tzOffset, lang));
  } catch {
    // Warming is an optimisation only.
  }
}
