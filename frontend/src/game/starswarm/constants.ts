export const WAVE_COUNTDOWN_MS = 3000;
// #2422: how long gameplay holds after a PERFECT Free Fire Zone clear. Tied to the length of the
// fanfare it accompanies (`starswarm.perfectbonus` -> assets/sounds/hearts-moon-shot.mp3, 10.03 s)
// so the freeze and the audio end together. A test guards this against the asset changing.
export const PERFECT_FANFARE_MS = 10_100;
// #2422: the hold when the fanfare isn't audible (muted, or the audio player isn't available).
// There is no audio to wait for, so keep the beat short — just long enough to read the banner.
export const PERFECT_SILENT_HOLD_MS = 3000;
// Render opacity for enemy bullets carried over from a cleared wave (see Bullet.harmless) —
// dim enough to read as "not a threat" while still visibly flying off-screen.
export const HARMLESS_BULLET_OPACITY = 0.35;
