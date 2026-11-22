/**
 * Cascade palette (#2989 pattern, #3693): the colours Cascade draws with that are not theme
 * tokens, in one place.
 *
 * Two groups: the lid and danger-state colours (`CASCADE_LID_PALETTE`, #3694), and the
 * placeholder piece colours. The piece colours are drawn as plain circles by the
 * screen when a tier has no decoded sprite yet, and as the swatches in the dev panel, so they
 * are debug colours, not art: the shipped look is the active fruit set's sprites
 * (`theme/fruitSets.ts`). Do not use them for UI.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/**
 * Debug-only placeholder colour per tier of the ladder (`game/cascade/tiers.ts`, tiers 0-11,
 * #3960). Each is distinct from its neighbours so stacked circles stay readable.
 */
export const CASCADE_PIECE_COLORS = [
  "#e63946", // 0 Cherry / Pluto
  "#e4546a", // 1 Lychee (#3964) / Moon
  "#2f8f2a", // 2 Lime (#3964) / Mercury
  "#f9c80e", // 3 Lemon / Mars
  "#d63a5c", // 4 Plum (#3964) / Venus
  "#f77f00", // 5 Orange / Earth
  "#7cc242", // 6 Apple (green, #3920) / Neptune
  "#c4262e", // 7 Pomegranate (#3964) / Uranus
  "#ff4d9d", // 8 Dragonfruit / Saturn
  "#ffd166", // 9 Pineapple / Jupiter
  "#2d6a4f", // 10 Watermelon / Sun
  "#e76f00", // 11 Pumpkin / Milky Way (capstone)
] as const;

/** The lid and danger-state colours for one theme (#3694). All `#rrggbb`: the screen mixes them. */
export interface CascadeLidPalette {
  /** The solid lid line across the bin when calm (the theme's muted text colour). */
  readonly lid: string;
  /** The spawner ring when safe, and the start of its drain (the theme's accent cyan). */
  readonly ringSafe: string;
  /** The ring at the end of its drain, the lid line in danger, the over-lid wash (error red). */
  readonly danger: string;
  /** The ring's empty track and the waiting ghost's dashed outline, drawn faint (text colour). */
  readonly ink: string;
}

/**
 * The lid, the spawner clock ring and the over-lid wash (#3694: proposal 3 with proposal 1's
 * solid lid line). Light and dark equal the theme's textMuted / accent / error / text tokens
 * (`ThemeContext.tsx`, checked in gamePalettes.test.ts), kept here as hex because the board
 * mixes them channel by channel as the danger rises.
 */
export const CASCADE_LID_PALETTE: Readonly<Record<"light" | "dark", CascadeLidPalette>> = {
  light: { lid: "#6b5e4a", ringSafe: "#1bc5d4", danger: "#d94a42", ink: "#1a1412" },
  dark: { lid: "#a0a0ac", ringSafe: "#8ff5ff", danger: "#ff716c", ink: "#e8e8f0" },
};

/**
 * A colour of one piece part (#3698): base `b`, light `l` and dark `d` (the body's gradient and
 * its shading) and `o` (the sticker outline).
 */
export interface CascadeTone {
  readonly b: string;
  readonly l?: string;
  readonly d?: string;
  readonly o?: string;
}

/**
 * The code-drawn piece art's colours (#3698, kawaii glossy sticker style, owner pick 2026-11-14).
 * Used only by `game/cascade/art/` (the drawings) and nothing else. Tones are `#rrggbb`: the
 * drawing code mixes them and sets their alpha itself.
 */
