/**
 * Blackjack replay recording benchmark (#3284, epic #3273): a seeded run of
 * ROUNDS rounds (hits, doubles and splits by a fixed strategy) is played through
 * the real context, engine and GameRecorder, and saved over the real
 * GameEventClient -> EventStore -> AsyncStorage mock. Compared with the same
 * run saved the way the context did before (one storage-writing `enqueueEvent`
 * per event, in the old payload shapes), with an idle moment between events
 * (the worst case for the old path: nothing coalesces).
 *
 * Counts are hard budgets: the run is seeded and deterministic. The numbers are
 * printed and recorded in docs/games/blackjack.md ("Replay recording"). Run it
 * on its own with
 *   cd frontend && npx jest src/game/blackjack/__tests__/replay.bench.test.tsx
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";
import { act, renderHook } from "@testing-library/react-native";

import { BugReportLimiter } from "../../_shared/bugReportLimiter";
import { recordingConfigFor, resetLogConfig } from "../../_shared/eventQueueConfig";
import { EventStore } from "../../_shared/eventStore";
import { GameEventClientImpl, type EnqueueEventInput } from "../../_shared/gameEventClient";
import { PendingGamesStore } from "../../_shared/pendingGamesStore";
import type { ProgressSnapshot } from "../../_shared/useGameSync";
import { BlackjackGameProvider, useBlackjackGame } from "../BlackjackGameContext";
import {
  canSplit,
  createSeededRng,
  doubleDown,
  handValue,
  hit,
  newGame,
  newHand,
  placeBet,
  setRng,
  split,
  stand,
  type Card,
  type EngineState,
} from "../engine";
import { loadGame } from "../storage";

jest.mock("../storage", () => ({
  loadGame: jest.fn().mockResolvedValue(null),
  saveGame: jest.fn(),
  clearGame: jest.fn(),
  saveRun: jest.fn().mockResolvedValue(undefined),
  loadRuns: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../../entitlements/premiumLevels", () => ({ isPremiumLevel: () => false }));
jest.mock("../../_shared/lastDifficulty", () => ({ saveLastDifficulty: jest.fn() }));

// The game session is faked; its save goes where the test points it.
let mockSink: (events: EnqueueEventInput[]) => void = () => undefined;
jest.mock("../../_shared/useGameSync", () => ({
  useGameSync: () => ({
    start: jest.fn(),
    resume: () => false,
    markStarted: jest.fn(),
    enqueue: jest.fn(),
    enqueueMany: (events: EnqueueEventInput[]) => {
      mockSink(events);
      return true;
    },
    complete: jest.fn(),
    close: jest.fn(),
    setProgressSnapshot: (_g: () => ProgressSnapshot) => undefined,
    getGameId: () => "game-1",
    resetPlayWindow: jest.fn(),
  }),
}));

const ROUNDS = 300;

const idleTasks: (() => void)[] = [];
beforeEach(() => {
  idleTasks.length = 0;
  (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = (cb: () => void) => {
    idleTasks.push(cb);
    return idleTasks.length;
  };
});
afterEach(() => {
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  resetLogConfig();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

async function newClient() {
  await AsyncStorage.clear();
  resetLogConfig();
  const store = new EventStore();
  const client = new GameEventClientImpl(store, new PendingGamesStore(), new BugReportLimiter());
  await client.init();
  const gameId = client.startGame("blackjack");
  client.markStarted(gameId);
  await settle();
  return { store, client, gameId };
}

/** A fixed strategy: split 8s and aces, double 10 and 11, hit under 17. */
function decide(s: EngineState): { fn: (e: EngineState) => EngineState; hint: string } {
  const hand: readonly Card[] =
    s.split_count > 0 ? (s.player_hands[s.active_hand_index] ?? s.player_hand) : s.player_hand;
  const total = handValue(hand);
  if (hand.length === 2 && hand[0]!.rank === hand[1]!.rank && canSplit(s)) {
    if (hand[0]!.rank === "8" || hand[0]!.rank === "A") return { fn: split, hint: "split" };
  }
  if (hand.length === 2 && (total === 10 || total === 11) && s.chips >= s.bet * 4) {
    return { fn: doubleDown, hint: "double" };
  }
  return total < 17 ? { fn: hit, hint: "hit" } : { fn: stand, hint: "stand" };
}

