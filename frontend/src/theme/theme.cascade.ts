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
 * Debug-only placeholder colour per tier of the ladder (`game/cascade/tiers.ts`, tiers 0-11).
 * Each is distinct from its neighbours so stacked circles stay readable. Tier 11 (the capstone,
 * Pumpkin / Milky Way) is drawn with this colour until its art lands (#3698).
 */
export const CASCADE_PIECE_COLORS = [
  "#e63946", // 0 Cherry / Moon
  "#4361ee", // 1 Blueberry / Pluto
  "#f9c80e", // 2 Lemon / Mercury
  "#6a0572", // 3 Grape / Mars
  "#f77f00", // 4 Orange / Venus
  "#c1121f", // 5 Apple / Earth
  "#ffb347", // 6 Peach / Neptune
  "#6f4e37", // 7 Coconut / Uranus
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
    blue: { b: "#3f55b8", l: "#7d93ea", d: "#1f2b6e", o: "#18204f" },
    blueCalyx: "#141a3e",
    lemon: { b: "#f7d531", l: "#fff08a", d: "#c9a20a", o: "#9c7a06" },
    grapeBg: { b: "#3e1a5e", l: "#5a2a84", d: "#24103a" },
    grape: { b: "#8a45c0", l: "#c08aec", d: "#55237e", o: "#3b145c" },
    orange: { b: "#f58a1f", l: "#ffb766", d: "#c2560a", o: "#8f3c05" },
    orangeStem: "#3f8a2a",
    orangeStemDot: "#2c6a1c",
    apple: { b: "#c8102e", l: "#f2505e", d: "#7a0616", o: "#5e0411" },
    peach: { b: "#ffb27a", l: "#ffd9b0", d: "#e46a4e", o: "#b8452f" },
    peachBlush: "#f2706a",
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
      "#0f1330",
      "#4a3205",
      "#1c0830",
      "#4a2003",
      "#3a0208",
      "#5a1a0c",
      "#1a0c04",
      "#3a1418",
      "#4a2a02",
      "#0a2a10",
      "#4a1a02",
    ],
    dragonfruitBlush: "#b0103c",
  },
  cosmos: {
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
      "#2a2a33",
      "#3a2416",
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