export const CASCADE_ART = {
  /** Highlights, glints and stars. */
  white: "#ffffff",
  /** The darker rim inside every piece's edge (drawn at low alpha). */
  rim: "#40001a",
  /** Cheeks: fruits (open eyes) and cosmos (closed eyes). */
  blushOpen: "#ff3b6b",
  blushClosed: "#ff6f91",
  fruits: {
    cherry: { b: "#d81e3a", l: "#ff5a6e", d: "#8a0b20", o: "#6e0718" },
    /** #3964: the Lychee (tier 1): a bumpy red-pink shell with a pearly peeled window. */
    lychee: { b: "#e4546a", l: "#ff9aa0", d: "#a8223c", o: "#6a1224" },
    lycheeBump: { d: "#9a1f38", l: "#ff9ea4" },
    lycheePeel: { rim: "#8a1f34", edge: "#f6b9b0", flesh: "#fff5ec", shade: "#f1d2c8" },
    lycheeStem: "#8a5a2a",
    /** Cheeks of the pink-faced pieces (Lychee, Mangosteen B). */
    blushPink: "#ff7a9a",
    lemon: { b: "#f7d531", l: "#fff08a", d: "#c9a20a", o: "#9c7a06" },
    /** #3964: the Lime (tier 2) is a cut slice: this is the rind ring (the body's tone). */
    lime: { b: "#2f8f2a", l: "#5fc34a", d: "#17601a" },
    limePith: { outer: "#f1f7c6", inner: "#d7ec8c", heart: "#eaf6b6" },
    limeFlesh: ["#a8e046", "#9ed93a"],
    orange: { b: "#f58a1f", l: "#ffb766", d: "#c2560a", o: "#8f3c05" },
    orangeStem: "#3f8a2a",
    orangeStemDot: "#2c6a1c",
    /** #3920: a bright glossy apple green (Granny Smith), apart from the Lemon and Watermelon. */
    apple: { b: "#7cc242", l: "#c4ec7a", d: "#3f8a1e", o: "#2a5e12" },
    /** Retired (#3964, `FRUIT_ART.retired`): the Blueberry, Fruits tier 1 until the 12-tier ladder (#3960). */
    blueberry: { b: "#3f55b8", l: "#7d93ea", d: "#1f2b6e", o: "#18204f" },
    blueberryCalyx: "#141a3e",
    /** Retired (#3964): the Grape, Fruits tier 3 until #3960 (4 with the placeholder). */
    grapeBg: { b: "#3e1a5e", l: "#5a2a84", d: "#24103a" },
    grape: { b: "#8a45c0", l: "#c08aec", d: "#55237e", o: "#3b145c" },
    /** Retired by #3920 (kept for `FRUIT_ART.retired`, never drawn in play): the red Apple. */
    appleRed: { b: "#c8102e", l: "#f2505e", d: "#7a0616", o: "#5e0411" },
    /** Retired by #3920: the Peach. */
    peach: { b: "#ffb27a", l: "#ffd9b0", d: "#e46a4e", o: "#b8452f" },
    peachBlush: "#f2706a",
    /** #3964: the Plum (tier 4), "Santa Rosa": violet shoulders fading to ruby red. */
    plum: { b: "#d63a5c", l: "#f79aa6", d: "#8a1440" },
    plumShoulder: ["#5a47b8", "#7c3fa8"],
    plumBloom: "#f2dcff",
    plumSpeck: "#fbe3dc",
    plumSeam: "#4a0c30",
    plumBlush: "#ff8aa8",
    plumStem: "#7a5226",
    /** #3964: the Pomegranate (tier 7), leathery red with a spiky tan-brown calyx. */
    pomegranate: { b: "#c4262e", l: "#f2704a", d: "#7a0c18", o: "#4e0610" },
    pomegranateBlush: "#f58a3a",
    pomegranateWine: "#6a0a1c",
    pomegranateCalyx: { b: "#b8541c", d: "#6a2a10", o: "#3e1408" },
    /** The darker stem outline and the fresher leaf of the #3964 pieces (and the retired figs). */
    stemDark: "#2e1a08",
    leafFresh: { b: "#4aa03a", d: "#1b5a1b", o: "#124a12" },
    /** Retired (#3964, `FRUIT_ART.retired`): the Coconut, Fruits tier 6 until #3960 (7 with the placeholder). */
    coconut: { b: "#6e4426", l: "#9b6b44", d: "#3e2312", o: "#2b170b" },
    coconutEye: "#24130a",
    pine: { b: "#f3b52a", l: "#ffdc72", d: "#bb7a14", o: "#8a5508" },
    pineCrown: { b: "#3f9a3a", o: "#174a1a" },
    melon: { b: "#2f9a3e", l: "#6bd06a", d: "#17602a", o: "#0f4a1f" },
    pumpkin: { b: "#f27a1a", l: "#ffab4e", d: "#b44a08", o: "#843405" },
    leaf: { b: "#4fae3c", l: "#8ad66a", d: "#2c7424", o: "#1e5418" },
    stem: { b: "#7a4a22", o: "#3a1f0a" },
    pumpkinStem: { b: "#6d7d2c", o: "#334010" },
    dragonfruit: { b: "#d93a63", l: "#f2708f", d: "#a51f51" },
    bract: "#8dbb45",
    bractLight: "#acd862",
    bractDark: "#4a872b",
    bractBase: "#dc5470",
    /** Face ink per tier (eyes, smile), and the dragonfruit's own blush. */
    ink: [
      "#3a1418",
      "#5a2430", // lychee
      "#2a3a06", // lime
      "#4a3205",
      "#2a0828", // plum: dark ink (light ink read as white blobs on the red-violet)
      "#4a2003",
      "#1a3a06",
      "#3a0a0a", // pomegranate: dark ink
      "#3a1418",
      "#4a2a02",
      "#0a2a10",
      "#4a1a02",
    ],
    dragonfruitBlush: "#b0103c",
    /** Face ink of the retired pieces (#3920). */
    retiredInk: {
      appleRed: "#3a0208",
      peach: "#5a1a0c",
      blueberry: "#0f1330",
      grape: "#1c0830",
      coconut: "#1a0c04",
      figB: "#4a1428",
      figC: "#3a3410",
      mangosteenB: "#2a0820",
    },
    /** Retired, never used (#3964): Fig B (halved) and Fig C (Kadota), proposed for tier 1. */
    figB: { b: "#5a3470", l: "#8a64a8", d: "#2a1440" },
    figBInner: {
      rind: "#f6e4d0",
      pulp: "#d63e5c",
      pulpIn: "#e8627c",
      vein: "#b82a4a",
      seed: "#fbe08a",
      hollow: "#ffd9d0",
    },
    figBlush: "#ff6f8f",
    figStem: "#a98a52",
    kadota: { b: "#a49c48", l: "#e0d884", d: "#5e5a22", o: "#3a380e" },
    kadotaStreak: "#ece59a",
    kadotaBlush: "#c98a38",
    kadotaEye: "#d86a3a",
    kadotaCheek: "#d8884a",
    /** Retired, never used (#3964): Mangosteen B (halved), proposed for tier 1. */
    mangosteen: { b: "#6e2358", l: "#a8508c", d: "#2e0c28", o: "#1c0418" },
    mangosteenInner: { rind: "#d0589c", flesh: "#fff3ea", groove: "#e0c4c4" },
    mangosteenSegments: ["#fffdf8", "#fff7ee"],
    mangosteenCalyx: { b: "#58a83c", d: "#1f6a1c", o: "#144a12" },
    mangosteenCalyxStem: "#2e3a10",
  },
  cosmos: {
    /** The Moon (tier 1 again since #3960; archived by #3920 in between). */
    moon: { b: "#cfd0d4", l: "#f2f2f4", d: "#8e9098" },
    maria: "#9d9fa8",
    pluto: { b: "#c99d76", l: "#e9c9a6", d: "#8d6244" },
    plutoDark: "#7d4a33",
    plutoHeart: "#f6ead6",
    mercury: { b: "#7f776d", l: "#a49b8f", d: "#4e4842" },
    mars: { b: "#c4532c", l: "#ec8152", d: "#7c2a12" },
    marsDark: "#8e3418",
    marsCap: "#fbf3ee",
    venus: { b: "#e9c87c", l: "#fbe6ae", d: "#b48b3c" },
    venusBands: ["#c9a050", "#fff2c8"],
    earth: { b: "#2f72d6", l: "#68a8ff", d: "#173f8c" },
    land: "#3fa64e",
    neptune: { b: "#2a4fd6", l: "#5b80ff", d: "#132683" },
    neptuneBands: ["#4a70f0", "#1a35a8"],
    neptuneSpot: "#101e6a",
    neptuneStreak: "#d8e6ff",
    uranus: { b: "#9fe2e6", l: "#dbf8f8", d: "#5fb0bb" },
    uranusRing: { b: "#e6fbff", o: "#4d8f99" },
    saturn: { b: "#e1bf7f", l: "#f7e0b0", d: "#a98348" },
    saturnRingBack: { b: "#d8bf8c", d: "#8c7044", o: "#6a5230" },
    saturnRingFront: { b: "#e7d3a6", d: "#8c7044", o: "#6a5230" },
    saturnBands: ["#c9a062", "#f6e2b8", "#c29658"],
    saturnShadow: "#5a4020",
    jupiter: { b: "#d9a877", l: "#f3d6ae", d: "#97643a" },
    jupiterBands: ["#b8784a", "#f1dcbc", "#c08250", "#f3e0c4", "#b97848", "#d9b088"],
    jupiterSpot: "#c4452a",
    sun: { b: "#ffb31c", l: "#ffe36a", d: "#f07000" },
    sunSpot: "#c45a00",
    sunRing: "#ff8a00",
    sunBlush: "#ff5a3a",
    galaxy: { b: "#1d1650", l: "#3d2f96", d: "#0a0822" },
    galaxyArm: "#7d6cf0",
    galaxyArmCore: "#d9d0ff",
    galaxyCore: ["#fff6dc", "#ffd98a", "#ffd980"],
    galaxyBlush: "#ff8ac0",
    /** Face ink per tier. */
    ink: [
      "#3a2416",
      "#2a2a33", // moon (#3960)
      "#1a1612",
      "#3a1004",
      "#4a3006",
      "#0c1e44",
      "#e8f0ff",
      "#18454c",
      "#3a2a0e",
      "#3a1c06",
      "#6a2a00",
      "#f4eaff",
    ],
  },
} as const;

