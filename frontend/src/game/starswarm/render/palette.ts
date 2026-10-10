/**
 * Star Swarm's in-canvas palette: every colour drawn into the playfield, once.
 *
 * `frame.ts`, `buddy.ts`, `carrier.ts`, `pickups.ts` and `starfieldPictures.ts` (native Skia)
 * and `GameCanvas.web.tsx` (2D canvas) all import from here, so the two renderers cannot drift.
 * The web canvas builds its colour table from these RGB values with `cssHex` / `cssRgba`.
 *
 * Naming: `*_RGB` is a plain 0xRRGGBB (for `withAlpha` and for the web); a bare name is the
 * opaque packed 0xAARRGGBB the display list takes. The few colours the HUD shares with the
 * playfield (space black, cyan accent, hull blue, lightning yellow) come from
 * `theme/theme.starswarm.ts` so the overlay and the canvas stay one colour.
 */
import {
  STARSWARM_ACCENT,
  STARSWARM_HULL_BLUE,
  STARSWARM_LIGHTNING,
  STARSWARM_SPACE,
} from "../../../theme/theme.starswarm";
import { opaque, rgbFromHex } from "./color";
import type { PackedColor } from "./color";
import type { EnemyTier } from "../types";

// --- Shared with the HUD (theme.starswarm) ---------------------------------------------------

/** The cyan player ship, its fallback bullet, the lives and wave banners. */
export const ACCENT_RGB = rgbFromHex(STARSWARM_ACCENT);

/** Shield / armor blue: every ring, flash and the Hull pickup. */
export const HULL_BLUE_RGB = rgbFromHex(STARSWARM_HULL_BLUE);

/** Lightning power-up yellow: the electric tint over the ship and the bolt glyph. */
export const LIGHTNING_RGB = rgbFromHex(STARSWARM_LIGHTNING);

/** Deep-space background. */
export const BG_RGB = rgbFromHex(STARSWARM_SPACE);
export const BG: PackedColor = opaque(BG_RGB);

/** Stars, the bomb flash, HP pips and glyphs: plain white. */
export const WHITE_RGB = 0xffffff;
export const WHITE: PackedColor = opaque(WHITE_RGB);

// --- Shots -----------------------------------------------------------------------------------

export const ENEMY_SHOT_RGB = 0xff4422;
export const ENEMY_SHOT: PackedColor = opaque(ENEMY_SHOT_RGB);

/** Flak aimed at a rock reads amber against the red enemy fire (#2487). */
export const FLAK_SHOT_RGB = 0xffd27a;
export const FLAK_SHOT: PackedColor = opaque(FLAK_SHOT_RGB);

/**
 * The player's fallback bullet when its sprite has not loaded.
 * @alias
 */
export const PLAYER_SHOT_RGB = ACCENT_RGB;
export const PLAYER_SHOT: PackedColor = opaque(PLAYER_SHOT_RGB);

/** A charged shot is a brighter cyan than the plain one. */
export const CHARGE_SHOT_RGB = 0x00f0ff;
export const CHARGE_SHOT: PackedColor = opaque(CHARGE_SHOT_RGB);

// --- Enemies ---------------------------------------------------------------------------------

/** Tint of each tier's fallback rectangle (web: the tier's body colour) when its sprite is missing. */
export const TIER_RGB: Record<EnemyTier, number> = {
  Grunt: 0x8888ff,
  Elite: 0xff88ff,
  Guardian: 0xffff44,
  Carrier: 0xb06cff,
};
export const TIER_FALLBACK: Record<EnemyTier, PackedColor> = {
  Grunt: opaque(TIER_RGB.Grunt),
  Elite: opaque(TIER_RGB.Elite),
  Guardian: opaque(TIER_RGB.Guardian),
  Carrier: opaque(TIER_RGB.Carrier),
};

// --- Asteroids -------------------------------------------------------------------------------

export const ASTEROID_RGB = 0x8b6a47;
export const ASTEROID_FLASH_RGB = 0xe8d3b8;
export const ASTEROID_EDGE_RGB = 0xc9a27a;

// --- Power-ups -------------------------------------------------------------------------------

export const BOMB_RGB = 0xff5000;
export const BUDDY_POWERUP_RGB = 0x00ffc8;

/** Buddy ship's fallback rectangle when its sprite has not loaded. */
export const BUDDY_SHIP_RGB = 0x0078ff;

// --- Buddy HP bar (#2845) --------------------------------------------------------------------

/** Healthy, half, and one-volley-from-dead. */
export const BUDDY_HP_HIGH: PackedColor = 0xff4dff88;
export const BUDDY_HP_MID: PackedColor = 0xffffc233;
export const BUDDY_HP_LOW: PackedColor = 0xffff4a3d;

/** The dark track behind the pips, and the hit-flash ring. */
export const BUDDY_HP_TRACK_RGB = 0x000000;
export const BUDDY_HIT_FLASH_RGB = 0xff785a;

// --- Carrier (#2843) -------------------------------------------------------------------------

export const BEAM_RGB = 0xb06cff;
export const BEAM_CORE_RGB = 0xe6cdff;
/** The attack-run brace: amber. */
export const BRACE_RGB = 0xffaa28;

// --- Upgrade pickups (#2488, #2847) ----------------------------------------------------------

/** Salvage crate (guns): amber. */
export const SALVAGE_RGB = 0xffb020;
/** Salvage crate detail: the dark band, and the pale edge. */
export const SALVAGE_BAND: PackedColor = 0xff7a4d08;
export const SALVAGE_EDGE: PackedColor = 0xfffff2c0;
/** Hull plate's pale-blue edge. */
export const HULL_EDGE: PackedColor = 0xffd8f4ff;

// --- Explosions ------------------------------------------------------------------------------

/** Fallback burst: hot yellow for the first 40% of the frames, then orange-red. */
export const EXPLOSION_HOT_RGB = 0xffcc00;
export const EXPLOSION_COOL_RGB = 0xff4400;
