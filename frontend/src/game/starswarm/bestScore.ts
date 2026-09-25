import AsyncStorage from "@react-native-async-storage/async-storage";

/** Star Swarm's best score, kept across app restarts (#2516). */
const BEST_SCORE_KEY = "starswarm.bestScore";

export async function loadBestScore(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(BEST_SCORE_KEY);
    const n = raw === null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export async function saveBestScore(score: number): Promise<void> {
  try {
    await AsyncStorage.setItem(BEST_SCORE_KEY, String(Math.floor(score)));
  } catch {
    // Best-effort: the in-memory best still shows this session.
  }
}
