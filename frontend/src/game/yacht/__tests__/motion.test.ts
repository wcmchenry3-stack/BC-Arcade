/**
 * Yacht motion (#3749): every timing stays under its story ceiling, so the game never feels slow,
 * and the sounds (#3750) can be timed to the same numbers.
 */
import {
  BONUS_PULSE_MS,
  BONUS_PULSE_SCALE,
  CPU_HOLD_MS,
  CPU_JACKPOT_SOUND_MS,
  CPU_LAST_TURN_SPEED,
  CPU_REDUCED_MOTION_SPEED,
  CPU_SCORE_BEAT_MS,
  CPU_SETTLE_MS,
  HOLD_MS,
  INPUT_LOCK_FALLBACK_MS,
  JACKPOT_BADGE_FADE_OUT_MS,
  JACKPOT_DONE_MS,
  JACKPOT_EXIT_AT_MS,
  JACKPOT_PARTICLE_FADE_OUT_MS,
  JACKPOT_REDUCED_DONE_MS,
  JACKPOT_WAIT_MAX_MS,
  LOSS_BEAT_MS,
  SCORE_POP_MS,
  SCORE_POP_SCALE,
  TIE_BEAT_MS,
  TOTAL_COUNT_MS,
  TUMBLE_FACE_MS,
  TUMBLE_HOP_PX,
  TUMBLE_HOP_SHARE,
  TUMBLE_LAND_AT,
  TUMBLE_MS,
  TUMBLE_SPIN_SHARE,
  TUMBLE_SQUASH_SCALE,
  TUMBLE_STAGGER_MS,
  WIN_BEAT_MS,
  cpuRollMs,
  cpuTurnMaxMs,
  cpuTurnSpeed,
  endBeatMs,
  inputLockMaxMs,
  tumbleTotalMs,
} from "../motion";

// The story's ceilings (#3749), kept here rather than exported from the module.
const CEILING = {
  tumble: 450,
  // The roll sound settles at about 0.42 s: the first die lands with it.
  rollSound: 420,
  rollOfFive: 600,
  stagger: 40,
  hold: 200,
  scorePop: 300,
  totalCount: 350,
  bonusPulse: 500,
  cpuTurn: 5000,
  winBeat: 1000,
  lossBeat: 600,
  // The computer's yacht / joker sound (0.7 s), which a last-score end beat waits for.
  cpuJackpotSound: 700,
};

