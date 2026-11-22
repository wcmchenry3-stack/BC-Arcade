/**
 * Plays one seeded Cascade game on the real engine and records it as the screen does (#3858):
 * the queue drawn from the game's queue seed, the engine on its engine seed, a sim bot's taps
 * gated by `canDrop()`, each drop at `quantizeX(x)` logged at the engine's step, every step's
 * merge and danger events logged, a unit handed over every 30 drops and the last one at the end.
 *
 * Frames are irregular on purpose (60 and 120 Hz, a long frame now and then), as on a device:
 * the recording is keyed to fixed steps, so a rebuild at one step per call must match it anyway.
 */
import type { EnqueueEventInput } from "../../../_shared/gameEventClient";
import { GameRecorder } from "../../../_shared/gameRecorder";
import { CascadeEngine, type PieceSnapshot } from "../../engine";
import { advanceQueue, createSeededRng, makeQueue } from "../../pieceQueue";
import {
  createCascadeLog,
  logEngineEvents,
  quantizeX,
  startedData,
  type CascadeEndData,
  type CascadeRecordSink,
  type CascadeSeeds,
  type CascadeStarted,
} from "../../replay";
import { DROUGHT_WINDOW } from "../../spawnSelector";
import { isInDanger } from "../../useCascadeTestSeams";
import { DEFAULT_CONSTANTS, streamRng } from "../../sim/config";
import type { Bot } from "../../sim/bots";
import { SETTLE_SPEED_PX_S } from "../../sim/runGame";

export interface RecordedGameOptions {
  readonly seeds: CascadeSeeds;
  readonly bot: Bot;
  /** The bot's own RNG stream seed. */
  readonly botSeed: number;
  /** The game stops (abandoned) here if it has not ended, simulated ms. */
  readonly maxSimMs: number;
  readonly pieceSet?: string;
  /** The app goes to the background after this many drops: the waiting unit is handed over. */
  readonly backgroundAfterDrops?: number;
  /** Called then, after the log handed its unit over (the recorder's `flush`). */
  readonly onBackground?: () => void;
}

export interface RecordedGame {
  readonly started: CascadeStarted;
  readonly end: CascadeEndData;
  readonly score: number;
  readonly drops: number;
  readonly merges: number;
  readonly outcome: "win" | "loss" | null;
  readonly simMs: number;
}

/** Frame `i`'s length: mostly 60 Hz, every third at 120 Hz, a 45 ms hitch every 50th. */
export function frameMs(i: number): number {
  if (i % 50 === 49) return 45;
  return i % 3 === 0 ? 1000 / 120 : 1000 / 60;
}

const speedPxS = (p: PieceSnapshot) =>
  Math.hypot(p.vx, p.vy) * (1000 / DEFAULT_CONSTANTS.fixedStepMs);

/** Plays the game into `sink`. The caller closes nothing: the last unit is handed over here. */
export function playRecordedGame(sink: CascadeRecordSink, opts: RecordedGameOptions): RecordedGame {
  const { seeds, bot } = opts;
  const started = startedData(opts.pieceSet ?? "fruits", seeds);
  const log = createCascadeLog(sink);
  log.start();
  const engine = new CascadeEngine({ seed: seeds.engine });
  const queueRng = createSeededRng(seeds.queue);
  const fresh = makeQueue(queueRng);
  let queue = fresh.queue;
  let history = fresh.history;
  const botRng = streamRng(opts.botSeed, "bot");

  let t = 0;
  let frame = 0;
  let nextTapAt = 0;
  let lastDropT = 0;
  let calmSince: number | null = null;
  let drops = 0;
  let merges = 0;
  let outcome: "win" | "loss" | null = null;
  try {
    while (t < opts.maxSimMs && outcome === null) {
      const state = engine.getState();
      const calm = state.pieces.every((p) => speedPxS(p) < SETTLE_SPEED_PX_S);
      if (!calm) calmSince = null;
      else if (calmSince === null) calmSince = t;
      if (t >= nextTapAt) {
        const view = {
          tier: queue.current,
          pieces: state.pieces,
          constants: DEFAULT_CONSTANTS,
          rng: botRng,
          nowMs: t,
          canDrop: engine.canDrop(),
          sinceDropMs: t - lastDropT,
          calmForMs: calmSince === null ? 0 : t - calmSince,
        };
        if (!bot.shouldTap || bot.shouldTap(view)) {
          if (view.canDrop) {
            const tier = queue.current;
            queue = advanceQueue(queue, history, isInDanger(state), queueRng);
            history = [...history, queue.next].slice(-DROUGHT_WINDOW);
            const x = quantizeX(bot.chooseX(view));
            log.drop(engine.steps, x, tier);
            engine.drop(tier, x);
            drops += 1;
            lastDropT = t;
            if (drops === opts.backgroundAfterDrops) {
              log.close();
              opts.onBackground?.();
            }
          }
          nextTapAt = t + bot.nextDelayMs(botRng);
        }
      }
      const ms = frameMs(frame);
      frame += 1;
      t += ms;
      const { events } = engine.step(ms);
      logEngineEvents(log, events);
      for (const ev of events) {
        if (ev.type === "merge") merges += 1;
        else if (ev.type === "win") outcome = "win";
        else if (ev.type === "gameOver") outcome = "loss";
      }
    }
    log.close();
    return {
      started,
      end: log.endData(engine.steps),
      score: engine.getState().score,
      drops,
      merges,
      outcome,
      simMs: t,
    };
  } finally {
    engine.destroy();
  }
}

/** A recorder that saves into `saves` (one batch per save), its idle work run at once. */
export function recorderInto(
  saves: EnqueueEventInput[][],
  now: () => number = (() => {
    let ms = 0;
    return () => (ms += 1500);
  })()
): GameRecorder<"cascade"> {
  const recorder = new GameRecorder<"cascade">({
    gameType: "cascade",
    now,
    sink: {
      canAccept: () => true,
      enqueueMany: (batch) => {
        saves.push([...batch]);
        return true;
      },
    },
    schedule: (task) => task(),
    report: (r) => {
      throw new Error(`the recorder dropped events: ${JSON.stringify(r)}`);
    },
  });
  recorder.startSession();
  return recorder;
}
