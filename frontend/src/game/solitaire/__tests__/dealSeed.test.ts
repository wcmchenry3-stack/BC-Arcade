/**
 * Solitaire deal seed in `game_started` (#3281): the recorded seed (+ draw mode)
 * rebuilds the identical opening.
 */
import seedsJson from "../seeds.json";
import { dealEventData, dealGame, drawDealSeed, ENGINE_VERSION, setRng } from "../engine";
import { createSeededRng } from "../../_shared/seededRng";
import type { DrawMode } from "../types";

afterEach(() => setRng(Math.random));

describe.each([1, 3] as DrawMode[])("solitaire draw-%i deal seed", (drawMode) => {
  it("re-deals the identical opening from the recorded event data", () => {
    setRng(createSeededRng(drawMode * 977));
    const pick = drawDealSeed(drawMode);
    const dealt = dealGame(drawMode, pick.seed);
    const data = dealEventData(drawMode, pick) as {
      seed: number;
      draw_mode: DrawMode;
    };

    const rebuilt = dealGame(data.draw_mode, data.seed);
    expect(rebuilt).toEqual(dealt);
    expect(rebuilt.tableau).toEqual(dealt.tableau);
    expect(rebuilt.stock).toEqual(dealt.stock);
  });

  it("records the seed, its bank index, the draw mode and the engine version", () => {
    const pick = drawDealSeed(drawMode);
    const data = dealEventData(drawMode, pick);
    const bank = drawMode === 1 ? seedsJson.draw1 : seedsJson.draw3;
    expect(data).toEqual({
      draw_mode: drawMode,
      engine_version: ENGINE_VERSION,
      seed: pick.seed,
      seed_index: pick.index,
    });
    expect(bank[pick.index]).toBe(pick.seed);
    expect(JSON.stringify(data).length).toBeLessThan(100);
  });

  it("draws the same seed a bare dealGame would", () => {
    setRng(createSeededRng(5));
    const bare = dealGame(drawMode);
    setRng(createSeededRng(5));
    expect(dealGame(drawMode, drawDealSeed(drawMode).seed)).toEqual(bare);
  });

  it("leaves the seed out when it is unknown (a restored save)", () => {
    expect(dealEventData(drawMode)).toEqual({
      draw_mode: drawMode,
      engine_version: ENGINE_VERSION,
    });
  });
});
