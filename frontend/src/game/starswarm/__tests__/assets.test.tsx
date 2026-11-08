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
  it("loads 31 sprites (the three ships' 5 layers each among them) and a 20-frame explosion strip, one useImage each", async () => {
    const set = await images();
    expect(mockUseImage).toHaveBeenCalledTimes(51);
    expect(set.explosionFrames).toHaveLength(20);
    expect(set.p1Base).toBeNull();
  });

  it("hands back whatever each useImage call returned, in its slot", async () => {
    let n = 0;
    mockUseImage.mockImplementation(() => img(`i${n++}`));
    const set = await images();
    expect(set.p1Base).toEqual(img("i0"));
    expect(set.p1Guns2).toEqual(img("i1"));
    expect(set.p1Guns3).toEqual(img("i2"));
    expect(set.p1Plating1).toEqual(img("i3"));
    expect(set.p1Plating2).toEqual(img("i4"));
    expect(set.p2Base).toEqual(img("i5"));
    expect(set.p2Plating2).toEqual(img("i9"));
    expect(set.p3Base).toEqual(img("i10"));
    expect(set.p3Guns2).toEqual(img("i11"));
    expect(set.p3Guns3).toEqual(img("i12"));
    expect(set.p3Plating1).toEqual(img("i13"));
    expect(set.p3Plating2).toEqual(img("i14"));
    expect(set.buddyShip).toEqual(img("i15"));
    expect(set.asteroid4).toEqual(img("i30"));
    expect(set.explosionFrames[0]).toEqual(img("i31"));
    expect(set.explosionFrames[19]).toEqual(img("i50"));
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
    const set = { ...(await images()), p1Base: img("ship"), puBomb: img("bomb") };
    set.explosionFrames = set.explosionFrames.map((f, i) => (i === 3 ? img("f3") : f));
    const loaded = loadedSprites(set);
    expect(loaded.p1Base).toBe(true);
    expect(loaded.p1Guns2).toBe(false);
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
