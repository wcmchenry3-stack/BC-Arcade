/**
 * #3592: the player ship as stacked sprite layers, shared by both renderers.
 *
 * A ship is five transparent images that share one canvas (`base`, `guns2`, `guns3`, `plating1`,
 * `plating2`), drawn on top of each other: the gun level picks the gun layers, the hull level the
 * plating layers (see `docs/games/starswarm-art-design.md`). Each image is the 34 px game box
 * plus `SHIP_SPRITE_PAD` px of transparent margin on every side, so glows and the armour outline
 * are never clipped; the margin is drawn around the hitbox, which does not change.
 *
 * The armour outline for hull 1 and 2 is not an image: it is a blue glow around the composed
 * layers, drawn in code (`ARMOUR_OUTLINE`). It is built once per ship, gun and hull level and
 * cached: native renders it with a Skia image filter (dilate, tint, blur) into an offscreen
 * surface and keeps the snapshot (`drawFrame.ts`), web into a cached canvas (`outlineGlow.ts`).
 * Each frame is then one image draw. The two renderers' outlines are very close, not identical
 * (Skia's dilate kernel is square, the web's is a circle of offsets).
 *
 * The runtime dilates the composed layers, engine and muzzle glows included, so those pick up a
 * faint blue haze. The generator's contact-sheet simulation dilates a hull-only silhouette, so it
 * is an approximation of the runtime look, not a pixel match.
 *
 * `ShipId` is the player's pick from the ship picker (#3600): Falcon (P1, arrow hull), Raptor
 * (P2, forward-swept wings), Osprey (P3, twin booms). The choice is cosmetic only: the layers differ, the hitbox, stats and guns do not
 * (the ship id never reaches the engine). All three ships' layers are loaded up front.
 */
import { opaque, withAlpha } from "./color";
import type { PackedColor } from "./color";
import type { DrawOp } from "./frame";
import { debugOpKeys } from "./opKeys";
import { ACCENT_RGB, ARMOR_BLUE_RGB } from "./palette";

/** The player ships, in picker order. */
export const SHIP_IDS = ["p1", "p2", "p3"] as const;
export type ShipId = (typeof SHIP_IDS)[number];
/** The ship a new player starts with, and what an unknown stored value falls back to. */
export const DEFAULT_SHIP_ID: ShipId = "p1";

/** Bottom to top, the order they are drawn in. */
export type ShipLayer = "base" | "guns2" | "guns3" | "plating1" | "plating2";

/** Sprite names — identical to the `StarSwarmImages` fields they resolve to. */
export type ShipSpriteKey =
  | "p1Base"
  | "p1Guns2"
  | "p1Guns3"
  | "p1Plating1"
  | "p1Plating2"
  | "p2Base"
  | "p2Guns2"
  | "p2Guns3"
  | "p2Plating1"
  | "p2Plating2"
  | "p3Base"
  | "p3Guns2"
  | "p3Guns3"
  | "p3Plating1"
  | "p3Plating2";

const LAYER_KEY: Record<ShipId, Record<ShipLayer, ShipSpriteKey>> = {
  p1: {
    base: "p1Base",
    guns2: "p1Guns2",
    guns3: "p1Guns3",
    plating1: "p1Plating1",
    plating2: "p1Plating2",
  },
  p2: {
    base: "p2Base",
    guns2: "p2Guns2",
    guns3: "p2Guns3",
    plating1: "p2Plating1",
    plating2: "p2Plating2",
  },
  p3: {
    base: "p3Base",
    guns2: "p3Guns2",
    guns3: "p3Guns3",
    plating1: "p3Plating1",
    plating2: "p3Plating2",
  },
};

/** The sprites' pixels per game px: the layer images are authored at 3x. */
export const SHIP_ART_SCALE = 3;

/** Transparent margin around the 34 px box in each layer image, game px (12 px at 3x). Buddy's
 * sprite has the same margin. */
export const SHIP_SPRITE_PAD = 4;

