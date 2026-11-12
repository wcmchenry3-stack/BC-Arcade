# Round 39 — Active sci-fi signatures over the musical foundation

This is an **audition**, not production gameplay audio or a final loop.

**A** is the Round 38 90-second original musical foundation re-encoded as a control. **B** uses the exact same foundation, with more frequent, distinct original science-fiction signature sounds layered deliberately into its musical arc.

The signature sounds were reconstructed as isolated original procedural layers from Rounds 18, 19 and 20, *without* the unrelated background music present in those old demo MP3s. No Pixabay or third-party recording or melody was sampled.

## Feature windows in B (approximate)

- 0:08–0:29: astronomical upward rise with musical retreat / return.
- 0:28–0:43: several clear, different robotic signal gestures.
- 0:42–1:05: a foreground gathering swarm chorus.
- 1:05–1:20: distant organ-like tonal color.
- 1:08–1:20: distinct restrained downward Shepard tone, separated from the earlier rise.
- 1:19–1:29: a short contrasting electromagnetic choir color.

Some quieter features can overlap the preceding background music but are deliberately not blended with one another into a continuous undifferentiated texture. Later organ/Shepard interplay is relatively restrained and should be assessed by ear; early choir and robotic arrangement is approximate and may still need compositional smoothing.

Both A and B: 90.048-second 24 kHz stereo, 128 kbps MP3, 1,441,196 bytes; both measure approximately **−20.9 LUFS** integrated. That does **not** mean local feature loudness is identical. No limiter, time-window normalization, in-game SFX test, gapless loop certification, or entry-point validation has been completed.

## Dependencies / reproduction

Run `python starswarm_round39_signatures_integrated.py` with Python `numpy` and FFmpeg installed. The folder needs `starswarm-round38-ninety-second-development.mp3` and the original project-created scripts `starswarm_round18_foreground_chorus.py`, `starswarm_round19_remaining_colors.py`, and `starswarm_round20_spotlight_signals.py`. All are supplied in this ZIP. The code extracts **only newly synthesized signature layers** from the original experiments rather than their older synthetic background beds.

## Listening gate

Does more frequent signature activity finally give the underlying score a distinct Star Swarm sci-fi identity while preserving urgency, power, and musical development? Are the signatures individually recognizable and musically integrated rather than muddy or too constant? Is the 1:05–1:20 overlap too much? Does the 90s arc feel cohesive under combat SFX? No creative approval yet.