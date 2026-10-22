/**
 * The Playwright Hearts specs seed saves into localStorage; `loadGame` discards
 * one that fails the integrity suite (#2224), which would leave a spec waiting
 * on a screen that never appears. Guard the shared e2e fixtures here, where a
 * bad one fails fast in jest instead of in the browser job.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as fixtures from "../../../../../e2e/tests/helpers/heartsFixtures";
import { detectMoon } from "../engine";
import { checkHeartsIntegrity } from "../integrity";
import { loadGame } from "../storage";
import type { HeartsState } from "../types";

const SEEDED: [string, Record<string, unknown>][] = [
  ["difficulty-select game over", fixtures.DIFFICULTY_GAME_OVER_STATE],
  ["difficulty-select v2 save", fixtures.DIFFICULTY_V2_STATE],
  ["leaderboard game over", fixtures.LEADERBOARD_GAME_OVER_STATE],
  ["leaderboard last trick", fixtures.LEADERBOARD_LAST_TRICK_STATE],
  ["shoot-the-moon near moon", fixtures.NEAR_MOON_STATE],
];

describe("e2e Hearts fixtures pass the on-load integrity check (#2224)", () => {
  it.each(SEEDED)("%s: no integrity findings", (_name, state) => {
    expect(checkHeartsIntegrity(state as unknown as HeartsState)).toEqual([]);
  });

  it.each(SEEDED)("%s: loadGame accepts it", async (_name, state) => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(state));
    expect(await loadGame()).not.toBeNull();
  });

  it("the finished-game fixtures hold no accidental moon", () => {
    for (const s of [
      fixtures.DIFFICULTY_GAME_OVER_STATE,
      fixtures.LEADERBOARD_GAME_OVER_STATE,
      fixtures.LEADERBOARD_LAST_TRICK_STATE,
    ]) {
      expect(detectMoon(s.wonCards as unknown as HeartsState["wonCards"])).toBeNull();
    }
  });

  it("near-moon fixture: only the human pile holds point cards, so the last heart clinches the moon", () => {
    const { wonCards, playerHands } = fixtures.NEAR_MOON_STATE;
    const isPoint = (c: { suit: string; rank: number }) =>
      c.suit === "hearts" || (c.suit === "spades" && c.rank === 12);
    for (const pile of wonCards.slice(1)) expect(pile.some(isPoint)).toBe(false);
    expect(wonCards[0]!.filter(isPoint)).toHaveLength(13);
    expect(playerHands[0]).toEqual([{ suit: "hearts", rank: 1 }]);
  });
});
