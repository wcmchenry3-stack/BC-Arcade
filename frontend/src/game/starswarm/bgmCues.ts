/**
 * Star Swarm background music: duration and starting points (#3637/#3638, epic #3635).
 *
 * Hand-written data, not generated. The track is the owner's Round 46 "Seven Minute Signature Mix"
 * with one loop edit (`tools/assets/make_starswarm_bgm_loop.py`): the baked-in fades trimmed, a 3 s
 * equal-power seam, +2.9 dB. The file starts 5.5 s into the original (2.5 s head trim + 3 s seam),
 * so every original time t is t - 5.5 s here. The starting points are the owner-confirmed
 * (2026-11-12) leads into the opening, the Gathering Swarm, the organ, the second astronomical
 * rise and the electromagnetic choir: 0:00, 1:06.5, 2:36.5, 3:43.5, 4:50.5. Audition clips:
 * `tools/assets/render_bgm_cue_clips.py`; see `docs/games/starswarm-music-design.md`.
 *
 * `tools/assets/render_bgm_cue_clips.py` mirrors these values; a test keeps them in step.
 * `useStarSwarmAudio` passes `cuesMs` to the music hook (#3638): carry-over between games and the
 * starting point the next visit opens at.
 */
export const STARSWARM_BGM = {
  durationMs: 412_700,
  cuesMs: [0, 66_500, 156_500, 223_500, 290_500],
  loopCrossfadeMs: 3_000,
} as const;
