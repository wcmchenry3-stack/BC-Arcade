/**
 * FreeCell deal seed in `game_started` (#3281): the recorded seed rebuilds the
 * identical opening.
 */
import seedsJson from "../seeds.json";
import { dealEventData, dealGame, drawDealSeed, ENGINE_VERSION, setRng } from "../engine";
import { createSeededRng } from "../../_shared/seededRng";

afterEach(() => setRng(Math.random));

describe("freecell deal seed", () => {
  it("re-deals the identical opening from the recorded event data", () => {
    setRng(createSeededRng(1234));
    const pick = drawDealSeed();
    const dealt = dealGame(pick.seed);
    const data = dealEventData(pick) as { seed: number };

    expect(dealGame(data.seed)).toEqual(dealt);
  });

  it("records the seed, its bank index and the engine version", () => {
    const pick = drawDealSeed();
    const data = dealEventData(pick);
    expect(data).toEqual({
      engine_version: ENGINE_VERSION,
      seed: pick.seed,
      seed_index: pick.index,
    });
    expect(seedsJson.seeds[pick.index]).toBe(pick.seed);
    expect(JSON.stringify(data).length).toBeLessThan(100);
  });

  it("draws the same seed a bare dealGame would", () => {
    setRng(createSeededRng(9));
    const bare = dealGame();
    setRng(createSeededRng(9));
    expect(dealGame(drawDealSeed().seed)).toEqual(bare);
  });

  it("leaves the seed out when it is unknown (a restored save)", () => {
    expect(dealEventData()).toEqual({ engine_version: ENGINE_VERSION });
  });
});
