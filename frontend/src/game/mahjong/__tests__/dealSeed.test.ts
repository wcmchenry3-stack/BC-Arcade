/**
 * Mahjong deal seed in `game_started` (#3281): the recorded seed + layout rebuild
 * the identical opening.
 */
import { createGame, dealEventData, drawDealSeed, ENGINE_VERSION, setRng } from "../engine";
import { getLayout, LAYOUTS } from "../layouts/registry";
import { createSeededRng } from "../../_shared/seededRng";

afterEach(() => setRng(Math.random));

describe("mahjong deal seed", () => {
  const layoutIds = LAYOUTS.slice(0, 3).map((l) => l.id);

  it.each(layoutIds)("re-deals the identical %s opening from the recorded event data", (id) => {
    setRng(createSeededRng(4321));
    const seed = drawDealSeed();
    const dealt = createGame(getLayout(id), seed);
    const data = dealEventData(id, seed) as { layout: string; seed: number };

    const rebuilt = createGame(getLayout(data.layout), data.seed);
    expect(rebuilt.tiles).toEqual(dealt.tiles);
    expect(rebuilt.dealId).toBe(dealt.dealId);
  });

  it("records the layout, seed and engine version", () => {
    const seed = drawDealSeed();
    const data = dealEventData("turtle", seed);
    expect(data).toEqual({ layout: "turtle", engine_version: ENGINE_VERSION, seed });
    expect(Number.isInteger(seed)).toBe(true);
    expect(JSON.stringify(data).length).toBeLessThan(100);
  });

  it("draws a 32-bit seed from the RNG slot", () => {
    setRng(() => 0.5);
    expect(drawDealSeed()).toBe(2147483648);
    setRng(() => 0.999999999);
    expect(drawDealSeed()).toBeLessThan(4294967296);
  });

  it("leaves the seed out when it is unknown (a restored save)", () => {
    expect(dealEventData("turtle")).toEqual({ layout: "turtle", engine_version: ENGINE_VERSION });
  });
});