interface Run {
  /** What the recorder saved, per save call. */
  saves: EnqueueEventInput[][];
  rounds: number;
}

/** Plays ROUNDS rounds through the real provider, with an idle moment after each. */
async function playRun(): Promise<Run> {
  setRng(createSeededRng(3284));
  const saves: EnqueueEventInput[][] = [];
  mockSink = (events) => {
    saves.push([...events]);
  };
  (loadGame as jest.Mock).mockResolvedValueOnce(
    newGame(undefined, { startingChips: 100_000, runGoal: null, betMin: 5, betMax: 25 })
  );
  const hook = await renderHook(() => useBlackjackGame(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <BlackjackGameProvider>{children}</BlackjackGameProvider>
    ),
  });
  await act(async () => {});
  const apply = async (fn: (e: EngineState) => EngineState, hint: string | null = null) => {
    await act(async () => {
      hook.result.current.apply(fn, hint as never);
    });
  };
  for (let round = 0; round < ROUNDS; round += 1) {
    await apply((s) => placeBet(s, 10));
    while (hook.result.current.engine!.phase === "player") {
      const { fn, hint } = decide(hook.result.current.engine!);
      await apply(fn, hint);
    }
    await act(async () => {
      while (idleTasks.length > 0) idleTasks.shift()!(); // the idle moment after the round
    });
    await apply(newHand);
  }
  await hook.unmount();
  return { saves, rounds: ROUNDS };
}

interface Measured {
  /** Calls into the queue (`EventStore.enqueueEvent` / `enqueueMany`). */
  saves: number;
  /** AsyncStorage writes of any key while the run was saved. */
  storageWrites: number;
  storageBytes: number;
  events: number;
  /** JSON length of every event's `data`. */
  recordedBytes: number;
}

async function measure(save: (client: GameEventClientImpl, gameId: string) => Promise<number>) {
  const { store, client, gameId } = await newClient();
  const saveEvent = jest.spyOn(store, "enqueueEvent");
  const saveMany = jest.spyOn(store, "enqueueMany");
  const setItem = AsyncStorage.setItem as jest.Mock;
  setItem.mockClear();
  const recordedBytes = await save(client, gameId);
  await settle();
  const writes = setItem.mock.calls as [string, string][];
  return {
    saves: saveEvent.mock.calls.length + saveMany.mock.calls.length,
    storageWrites: writes.length,
    storageBytes: writes.reduce((n, [, v]) => n + v.length, 0),
    recordedBytes,
  };
}

const RANK_VALUE: Record<string, number> = { T: 10, J: 10, Q: 10, K: 10, A: 11 };
const total = (cards: readonly string[]) => {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    sum += RANK_VALUE[c[0]!] ?? Number(c[0]);
    if (c[0] === "A") aces += 1;
  }
  while (sum > 21 && aces > 0) {
    sum -= 10;
    aces -= 1;
  }
  return sum;
};
const SUIT = { S: "♠", H: "♥", D: "♦", C: "♣" } as const;
const asCard = (code: string) => ({
  rank: code[0] === "T" ? "10" : code[0]!,
  suit: SUIT[code[1] as keyof typeof SUIT],
});

/**
 * The events as the context sent them before #3284, rebuilt from the recorded
 * ones: the same moments, the old payload shapes, one row per bet, deal and
 * action. The dealer's play was not recorded.
 */
