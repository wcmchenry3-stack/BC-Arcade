/**
 * The outcome guard (#2642) on the killed-session sweep (#2654): a session a
 * killed process left open is closed with the `win` its progress snapshot
 * left on the device (#2682). For a game with no winner that `win` is wrong:
 * the guard in `gameEventClient.completeGame` catches it. The `win` is put on
 * disk directly, as an older build (or a bug that slipped past the hook's own
 * check) would have left it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";

import { BugReportLimiter } from "../bugReportLimiter";
import { EventStore } from "../eventStore";
import { GameEventClientImpl } from "../gameEventClient";
import { OutcomeNotAllowedError, setOutcomeGuardStrictForTests } from "../outcomeGuard";
import { PendingGamesStore } from "../pendingGamesStore";

const DAY = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "pending_games_v1";

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

function newProcess() {
  const games = new PendingGamesStore();
  return {
    games,
    client: new GameEventClientImpl(new EventStore(), games, new BugReportLimiter()),
  };
}

/** A started `gameType` session whose device record says it was won, left open by a kill. */
async function killedWithWin(gameType: string): Promise<string> {
  const { client } = newProcess();
  await client.init();
  const id = client.startGame(gameType);
  client.markStarted(id);
  await flushMicrotasks();
  const raw = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? "{}");
  raw[id].progressOutcome = "win";
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  return id;
}

const captureException = Sentry.captureException as jest.Mock;
const captureMessage = Sentry.captureMessage as jest.Mock;
let now: jest.SpyInstance<number, []>;

beforeEach(async () => {
  await AsyncStorage.clear();
  captureException.mockClear();
  captureMessage.mockClear();
  setOutcomeGuardStrictForTests(null);
  now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
});

afterEach(() => {
  now.mockRestore();
  setOutcomeGuardStrictForTests(null);
});

it("a game with a winner: the sweep records the win", async () => {
  const id = await killedWithWin("blackjack");
  now.mockReturnValue(1_000_000 + DAY);
  const next = newProcess();
  await next.client.init();
  expect(next.games.get(id)?.completeSummary).toEqual({ outcome: "win" });
  expect(captureException).not.toHaveBeenCalled();
});

it("Star Swarm (no winner): in development the sweep fails loudly instead of recording the win", async () => {
  const id = await killedWithWin("starswarm");
  now.mockReturnValue(1_000_000 + DAY);
  const next = newProcess();
  await next.client.init();
  // The sweep's own error handler reports it; nothing is recorded.
  expect(captureException).toHaveBeenCalledWith(
    expect.any(OutcomeNotAllowedError),
    expect.objectContaining({ tags: expect.objectContaining({ op: "sweepPreviousProcess" }) })
  );
  expect(next.games.get(id)?.completeSummary).toBeNull();
});

it("Star Swarm (no winner): resuming another session throws when it abandons the orphan", async () => {
  await killedWithWin("starswarm");
  const next = newProcess();
  await next.client.init(); // under 24 h: kept for its screen to resume
  const fresh = next.client.startGame("starswarm");
  expect(() => next.client.markStarted(fresh)).toThrow(OutcomeNotAllowedError);
});

it("Star Swarm (no winner): in production the sweep sends the win unchanged and reports it once", async () => {
  setOutcomeGuardStrictForTests(false);
  const id = await killedWithWin("starswarm");
  now.mockReturnValue(1_000_000 + DAY);
  const next = newProcess();
  await next.client.init();
  expect(next.games.get(id)?.completeSummary).toEqual({ outcome: "win" });
  expect(captureMessage).toHaveBeenCalledTimes(1);
  expect(captureMessage).toHaveBeenCalledWith(
    expect.stringContaining('starswarm has no winner (has_winner is false) but recorded "win"'),
    expect.objectContaining({
      tags: expect.objectContaining({ path: "client.completeGame" }),
    })
  );
});
