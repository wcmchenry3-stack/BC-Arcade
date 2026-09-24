/**
 * #2563: the native canvas publishes a frame to React only when something it draws changed.
 */
import { initStarSwarm, tick, CANVAS_W, CANVAS_H } from "../engine";
import { initStarfield, tickStarfield } from "../starfield";
import { sameFrame, starfieldRuns, type FrameInputs } from "../render/publish";

function frame(over: Partial<FrameInputs> = {}): FrameInputs {
  return {
    game: initStarSwarm(CANVAS_W, CANVAS_H),
    sf: initStarfield(CANVAS_W, CANVAS_H),
    countdownDigit: null,
    waveBannerCountdown: false,
    bonusFlash: false,
    ...over,
  };
}

describe("sameFrame", () => {
  it("is true only when every input is identical", () => {
    const a = frame();
    expect(sameFrame(a, { ...a })).toBe(true);
    expect(sameFrame(a, { ...a, game: { ...a.game } })).toBe(false);
    expect(sameFrame(a, { ...a, sf: tickStarfield(a.sf, 16) })).toBe(false);
    expect(sameFrame(a, { ...a, countdownDigit: 3 })).toBe(false);
    expect(sameFrame({ ...a, countdownDigit: 3 }, { ...a, countdownDigit: 2 })).toBe(false);
    expect(sameFrame(a, { ...a, waveBannerCountdown: true })).toBe(false);
    expect(sameFrame(a, { ...a, bonusFlash: true })).toBe(false);
  });

  it("a live tick always changes the frame; a game-over tick never does", () => {
    const live = frame({ game: initStarSwarm(CANVAS_W, CANVAS_H) });
    const next = tick(live.game, 16, { playerX: CANVAS_W / 2, fire: false });
    expect(sameFrame(live, { ...live, game: next })).toBe(false);

    const over = { ...live.game, phase: "GameOver" as const };
    const ticked = tick(over, 16, { playerX: CANVAS_W / 2, fire: true });
    expect(ticked).toBe(over); // the engine short-circuits on GameOver
    const f = frame({ game: over });
    expect(sameFrame(f, { ...f, game: ticked })).toBe(true);
  });
});

describe("starfieldRuns", () => {
  it("scrolls in every live phase and stops when paused or at game over", () => {
    expect(starfieldRuns("SwoopIn", false)).toBe(true);
    expect(starfieldRuns("Playing", false)).toBe(true);
    expect(starfieldRuns("Playing", true)).toBe(false);
    expect(starfieldRuns("SwoopIn", true)).toBe(false);
    expect(starfieldRuns("GameOver", false)).toBe(false);
  });
});
