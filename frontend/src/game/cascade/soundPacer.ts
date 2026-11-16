/**
 * Cascade sound pacing (#3702): what plays when, timed to the motion (`motion.ts`) and paced the
 * way the haptics are (`haptics.ts`).
 *
 *   - drop: as the piece leaves the spawner;
 *   - land: the light file for tiers 0-4, the heavy one for 5-10, louder with the tier. Landings
 *     within `MOTION.sound.landGapMs` of the last are one sound: the highest tier among them;
 *   - merge: the pre-pitched file of the tier it made. A chain link (2, 3, …) plays its merge and
 *     its chain step together on the counter's paced steps (`MOTION.chain.stepMs`), as the chain
 *     haptics do; at most `maxQueued` links wait (a link's merge and step are one), more are
 *     dropped. A merge of the same tier due within `sameMergeMs` of the last one is skipped (two
 *     pairs of the same tier merging in one step are one sound, not a flam);
 *   - danger: one tick per on-beat of the lid's blink. The board's UI-thread frame callback steps
 *     the blink's phase and calls `dangerOnset` when an on-beat starts (`useBoardMotion`), so the
 *     tick and the blink share one phase. Under Reduce Motion there is no blink (#3701), so the
 *     tick keeps its own timer at the period the blink would have (`dangerPeriodMs`): the sound
 *     still warns, with no frame callback. Either way at least `DANGER_TICK_MIN_GAP_MS` apart
 *     (never above 3 Hz), louder as the count runs;
 *   - win: at the winning merge, its chord as the celebration's card shows (2.1 s); under Reduce
 *     Motion the card comes 0.5 s sooner, so the file starts 0.5 s in;
 *   - game over: at the game over, its chord as the loss card shows (`gameOver.cardAtMs`).
 *     Merges and chain steps still waiting are dropped.
 *
 * Every sound is played from a timer, never from inside the frame that found the event, and
 * nothing but the end sounds plays while `quiet` (a restored game settling, a test fast-forward):
 * the screen passes the same flag its haptics use. The win and the game over end play, so they
 * are never quiet. Mute is the player's concern (`useCascadeSounds`). The rare sounds are
 * pre-warmed before they can play: danger and game over when the count first runs.
 */
import { CELEBRATION_CARD_MS, CELEBRATION_CARD_MS_REDUCED } from "./celebration";
import { MOTION, dangerPeriodMs } from "./motion";
import { chainSound, dangerVolume, landSound, mergeSound, type CascadeSoundName } from "./sounds";

export interface SoundPacerDeps {
  now(): number;
  schedule(run: () => void, delayMs: number): void;
  /** Plays `name` at `volume`, `fromSeconds` into the file. */
  play(name: CascadeSoundName, volume: number, fromSeconds: number): void;
  /** Creates a rare sound's player ahead of its first play. */
  prewarm(name: CascadeSoundName): void;
  /** Stops `name` if it is playing. */
  stop(name: CascadeSoundName): void;
}

export interface SoundPacer {
  drop(): void;
  land(tier: number): void;
  /** A merge that made `tier`; `link` is its place in the drop's chain (1 = a plain merge). */
  merge(tier: number, link: number): void;
  /** The lid count after a step, and whether play is quiet. Called each frame: no sound here. */
  danger(ratio: number, quiet: boolean): void;
  /** The board's blink started an on-beat (from its UI-thread frame callback). */
  dangerOnset(): void;
  /** Reduce Motion: no blink, so the danger tick keeps its own time; the win starts later in. */
  setCalm(calm: boolean): void;
  /** The screen is covered or backgrounded (`usePauseWhileAway`): no danger ticks until back. */
  setAway(away: boolean): void;
  win(): void;
  gameOver(): void;
  /** A new game: drop what is waiting, stop the end sounds, forget the chain and the gaps. */
  reset(): void;
}

/** The shortest gap between two danger ticks, ms (the blink's 3 Hz ceiling, WCAG 2.3.1). */
export const DANGER_TICK_MIN_GAP_MS = 1000 / MOTION.danger.maxHz;

/** How far into the win file to start under Reduce Motion, s: its card comes that much sooner. */
export const CALM_WIN_OFFSET_S = (CELEBRATION_CARD_MS - CELEBRATION_CARD_MS_REDUCED) / 1000;

/**
 * Plays sounds from timers. `run` is dropped if `drop()` came before it was due; `counted` sounds
 * (merges and chain steps) take a slot, and at most `MOTION.sound.maxQueued` wait.
 */