/**
 * The bin's colours for one theme (#3698, owner pick: the soft outline). Equal the theme's
 * surface / accent / border tokens (`ThemeContext.tsx`, checked in gamePalettes.test.ts), kept as
 * hex because `art/bin.ts` sets their alpha itself and draws on a Picture, outside React.
 */
export interface CascadeBinPalette {
  /** The bin's inside (the card). */
  readonly surface: string;
  /** The band, the inner rail and the floor wash. */
  readonly accent: string;
  /** The card's outer hairline. */
  readonly border: string;
}

export const CASCADE_BIN_PALETTE: Readonly<Record<"light" | "dark", CascadeBinPalette>> = {
  light: { surface: "#fbf4e2", accent: "#1bc5d4", border: "#d8c9a6" },
  dark: { surface: "#19191f", accent: "#8ff5ff", border: "#2e2e38" },
};

/** The win celebration's colours for one piece set (#3699). */
export interface CascadeCelebrationSetPalette {
  /** The halo behind the capstone: its outer colour and its core. */
  readonly glow: string;
  readonly glowCore: string;
  /** Fruits: the turning sun rays. Cosmos: the swirl's inner stars (then `glow`, then `sparkle`). */
  readonly rays: string;
  /** The twinkles over the dimmed pile (four-point stars); the swirl's outer stars. */
  readonly sparkle: string;
}

