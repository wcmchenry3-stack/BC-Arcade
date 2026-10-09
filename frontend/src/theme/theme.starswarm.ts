/**
 * Star Swarm screen, HUD and Controls colours.
 *
 * Star Swarm is a space shooter drawn on its own near-black field in both light
 * and dark mode, so none of these follow the theme. The native overlay
 * (`GameCanvas.tsx`, `Controls.tsx`, `StarSwarmScreen.tsx`) and the web canvas
 * (`GameCanvas.web.tsx`) import the same constants, and the in-canvas colours in
 * `game/starswarm/render/palette.ts` are derived from the shared ones below, so
 * a colour changed here changes everywhere. (Prerequisite for Star Swarm skins.)
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/** Deep-space background, and the dark label on an accent-filled button. */
export const STARSWARM_SPACE = "#000010";

/** The cyan HUD accent: lives, wave banners, countdown, Resume / New Game
 *  buttons — and the player ship's own colour. */
export const STARSWARM_ACCENT = "#00ffcc";

/** Hull / shield blue: the Shield power-up bar, the Hull pickup and every
 *  shield ring. */
export const STARSWARM_HULL_BLUE = "#00aaff";

/** Lightning power-up yellow: its bar and label. */
export const STARSWARM_LIGHTNING = "#ffee00";

/** HUD score text. */
export const STARSWARM_HUD_TEXT = "#ffffff";

/** HUD difficulty-tier label. */
export const STARSWARM_HUD_DIFFICULTY = "#aaffee";

/** Boss-wave ("CARRIER SIGHTED") banner. */
export const STARSWARM_BOSS_WAVE = "#ffdd00";

/** Bonus-life flash and its amber glow. */
export const STARSWARM_BONUS_LIFE = "#ffff00";
export const STARSWARM_BONUS_LIFE_GLOW = "#ff8800";

/** Black outline behind floating text (the pickup cue). */
export const STARSWARM_TEXT_OUTLINE = "#000000";

/** Empty track behind a power-up bar. */
export const STARSWARM_POWERUP_TRACK = "rgba(255,255,255,0.18)";

/** Pause overlay scrim, and the quiet "New game" link beneath Resume. */
export const STARSWARM_PAUSE_SCRIM = "rgba(0, 0, 16, 0.72)";
export const STARSWARM_PAUSE_LINK_BORDER = "rgba(255,255,255,0.35)";
export const STARSWARM_PAUSE_LINK_TEXT = "rgba(255,255,255,0.55)";
