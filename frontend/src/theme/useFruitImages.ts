/**
 * useFruitImages — loads all fruit/cosmos PNG assets via Skia's useImage hook.
 *
 * useImage must be called unconditionally (React hooks rules), so every asset is
 * loaded upfront regardless of the active fruit set. The caller picks the right
 * array based on fruitSet.id.
 *
 * Returns null for each slot while the image is still decoding; the renderer
 * falls back to a coloured circle in that case.
 */
import { useImage } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";

import { COSMOS_BAKED, FRUIT_BAKED } from "../game/cascade/images";

export interface FruitSetImages {
  /** Images indexed by tier (0–10). null = not yet loaded. */
  fruits: (SkImage | null)[];
  cosmos: (SkImage | null)[];
}

export function useFruitImages(): FruitSetImages {
  // Fruit tier order: cherry, blueberry, lemon, grape, orange, apple,
  //                   peach, coconut, dragonfruit, pineapple, watermelon
  const cherry = useImage(FRUIT_BAKED.cherry);
  const blueberry = useImage(FRUIT_BAKED.blueberry);
  const lemon = useImage(FRUIT_BAKED.lemon);
  const grape = useImage(FRUIT_BAKED.grape);
  const orange = useImage(FRUIT_BAKED.orange);
  const apple = useImage(FRUIT_BAKED.apple);
  const peach = useImage(FRUIT_BAKED.peach);
  const coconut = useImage(FRUIT_BAKED.coconut);
  const dragonfruit = useImage(FRUIT_BAKED.dragonfruit);
  const pineapple = useImage(FRUIT_BAKED.pineapple);
  const watermelon = useImage(FRUIT_BAKED.watermelon);

  // Cosmos tier order: moon, pluto, mercury, mars, venus, earth,
  //                    neptune, uranus, saturn, jupiter, sun
  const moon = useImage(COSMOS_BAKED.moon);
  const pluto = useImage(COSMOS_BAKED.pluto);
  const mercury = useImage(COSMOS_BAKED.mercury);
  const mars = useImage(COSMOS_BAKED.mars);
  const venus = useImage(COSMOS_BAKED.venus);
  const earth = useImage(COSMOS_BAKED.earth);
  const neptune = useImage(COSMOS_BAKED.neptune);
  const uranus = useImage(COSMOS_BAKED.uranus);
  const saturn = useImage(COSMOS_BAKED.saturn);
  const jupiter = useImage(COSMOS_BAKED.jupiter);
  const sun = useImage(COSMOS_BAKED.sun);

  return {
    fruits: [
      cherry,
      blueberry,
      lemon,
      grape,
      orange,
      apple,
      peach,
      coconut,
      dragonfruit,
      pineapple,
      watermelon,
    ],
    cosmos: [moon, pluto, mercury, mars, venus, earth, neptune, uranus, saturn, jupiter, sun],
  };
}

/** Returns the image array for the given fruit set id. */
export function getImagesForSet(allImages: FruitSetImages, setId: string): (SkImage | null)[] {
  switch (setId) {
    case "fruits":
      return allImages.fruits;
    case "cosmos":
      return allImages.cosmos;
    default:
      return allImages.fruits;
  }
}