/** The win celebration's colours for one theme (#3699). */
export interface CascadeCelebrationThemePalette {
  /** The scrim over the pile: the theme's page background, drawn at most 68 % opaque. */
  readonly dim: string;
  /** The ring around the capstone: the theme's `celebration` gold. */
  readonly ring: string;
}

/**
 * The win celebration (#3699, owner pick: A "Spotlight" with C's cheering face). Every colour is
 * one the game already has: the art's (`CASCADE_ART`) or the theme's background and celebration
 * tokens (`ThemeContext.tsx`, checked in gamePalettes.test.ts). Kept as hex because
 * `render/drawCelebration.ts` sets their alpha itself on the UI thread.
 */
export const CASCADE_CELEBRATION: {
  readonly sets: Readonly<Record<"fruits" | "cosmos", CascadeCelebrationSetPalette>>;
  readonly themes: Readonly<Record<"light" | "dark", CascadeCelebrationThemePalette>>;
} = {
  sets: {
    fruits: {
      glow: CASCADE_ART.fruits.lemon.l,
      glowCore: CASCADE_BIN_PALETTE.light.surface,
      rays: CASCADE_ART.fruits.lemon.b,
      sparkle: CASCADE_ART.fruits.lemon.l,
    },
    cosmos: {
      glow: CASCADE_ART.cosmos.galaxyArm,
      glowCore: CASCADE_ART.cosmos.galaxyCore[0],
      rays: CASCADE_ART.cosmos.galaxyArmCore,
      sparkle: CASCADE_ART.white,
    },
  },
  themes: {
    light: { dim: "#f5ecd7", ring: "#8a6100" },
    dark: { dim: "#0e0e13", ring: "#ffd700" },
  },
};

