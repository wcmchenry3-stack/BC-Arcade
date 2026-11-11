/**
 * Star Swarm background music: duration and starting points (#3637, epic #3635).
 *
 * Hand-written data, not generated. The starting points are the feature placements in the Round 23
 * generator (`docs/games/starswarm-music/Rounds/Round_23/starswarm_round23_integrated_rough.py`):
 * 0:00 the opening, 1:12 the astronomical rise, 2:35 signals into the gathering chorus, 4:29 the
 * organ colour into the electromagnetic choir, 5:26 the shorter late rise. The owner confirmed the
 * points by ear on 2026-11-11 (audition clips: `tools/assets/render_bgm_cue_clips.py`); see
 * `docs/games/starswarm-music-design.md`.
 *
 * `tools/assets/render_bgm_cue_clips.py` mirrors `cuesMs`; a test keeps the two in step.
 * `useStarSwarmAudio` passes `cuesMs` to the music hook (#3638): carry-over between games and the
 * starting point the next visit opens at.
 */
export const STARSWARM_BGM = {
  durationMs: 420_000,
  cuesMs: [0, 72_000, 155_000, 269_000, 326_000],
  loopCrossfadeMs: 7_000,
} as const;
