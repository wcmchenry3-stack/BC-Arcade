/**
 * #2956: the Star Swarm sprite set — `useStarSwarmImages` loads every sprite through Skia's
 * useImage, `loadedSprites` tells the frame builder which have arrived (it draws a fallback for
 * the rest), and `sameDrawImages` decides when the UI-thread picture must be rebuilt.
 */
import { renderHook } from "@testing-library/react-native";
import { useImage } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";

import { drawImagesOf, loadedSprites, sameDrawImages, useStarSwarmImages } from "../assets";
import type { StarSwarmImages } from "../assets";

jest.mock("@shopify/react-native-skia", () => ({ useImage: jest.fn(() => null) }));

const mockUseImage = useImage as unknown as jest.Mock;
const img = (name: string) => ({ name }) as unknown as SkImage;

beforeEach(() => {
  mockUseImage.mockReset();
  mockUseImage.mockReturnValue(null);
});

async function images(): Promise<StarSwarmImages> {
  const { result } = await renderHook(() => useStarSwarmImages());
  return result.current;
}

describe("useStarSwarmImages", () => {
  it("loads 17 sprites and a 20-frame explosion strip, one useImage each", async () => {
    const set = await images();
    expect(mockUseImage).toHaveBeenCalledTimes(37);
    expect(set.explosionFrames).toHaveLength(20);
    expect(set.playerShip).toBeNull();
  });

  it("hands back whatever each useImage call returned, in its slot", async () => {
    let n = 0;
    mockUseImage.mockImplementation(() => img(`i${n++}`));
    const set = await images();
    expect(set.playerShip).toEqual(img("i0"));
    expect(set.asteroid4).toEqual(img("i16"));
    expect(set.explosionFrames[0]).toEqual(img("i17"));
    expect(set.explosionFrames[19]).toEqual(img("i36"));
  });
});

describe("loadedSprites", () => {
  it("is false for every sprite until it loads", async () => {
    const loaded = loadedSprites(await images());
    const { explosion, ...rest } = loaded;
    expect(Object.values(rest).every((v) => v === false)).toBe(true);
    expect(explosion).toEqual(Array(20).fill(false));
  });

  it("marks exactly the sprites that have loaded", async () => {
    const set = { ...(await images()), playerShip: img("ship"), puBomb: img("bomb") };
    set.explosionFrames = set.explosionFrames.map((f, i) => (i === 3 ? img("f3") : f));
    const loaded = loadedSprites(set);
    expect(loaded.playerShip).toBe(true);
    expect(loaded.puBomb).toBe(true);
    expect(loaded.enemyGrunt).toBe(false);
    expect(loaded.explosion.filter(Boolean)).toHaveLength(1);
    expect(loaded.explosion[3]).toBe(true);
  });
});

describe("sameDrawImages", () => {
  it("is true for two draw sets built from the same images", async () => {
    const set = await images();
    expect(sameDrawImages(drawImagesOf(set), drawImagesOf(set))).toBe(true);
  });

  it("is false once any sprite or explosion frame changes", async () => {
    const set = await images();
    const base = drawImagesOf(set);
    expect(sameDrawImages(base, drawImagesOf({ ...set, enemyCarrier: img("c") }))).toBe(false);
    const frames = [...set.explosionFrames];
    frames[19] = img("last");
    expect(sameDrawImages(base, drawImagesOf({ ...set, explosionFrames: frames }))).toBe(false);
  });

  it("is false when the explosion strip changes length", async () => {
    const set = await images();
    const shorter = drawImagesOf({ ...set, explosionFrames: set.explosionFrames.slice(1) });
    expect(sameDrawImages(drawImagesOf(set), shorter)).toBe(false);
  });
});