/** One piece's motion colours (#3701): its art's base, light and dark tones. */
export interface CascadeMotionTone {
  readonly b: string;
  readonly l: string;
  readonly d: string;
}

/** The motion colours that follow the theme (#3701). */
export interface CascadeMotionThemePalette {
  /** The flash over a merge and the chain counter's fill. */
  readonly flash: string;
  /** The landing dust puffs. */
  readonly dust: string;
  /** The pile's dim at game over: the page background. */
  readonly dim: string;
  /** The danger blink and the game-over lid flash: the theme's text ink (the lid palette's). */
  readonly blink: string;
}

const F = CASCADE_ART.fruits;
const C = CASCADE_ART.cosmos;

/**
 * Cascade's motion (#3701, owner pick B with C's danger and game over). Every colour is one the game
 * already has: the art's tones per tier (`CASCADE_ART`), the white the art's glints use, and the
 * theme's page, muted and text colours (`CASCADE_LID_PALETTE`, `CASCADE_CELEBRATION`). Kept as hex
 * because `render/drawMotion.ts` sets their alpha itself on the UI thread.
 */
export const CASCADE_MOTION: {
  readonly tones: Readonly<Record<"fruits" | "cosmos", readonly CascadeMotionTone[]>>;
  readonly themes: Readonly<Record<"light" | "dark", CascadeMotionThemePalette>>;
} = {
  tones: {
    fruits: [
      { b: F.cherry.b, l: F.cherry.l, d: F.cherry.d },
      { b: F.lychee.b, l: F.lychee.l, d: F.lychee.d },
      { b: F.lime.b, l: F.lime.l, d: F.lime.d },
      { b: F.lemon.b, l: F.lemon.l, d: F.lemon.d },
      { b: F.plum.b, l: F.plum.l, d: F.plum.d },
      { b: F.orange.b, l: F.orange.l, d: F.orange.d },
      { b: F.apple.b, l: F.apple.l, d: F.apple.d },
      { b: F.pomegranate.b, l: F.pomegranate.l, d: F.pomegranate.d },
      { b: F.dragonfruit.b, l: F.dragonfruit.l, d: F.dragonfruit.d },
      { b: F.pine.b, l: F.pine.l, d: F.pine.d },
      { b: F.melon.b, l: F.melon.l, d: F.melon.d },
      { b: F.pumpkin.b, l: F.pumpkin.l, d: F.pumpkin.d },
    ],
    cosmos: [
      { b: C.pluto.b, l: C.pluto.l, d: C.pluto.d },
      { b: C.moon.b, l: C.moon.l, d: C.moon.d },
      { b: C.mercury.b, l: C.mercury.l, d: C.mercury.d },
      { b: C.mars.b, l: C.mars.l, d: C.mars.d },
      { b: C.venus.b, l: C.venus.l, d: C.venus.d },
      { b: C.earth.b, l: C.earth.l, d: C.earth.d },
      { b: C.neptune.b, l: C.neptune.l, d: C.neptune.d },
      { b: C.uranus.b, l: C.uranus.l, d: C.uranus.d },
      { b: C.saturn.b, l: C.saturn.l, d: C.saturn.d },
      { b: C.jupiter.b, l: C.jupiter.l, d: C.jupiter.d },
      { b: C.sun.b, l: C.sun.l, d: C.sun.d },
      { b: C.galaxyArm, l: C.galaxyArmCore, d: C.galaxy.d },
    ],
  },
  themes: {
    light: {
      flash: CASCADE_ART.white,
      dust: CASCADE_LID_PALETTE.light.lid,
      dim: CASCADE_CELEBRATION.themes.light.dim,
      blink: CASCADE_LID_PALETTE.light.ink,
    },
    dark: {
      flash: CASCADE_ART.white,
      dust: CASCADE_ART.white,
      dim: CASCADE_CELEBRATION.themes.dark.dim,
      blink: CASCADE_LID_PALETTE.dark.ink,
    },
  },
};