describe("Yacht motion", () => {
  it("a tumble settles with the roll sound, and five dice are at rest by 0.6 s", () => {
    expect(TUMBLE_MS).toBeLessThanOrEqual(CEILING.tumble);
    expect(TUMBLE_MS).toBeLessThanOrEqual(CEILING.rollSound);
    expect(TUMBLE_STAGGER_MS).toBeLessThanOrEqual(CEILING.stagger);
    expect(tumbleTotalMs(5)).toBe(TUMBLE_MS + 4 * TUMBLE_STAGGER_MS);
    expect(tumbleTotalMs(5)).toBeLessThanOrEqual(CEILING.rollOfFive);
  });

  it("only the dice rolled count: the lock is the tumble plus their stagger, none for no dice", () => {
    expect(tumbleTotalMs(0)).toBe(0);
    expect(tumbleTotalMs(1)).toBe(TUMBLE_MS);
    expect(tumbleTotalMs(2)).toBe(TUMBLE_MS + TUMBLE_STAGGER_MS);
    // More than five never adds time.
    expect(tumbleTotalMs(9)).toBe(tumbleTotalMs(5));
  });

  it("the tumble's shape: a full turn, a small hop, faces flicking, then a small squash", () => {
    expect(TUMBLE_SPIN_SHARE).toBeGreaterThan(TUMBLE_LAND_AT);
    expect(TUMBLE_SPIN_SHARE).toBeLessThanOrEqual(1);
    expect(TUMBLE_HOP_SHARE).toBeLessThanOrEqual(TUMBLE_LAND_AT);
    expect(TUMBLE_HOP_PX).toBeLessThanOrEqual(8);
    expect(TUMBLE_HOP_PX).toBeGreaterThanOrEqual(4);
    // A few faces flick past, never faster than about 15 a second.
    expect(TUMBLE_FACE_MS).toBeGreaterThanOrEqual(60);
    expect((TUMBLE_MS * TUMBLE_LAND_AT) / TUMBLE_FACE_MS).toBeGreaterThanOrEqual(3);
    expect(TUMBLE_SQUASH_SCALE).toBeGreaterThan(1);
    expect(TUMBLE_SQUASH_SCALE).toBeLessThanOrEqual(1.1);
  });

  it("the input lock's safety net ends shortly after the tumble should have", () => {
    expect(inputLockMaxMs(0)).toBe(0);
    expect(inputLockMaxMs(5)).toBe(tumbleTotalMs(5) + INPUT_LOCK_FALLBACK_MS);
    expect(INPUT_LOCK_FALLBACK_MS).toBeGreaterThan(0);
    expect(inputLockMaxMs(5)).toBeLessThanOrEqual(900);
  });

  it("a hold is quick", () => {
    expect(HOLD_MS).toBeLessThanOrEqual(CEILING.hold);
  });

  it("a score pops and the total counts up, both quickly; the bonus pulse is short", () => {
    expect(SCORE_POP_MS).toBeLessThanOrEqual(CEILING.scorePop);
    expect(SCORE_POP_SCALE).toBeGreaterThan(1);
    expect(SCORE_POP_SCALE).toBeLessThanOrEqual(1.25);
    expect(TOTAL_COUNT_MS).toBeLessThanOrEqual(CEILING.totalCount);
    expect(BONUS_PULSE_MS).toBeLessThanOrEqual(CEILING.bonusPulse);
    expect(BONUS_PULSE_SCALE).toBeGreaterThan(1);
    expect(BONUS_PULSE_SCALE).toBeLessThanOrEqual(1.4);
  });

  it("the jackpot celebration keeps the timings it had (2.2 s exit, 2.8 s done)", () => {
    expect(JACKPOT_EXIT_AT_MS).toBe(2200);
    expect(JACKPOT_DONE_MS).toBe(2800);
    expect(JACKPOT_EXIT_AT_MS + JACKPOT_BADGE_FADE_OUT_MS).toBeLessThanOrEqual(JACKPOT_DONE_MS);
    expect(JACKPOT_EXIT_AT_MS + JACKPOT_PARTICLE_FADE_OUT_MS).toBeLessThanOrEqual(JACKPOT_DONE_MS);
    expect(JACKPOT_REDUCED_DONE_MS).toBeLessThan(JACKPOT_DONE_MS);
    // The end beat's safety net never cuts a celebration short.
    expect(JACKPOT_WAIT_MAX_MS).toBeGreaterThan(JACKPOT_DONE_MS);
    expect(JACKPOT_WAIT_MAX_MS).toBeLessThanOrEqual(4000);
  });

  it("the computer's steps: a roll is its tumble plus about 150 ms, a hold 500 ms, a score beat 600 ms", () => {
    expect(cpuRollMs(5)).toBe(tumbleTotalMs(5) + CPU_SETTLE_MS);
    expect(CPU_SETTLE_MS).toBe(150);
    expect(CPU_HOLD_MS).toBe(500);
    expect(CPU_SCORE_BEAT_MS).toBe(600);
  });

  it("the computer's longest turn is 5 s or less (it was 8 s)", () => {
    expect(cpuTurnMaxMs()).toBe(
      cpuRollMs(5) + 2 * (CPU_HOLD_MS + cpuRollMs(5)) + CPU_SCORE_BEAT_MS
    );
    expect(cpuTurnMaxMs()).toBeLessThanOrEqual(CEILING.cpuTurn);
  });

  it("its last turn after yours plays at 2x, and Reduce Motion halves its pauses", () => {
    expect(CPU_LAST_TURN_SPEED).toBe(2);
    expect(CPU_REDUCED_MOTION_SPEED).toBe(2);
    expect(cpuTurnSpeed(false, false)).toBe(1);
    expect(cpuTurnSpeed(true, false)).toBe(2);
    expect(cpuTurnSpeed(false, true)).toBe(2);
    expect(cpuTurnSpeed(true, true)).toBe(4);
    expect(cpuTurnMaxMs(cpuTurnSpeed(true, false))).toBe(cpuTurnMaxMs() / 2);
    expect(cpuTurnMaxMs(cpuTurnSpeed(true, false))).toBeLessThanOrEqual(CEILING.cpuTurn / 2);
  });

  it("end beats: a win 1.0 s, a loss and a tie 0.6 s (owner)", () => {
    expect(WIN_BEAT_MS).toBe(CEILING.winBeat);
    expect(LOSS_BEAT_MS).toBe(CEILING.lossBeat);
    expect(TIE_BEAT_MS).toBe(CEILING.lossBeat);
    expect(CPU_JACKPOT_SOUND_MS).toBeLessThanOrEqual(CEILING.cpuJackpotSound);
    expect(endBeatMs("win")).toBe(WIN_BEAT_MS);
    expect(endBeatMs("loss")).toBe(LOSS_BEAT_MS);
    expect(endBeatMs("tie")).toBe(TIE_BEAT_MS);
  });
});
