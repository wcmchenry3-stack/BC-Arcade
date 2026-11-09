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
  STARSWARM_ARMOR_BLUE,
  STARSWARM_ARMOR_PALE,
  STARSWARM_HULL_BLUE,
  STARSWARM_LIGHTNING,
  STARSWARM_SPACE,
} from "../../../theme/theme.starswarm";
import { opaque, rgbFromHex } from "./color";
import type { PackedColor } from "./color";

// --- Shared with the HUD (theme.starswarm) ---------------------------------------------------

/** The cyan player ship, its fallback bullet, the lives and wave banners. */
export const ACCENT_RGB = rgbFromHex(STARSWARM_ACCENT);

/** Shield / armor blue: every ring, flash and the Hull pickup. */
export const HULL_BLUE_RGB = rgbFromHex(STARSWARM_HULL_BLUE);

/**
 * Armour blue (#3592): the outline around a plated ship and the hull-plating flash. Mirrors the
 * generator's `ARMOR_EDGE` (`tools/assets/draw_starswarm_art.py`).
 */
export const ARMOR_BLUE_RGB = rgbFromHex(STARSWARM_ARMOR_BLUE);
/** The pale end of the plating gradient (generator `ARMOR`), the flash's bright core. */
export const ARMOR_PALE_RGB = rgbFromHex(STARSWARM_ARMOR_PALE);

/** Lightning power-up yellow: the electric tint over the ship and the bolt glyph. */
export const LIGHTNING_RGB = rgbFromHex(STARSWARM_LIGHTNING);

/** Deep-space background. */
export const BG_RGB = rgbFromHex(STARSWARM_SPACE);
export const BG: PackedColor = opaque(BG_RGB);

/** Plain white: glyphs, beam cores and every flash's white-hot centre. */
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

// --- Enemies (#3593, style B) ----------------------------------------------------------------
// The hive's code-drawn parts. They mirror the sprite generator's palette
// (`tools/assets/draw_starswarm_art.py`), so an effect and the sprite it sits on match.

/** The lifted shell's light stop (generator `CARAPACE`): every tier's fallback shape. */
export const SHELL_LIGHT_RGB = 0xb07ae0;
export const ENEMY_FALLBACK: PackedColor = opaque(SHELL_LIGHT_RGB);
/** The shell's rim light (generator `CARAPACE_EDGE`): the fallback's edge and the flinch ticks. */
export const SHELL_EDGE_RGB = 0xc07bff;

/** Hit flash: a white-hot core, a ring in the crack glow (generator `HOT`), and sparks. */
export const HIT_CORE_RGB = 0xffe6c8;
export const HIT_RING_RGB = 0xff7a2e;
export const HIT_SPARK_RGB = 0xffb347;

/** The Elite's flickering core at 1 HP: the red glow (generator `STINGER`) and its hot centre. */
export const CORE_GLOW_RGB = 0xff5a3c;
export const CORE_HOT_RGB = 0xfff2d9;

/** The smoke off a Guardian at 1 HP. */
export const SMOKE_RGB = 0x6e6e78;

// --- Asteroids (#3596) -----------------------------------------------------------------------
// The rock art ships neutral (greyscale) and is tinted per rock at runtime into one of three
// owner-approved palettes: colour = edge + grey x (light - edge), so the grey highlight lands on
// the light stop, the outline on the edge colour and the generator's dark stop (grey 0.22) on
// each palette's approved dark stop. Mirrors `ROCK_PALETTES` in tools/assets/draw_starswarm_art.py
// (a generator test checks the hex values below). The ore veins are drawn untinted (gold).

/** R1 basalt (#3a322c dark stop). */
export const ROCK_R1_LIGHT_RGB = 0x9a8c80;
export const ROCK_R1_EDGE_RGB = 0x1e1915;
/** R2 rust iron (#4a2c1c dark stop). */
export const ROCK_R2_LIGHT_RGB = 0xb0805a;
export const ROCK_R2_EDGE_RGB = 0x24140c;
/** R3 slate blue-grey (#2c323e dark stop). */
export const ROCK_R3_LIGHT_RGB = 0x8a96a8;
export const ROCK_R3_EDGE_RGB = 0x151a22;

/** The three rock palettes, in the order a rock's hash picks them. */
export const ROCK_PALETTES: readonly { readonly light: number; readonly edge: number }[] = [
  { light: ROCK_R1_LIGHT_RGB, edge: ROCK_R1_EDGE_RGB },
  { light: ROCK_R2_LIGHT_RGB, edge: ROCK_R2_EDGE_RGB },
  { light: ROCK_R3_LIGHT_RGB, edge: ROCK_R3_EDGE_RGB },
];

/** The loading fallback polygon, in basalt: the body's middle tone... */
export const ASTEROID_RGB = 0x5a4e45;
/**
 * ...with a light rim (basalt's light stop).
 * @alias
 */
export const ASTEROID_EDGE_RGB = ROCK_R1_LIGHT_RGB;

// --- Power-ups -------------------------------------------------------------------------------

export const BOMB_RGB = 0xff5000;
export const BUDDY_POWERUP_RGB = 0x00ffc8;

/** Buddy ship's fallback rectangle when its sprite has not loaded. */
export const BUDDY_SHIP_RGB = 0x0078ff;

// --- Player effects (#3592, style B) ---------------------------------------------------------
// Colours here mirror the sprite generator's palette (`tools/assets/draw_starswarm_art.py`), so
// a code-drawn effect and the sprite it touches match.

/** Shield bubble: the canopy's cyan-blue body (generator `CANOPY` mid stop)... */
export const SHIELD_BUBBLE_RGB = 0x29b8d6;
/** ...its bright rim and hex hint (generator `CANOPY` light stop). */
export const SHIELD_RIM_RGB = 0xd6fbff;