/** The layer every ship has; a ship is drawn only once this one has loaded. */
export const SHIP_BASE_SPRITE: Record<ShipId, ShipSpriteKey> = {
  p1: LAYER_KEY.p1.base,
  p2: LAYER_KEY.p2.base,
  p3: LAYER_KEY.p3.base,
};

/** `STACKS[ship][guns - 1][hull]`: built once, so choosing the layers allocates nothing. */
const STACKS: Record<ShipId, (readonly ShipSpriteKey[])[][]> = {
  p1: buildStacks("p1"),
  p2: buildStacks("p2"),
  p3: buildStacks("p3"),
};

function buildStacks(ship: ShipId): (readonly ShipSpriteKey[])[][] {
  const k = LAYER_KEY[ship];
  return [1, 2, 3].map((guns) =>
    [0, 1, 2].map((hull) => {
      const layers: ShipLayer[] = ["base"];
      if (guns >= 2) layers.push("guns2");
      if (guns >= 3) layers.push("guns3");
      if (hull >= 1) layers.push("plating1");
      if (hull >= 2) layers.push("plating2");
      return Object.freeze(layers.map((l) => k[l]));
    })
  );
}

/** The gun index (0-2) a gun value selects, clamped. */
function gunIndex(guns: number): number {
  return Math.min(3, Math.max(1, Math.trunc(guns))) - 1;
}

/** The hull level (0-2) a hull value selects, clamped. */
function hullIndex(hull: number): number {
  return Math.min(2, Math.max(0, Math.trunc(hull)));
}

/** The layers to draw for a gun level (1-3) and a hull level (0-2), bottom to top. */
export function shipStack(ship: ShipId, guns: number, hull: number): readonly ShipSpriteKey[] {
  return STACKS[ship][gunIndex(guns)]![hullIndex(hull)]!;
}

const SHIP_INDEX: Record<ShipId, number> = { p1: 0, p2: 1, p3: 2 };

/**
 * The cache slot of a ship's outline glow: ship id, then the same clamped gun and hull values
 * `shipStack` uses, so any value that draws the same layers shares one glow (and none can pick
 * another ship's). At most `ships * 9` slots.
 */
export function shipGlowKey(ship: ShipId, guns: number, hull: number): number {
  return SHIP_INDEX[ship] * 9 + gunIndex(guns) * 3 + hullIndex(hull);
}

/** The armour outline levels: hull 1 is thin, hull 2 bold. */
export type ArmourLevel = 1 | 2;

/**
 * The outline's shape, in game px. `grow` is how far the silhouette is dilated, `sigma` the blur,
 * `alpha` the strength. They are the generator's `armour_outline()` values at 3x (dilate 2 and 4
 * px, blur 1.0 and 1.6 px, alpha 0.75 and 1.0), so the contact sheet shows the real look.
 */
export const ARMOUR_OUTLINE: Readonly<
  Record<
    ArmourLevel,
    {
      readonly grow: number;
      readonly sigma: number;
      readonly alpha: number;
      /** The outline colour with `alpha` applied, packed (the UI-thread replay cannot call `withAlpha`). */
      readonly color: PackedColor;
    }
  >
> = {
  1: { grow: 2 / 3, sigma: 1 / 3, alpha: 0.75, color: withAlpha(ARMOR_BLUE_RGB, 0.75) },
  2: { grow: 4 / 3, sigma: 8 / 15, alpha: 1, color: withAlpha(ARMOR_BLUE_RGB, 1) },
};

/** The outline level for a hull level, or `undefined` when it has no plating. */
export function armourLevel(hull: number): ArmourLevel | undefined {
  return hull >= 2 ? 2 : hull >= 1 ? 1 : undefined;
}

/**
 * What the player is drawn as while its sprites load: a cyan triangle, pointing up. One shape on
 * both renderers (web replays the op with `drawPickupOps`).
 */
export function playerFallbackOp(x: number, y: number, w: number, h: number): DrawOp {
  return {
    k: "poly",
    key: debugOpKeys() ? "player" : undefined,
    points: [x + w / 2, y, x, y + h, x + w, y + h],
    color: opaque(ACCENT_RGB),
  };
}