function createLaterQueue(schedule: SoundPacerDeps["schedule"]) {
  let generation = 0;
  let queued = 0;
  return {
    later(run: () => void, delayMs: number, counted: boolean): void {
      if (counted) {
        if (queued >= MOTION.sound.maxQueued) return;
        queued++;
      }
      const gen = generation;
      schedule(
        () => {
          if (gen !== generation) return;
          if (counted) queued--;
          run();
        },
        Math.max(0, delayMs)
      );
    },
    /** Drops everything still waiting. */
    drop(): void {
      generation++;
      queued = 0;
    },
  };
}

export function createSoundPacer(deps: SoundPacerDeps): SoundPacer {
  const S = MOTION.sound;
  const queue = createLaterQueue(deps.schedule);
  const later = queue.later;
  let lastLand = -Infinity;
  let lastLandTier = -1;
  let pendingLand: { tier: number } | null = null;
  let chainStart = 0;
  let lastMerge = { tier: -1, at: -Infinity };
  let ratio = 0;
  let quiet = false;
  let calm = false;
  let away = false;
  let warmed = false;
  let lastTick = -Infinity;
  let calmSeq = 0;
  let calmTimer = 0; // the running calm ticker's token: 0 (or a newer one) stops the old chain

  function tick(): void {
    if (!(ratio > 0) || quiet || away) return;
    const now = deps.now();
    if (now - lastTick < DANGER_TICK_MIN_GAP_MS) return;
    lastTick = now;
    const volume = dangerVolume(ratio);
    later(() => deps.play("danger", volume, 0), 0, false);
  }

  /** Stops the calm ticker's chain, then starts a fresh one if it should run. */
  function restartCalmTicker(): void {
    calmTimer = 0;
    runCalmTicker();
  }

  /** Under Reduce Motion: a tick every blink period while the count runs. */
  function runCalmTicker(): void {
    if (!calm || away || !(ratio > 0) || calmTimer !== 0) return;
    const token = ++calmSeq;
    calmTimer = token;
    const step = () => {
      if (calmTimer !== token) return;
      if (!calm || away || !(ratio > 0)) {
        calmTimer = 0;
        return;
      }
      tick();
      deps.schedule(step, dangerPeriodMs(ratio));
    };
    // The blink starts on an off-beat: its first on-beat is half a period in.
    deps.schedule(step, dangerPeriodMs(ratio) * MOTION.danger.duty);
  }

  return {
    drop() {
      later(() => deps.play("drop", 1, 0), 0, false);
    },
    land(tier) {
      if (pendingLand) {
        pendingLand.tier = Math.max(pendingLand.tier, tier);
        return;
      }
      const now = deps.now();
      if (now - lastLand < S.landGapMs && tier <= lastLandTier) return;
      lastLand = now;
      const pending = { tier };
      pendingLand = pending;
      later(
        () => {
          pendingLand = null;
          lastLandTier = pending.tier;
          const { name, volume } = landSound(pending.tier);
          deps.play(name, volume, 0);
        },
        0,
        false
      );
    },
    merge(tier, link) {
      const now = deps.now();
      const chain = chainSound(link);
      if (chain !== null && link === 2) chainStart = now;
      const due = chain === null ? now : chainStart + (link - 2) * MOTION.chain.stepMs;
      const same = tier === lastMerge.tier && Math.abs(due - lastMerge.at) < S.sameMergeMs;
      if (same && chain === null) return;
      lastMerge = { tier, at: due };
      const merge = mergeSound(tier);
      later(
        () => {
          if (!same) deps.play(merge, 1, 0);
          if (chain !== null) deps.play(chain, 1, 0);
        },
        due - now,
        true
      );
    },
    danger(r, q) {
      const next = r > 0 ? r : 0;
      quiet = q;
      if (next === ratio) return;
      ratio = next;
      if (ratio > 0 && !warmed) {
        warmed = true;
        later(
          () => {
            deps.prewarm("danger");
            deps.prewarm("game-over");
          },
          0,
          false
        );
      }
      runCalmTicker();
    },
    dangerOnset() {
      if (!calm) tick();
    },
    setCalm(c) {
      if (c === calm) return;
      calm = c;
      restartCalmTicker();
    },
    setAway(a) {
      if (a === away) return;
      away = a; // away: the calm ticker stops; back: the count picks up where it was
      restartCalmTicker();
    },
    win() {
      const from = calm ? CALM_WIN_OFFSET_S : 0;
      later(() => deps.play("win", 1, from), 0, false);
    },
    gameOver() {
      queue.drop();
      pendingLand = null;
      later(() => deps.play("game-over", 1, 0), 0, false);
    },
    reset() {
      queue.drop();
      pendingLand = null;
      lastLand = -Infinity;
      lastLandTier = -1;
      lastMerge = { tier: -1, at: -Infinity };
      lastTick = -Infinity;
      ratio = 0;
      warmed = false;
      calmTimer = 0;
      deps.stop("win");
      deps.stop("game-over");
    },
  };
}