/** Lightning aura: an electric blue halo, and the near-white sparks around the ship. */
export const LIGHTNING_AURA_RGB = 0x7fd8ff;
export const LIGHTNING_SPARK_RGB = 0xf2fbff;

// --- Buddy HP bar (#2845, restyled #3592) ----------------------------------------------------

/** Healthy (friendly cyan, generator `CYAN`), half (amber, the warning colour), and
 *  one-volley-from-dead (danger red, generator `STINGER`). */
export const BUDDY_HP_HIGH: PackedColor = 0xff00e8d0;
export const BUDDY_HP_MID: PackedColor = 0xffffb020;
export const BUDDY_HP_LOW: PackedColor = 0xffff5a3c;

/** The dark track behind the pips (generator `EDGE`), and the hit-flash ring (danger red). */
export const BUDDY_HP_TRACK_RGB = 0x16222f;
export const BUDDY_HIT_FLASH_RGB = 0xff5a3c;

// --- Carrier (#2843, restyled #3625) --------------------------------------------------------
// Style B: the Carrier's code-drawn effects. The beam, its charge and the attack-run brace are the
// "searing plasma" family (red-orange body, yellow-white core, orange glow); the armour bubble,
// the Guardian shield links and the bay glow are hive energy, the pink-violet of the Guardians'
// emitters. They mirror the generator's palette (`tools/assets/draw_starswarm_art.py`).

/** Searing plasma: the beam's red-orange body, its yellow-white core, its orange glow. */
export const PLASMA_RGB = 0xff3a1a;
export const PLASMA_CORE_RGB = 0xfff2b0;
export const PLASMA_GLOW_RGB = 0xff8a3c;
/**
 * The attack-run brace ring: the plasma's glow orange.
 * @alias
 */
export const BRACE_RGB = PLASMA_GLOW_RGB;

/** Hive energy: the armour bubble (and its hex hints' pale tint) and the shield links. */
export const HIVE_SHIELD_RGB = 0xe08cff;
export const HIVE_SHIELD_PALE_RGB = 0xf6dcff;

/** The final stand's red heat on the Carrier. */
export const HEAT_RGB = 0xff2a1a;

// --- Upgrade pickups (#2488, #2847) ----------------------------------------------------------

/** Salvage crate (guns): amber. */
export const SALVAGE_RGB = 0xffb020;
/** Salvage crate detail: the dark band, and the pale edge. */
export const SALVAGE_BAND: PackedColor = 0xff7a4d08;
export const SALVAGE_EDGE: PackedColor = 0xfffff2c0;
/** Hull plate's pale-blue edge. */
export const HULL_EDGE: PackedColor = 0xffd8f4ff;

// --- Explosions and the Smart Bomb (#3597) --------------------------------------------------
// The flash family: an explosion is the hit flash's language grown up — a hot core, an orange
// fire ring, then dark smoke — in the Carrier plasma's yellow-white and glow orange (#3625).

/**
 * The flash's hot core (the plasma's yellow-white), under a white centre.
 * @alias
 */
export const EXPLOSION_HOT_RGB = PLASMA_CORE_RGB;
/**
 * The expanding fire ring (the plasma's glow orange).
 * @alias
 */
export const EXPLOSION_FIRE_RGB = PLASMA_GLOW_RGB;
/** The smoke puffs late in a blast: a dark violet grey that reads on the nebula. */
export const EXPLOSION_SMOKE_RGB = 0x594d61;
/** The debris ticks thrown off a burst, a blast and a breaking rock. */
export const EXPLOSION_SPARK_RGB = 0xffd980;
/**
 * A rock breaks into dust: the crack-lit dust core (#3597's colour)... This brown pair is the
 * default, for a rock explosion that does not name its rock (an older save).
 */
export const ROCK_DUST_HOT_RGB = 0xe8d3b8;
/** ...and the brown dust ring. */
export const ROCK_DUST_RGB = 0x8b6a47;

/**
 * #3596: each rock palette's dust, in `ROCK_PALETTES` order: the ring in the palette's light stop
 * and a hot core halfway from it to white. A broken rock's dust is drawn in its own palette.
 */
export const ROCK_R1_DUST_HOT_RGB = 0xcdc6c0;
export const ROCK_R2_DUST_HOT_RGB = 0xd8c0ad;
export const ROCK_R3_DUST_HOT_RGB = 0xc5cbd4;
export const ROCK_DUST_PALETTES: readonly { readonly hot: number; readonly ring: number }[] = [
  { hot: ROCK_R1_DUST_HOT_RGB, ring: ROCK_R1_LIGHT_RGB },
  { hot: ROCK_R2_DUST_HOT_RGB, ring: ROCK_R2_LIGHT_RGB },
  { hot: ROCK_R3_DUST_HOT_RGB, ring: ROCK_R3_LIGHT_RGB },
];

/**
 * The Smart Bomb's warm full-screen tint (was plain white before #3597).
 * @alias
 */
export const BOMB_TINT_RGB = PLASMA_CORE_RGB;

// --- Background (#3597) ----------------------------------------------------------------------
// The N2 "teal-violet" nebula: a soft violet cloud high on the right, a teal one low on the left,
// at low alpha over the space black, baked once with the background (never drawn per frame).

export const NEBULA_VIOLET_RGB = 0x7a3cc8;
export const NEBULA_TEAL_RGB = 0x1a7a9a;

/** Star tints by depth: far stars pale violet, the middle layer pale teal, near stars cool white. */
export const STAR_FAR_RGB = 0xd8ccff;
export const STAR_MID_RGB = 0xc8f4ff;
export const STAR_NEAR_RGB = 0xf2f6ff;