function oldShape(events: readonly EnqueueEventInput[]): EnqueueEventInput[] {
  const out: EnqueueEventInput[] = [];
  for (const e of events) {
    const d = e.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (e.type === "round_played") {
      const hands: string[][] = [[...d.p]];
      out.push({
        type: "bet_placed",
        data: { amount: d.b[0], chips_remaining: d.b[1] - d.b[0] },
      });
      out.push({
        type: "hand_dealt",
        data: {
          player_hand: d.p.map(asCard),
          dealer_up_card: asCard(d.d[0]),
          is_player_blackjack: total(d.p) === 21,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [code, i, extra] of (d.a ?? []) as [string, number, any][]) {
        // eslint-disable-line @typescript-eslint/no-explicit-any
        if (code === "h" || code === "d") hands[i]!.push(extra);
        if (code === "p") hands.splice(i, 1, extra[0], extra[1]);
        out.push({
          type: "player_action",
          data: {
            action: { h: "hit", s: "stand", d: "double", p: "split" }[code],
            hand_index: i,
            hand_value_after: total(hands[i]!),
          },
        });
      }
    } else if (e.type === "hand_resolved") {
      out.push({
        type: "hand_resolved",
        data: { hand_index: d.i, outcome: d.o, payout_delta: d.p, chips_after: d.ch },
      });
    }
  }
  return out;
}

describe("Blackjack replay recording benchmark (#3284)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(`a ${ROUNDS}-round run: one save per round, far fewer writes than one per event`, async () => {
    const run = await playRun();
    const recorded = run.saves.flat();
    const old = oldShape(recorded);

    // Before: one `enqueueEvent` (one storage-writing save) per event, an idle moment apart.
    const before: Measured = {
      ...(await measure(async (client, gameId) => {
        let bytes = 0;
        for (const e of old) {
          bytes += JSON.stringify(e.data ?? {}).length;
          client.enqueueEvent(gameId, e);
          await settle();
        }
        return bytes;
      })),
      events: old.length,
    };
    // After: the recorder's saves, one `enqueueEvents` per round.
    const after: Measured = {
      ...(await measure(async (client, gameId) => {
        let bytes = 0;
        for (const save of run.saves) {
          for (const e of save) bytes += JSON.stringify(e.data ?? {}).length;
          client.enqueueEvents(gameId, save);
          await settle();
        }
        return bytes;
      })),
      events: recorded.length,
    };
    const perRound = after.recordedBytes / ROUNDS;
    // What the server's per-game cap (BLACKJACK_CAP) counts: the replay-tier rows, each with
    // the 200 B row overhead. hand_resolved is a lifecycle row with its own cap.
    const replayRows = recorded.filter((e) => e.type !== "hand_resolved");
    const replayBytes = replayRows.reduce(
      (n, e) => n + JSON.stringify(e.data ?? {}).length + 200,
      0
    );
    process.stdout.write(
      `[bench #3284] blackjack, ${ROUNDS} rounds: before ${before.saves} saves, ${before.storageWrites} storage writes, ` +
        `${before.storageBytes} B written, ${before.events} events / ${before.recordedBytes} B recorded; ` +
        `after ${after.saves} saves, ${after.storageWrites} storage writes, ${after.storageBytes} B written, ` +
        `${after.events} events / ${after.recordedBytes} B recorded (${perRound.toFixed(0)} B JSON per round, ` +
        `${(after.events / ROUNDS).toFixed(2)} events per round); server cap counts ` +
        `${(replayRows.length / ROUNDS).toFixed(2)} rows and ${(replayBytes / ROUNDS).toFixed(0)} B per round\n`
    );

    // Structural counts: one save per round, nothing saved mid-round.
    expect(run.saves).toHaveLength(ROUNDS);
    expect(after.saves).toBe(ROUNDS);
    expect(before.saves).toBe(old.length);

    // Fewer saves and storage writes than one per event (the old path), by about the events in a round.
    expect(after.saves).toBeLessThan(before.saves / 3);
    expect(after.storageWrites).toBeLessThan(before.storageWrites / 2);

    // More is recorded now (the cards, the dealer), so bytes grow; they stay inside the run's cap.
    expect(after.recordedBytes).toBeLessThan(recordingConfigFor("blackjack").sessionMaxBytes);
    expect(perRound).toBeLessThan(400);
    // One replay row per round on the server, and its cap holds a run of 1,000 such rounds.
    expect(replayRows.length).toBe(ROUNDS);
    expect(replayBytes / ROUNDS).toBeLessThan(560_000 / 1_000);
  }, 300_000);
});
