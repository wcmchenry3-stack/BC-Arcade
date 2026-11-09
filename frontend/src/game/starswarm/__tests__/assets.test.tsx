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
  it("loads 37 sprites (the three ships' 5 layers and the 10 enemy sprites among them), one useImage each", async () => {
    const set = await images();
    // #3597: the 20-frame explosion strip is gone (explosions are code-drawn)
    expect(mockUseImage).toHaveBeenCalledTimes(37);
    expect("explosionFrames" in set).toBe(false);
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
    expect(set.enemyGrunt).toEqual(img("i16"));
    expect(set.enemyCarrierCracks).toEqual(img("i25"));
    expect(set.asteroid4).toEqual(img("i36"));
  });
});

describe("loadedSprites", () => {
  it("is false for every sprite until it loads", async () => {
    const loaded = loadedSprites(await images());
    expect(Object.values(loaded).every((v) => v === false)).toBe(true);
  });

  it("marks exactly the sprites that have loaded", async () => {
    const set = { ...(await images()), p1Base: img("ship"), puBomb: img("bomb") };
    const loaded = loadedSprites(set);
    expect(loaded.p1Base).toBe(true);
    expect(loaded.p1Guns2).toBe(false);
    expect(loaded.puBomb).toBe(true);
    expect(loaded.enemyGrunt).toBe(false);
  });
});

describe("sameDrawImages", () => {
  it("is true for two draw sets built from the same images", async () => {
    const set = await images();
    expect(sameDrawImages(drawImagesOf(set), drawImagesOf(set))).toBe(true);
  });

  it("is false once any sprite changes", async () => {
    const set = await images();
    const base = drawImagesOf(set);
    expect(sameDrawImages(base, drawImagesOf({ ...set, enemyCarrier: img("c") }))).toBe(false);
    expect(sameDrawImages(base, drawImagesOf({ ...set, asteroid4: img("a") }))).toBe(false);
  });
});
