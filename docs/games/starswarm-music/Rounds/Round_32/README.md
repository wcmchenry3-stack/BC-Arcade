# Round 32 — Living Neon Lead (timbre-only refinement)

**Status:** awaiting owner audition, November 11, 2026. NOT production game audio.

## Hypothesis
Round 31's original composition, human-feeling phrasing, harmonic clarity and urgency were much closer to the target, but the prominent lead still lacked *distinctive science-fiction color*. Test a tightly controlled replacement of **only the lead oscillator spectrum**, preserving every original musical note, articulation, phrase contour, supporting instrument and spatial reflection.

## Audition

- `starswarm-round32-E-living-neon-lead.mp3` — **26.064 s**, stereo, 24 kHz, 128 kbps MP3, **417,452 bytes**, **−13.7 LUFS** integrated, true peak **−2.1 dBTP**
- `starswarm_round32_living_neon_lead.py` — deterministic from-silence generator; no external recordings, samples, previous-round MP3, or licensed source audio
- Round 31 control: `starswarm-round31-D-expressive-electromagnetic.mp3` — same length, approximately **−13.7 LUFS**

**Only synthesizer-timbre difference:** Round 32 retains expressive note attacks, pitch approaches, timing, durations, volume accents and envelopes but uses a slightly more futuristic lead: subtle evolving FM depth and a coherent harmonic/electronic sheen (minor partial drift and moving upper harmonics), avoiding random chirps or harsh dissonance. The full bed, chords, sub movement and earlier sound features remain unchanged.

### Acceptance questions
1. Does E sound more *unmistakably futuristic* than D **without losing musicality, emotional expression or urgency**?
2. Is any extra electronic shimmer pleasant/organic, or does it make the lead synthetic/clashy again?
3. Is the foreground expressive enough to sustain a longer melodic phrase once we compose new material, without depending on Shepard descents, choirs or astronomical rises?

**Next, only after creative approval:** write a genuinely contrasting second phrase and test a longer arc. Do not stretch/repeat this 26-second figure to seven minutes, and do not reintroduce old mellow ambience as a bed.

## Checksum / archival state
- MP3 SHA-256: `c0523b1e2ce142cd5bc28205d21e508ffeda0ff82c5844b02c2d656d43dda257`
- Python SHA-256: `ceabca01f9cd507d6c64312ee63eb982a8cfcffb9738129ffa64bbcb8c255137`

The audio and Python script are generated and bundled in ChatGPT as `StarSwarm_Round32_Audio_and_Source.zip`. **These two files are not yet committed to the PR branch** because the connector cannot upload local binary artifacts. Upload into `Rounds/Round_32/` before considering the archive complete. Continue on existing draft PR #3734. No production assets changed.

## Owner feedback — orchestral scale is missing (November 11, 2026)

Round 32 is **all right, but not yet a successful foundation**. Owner identifies an important perceptual difference: original BG-1/BG-2/BG-3 sound as though **a big orchestra is performing**, while our Round 30–32 versions feel closer to a **small quartet**. This is a sense of **musical scale, section weight, coordinated instrumental families, and collective expressive motion**, not a literal demand for conventional acoustic orchestra patches. Earlier solo horn/bowed leads caused a medieval/fantasy character, so simply adding traditional orchestral instruments risks regressing.

**Next controlled diagnostic:** keep Round 31/32's musical phrasing and harmonic grammar, but test a **well-orchestrated ensemble**: differentiated low foundation, midrange harmonic body, and high countermovement/air; multiple independently voiced performers *within* the same sections, with subtle timing and expression differences; coordinated crescendos and meaningful register expansion. Give each section a distinct role and allow clear foreground hierarchy. Avoid unison clone stacking, arbitrary extra pitches, masking/brickwall compression, generic cinematic percussion, and the rejected fantasy-sounding lead. Compare same passage at loudness-matched level in (A) quartet-like arrangement and (B) orchestral-scale treatment, preferably with an intermediate size if B gets crowded. Evaluate whether musical weight/urgency increases while keeping the sci-fi/electromagnetic sound and clear melody. No need to add previously approved Shepard, astronomical, robotic or swarm events yet: this is about whether the ordinary music feels **large** on its own.

**Status:** diagnostic hypothesis, not a completed arrangement or approval. Reference music conveys *perceived scale*; do not transcribe/copy an original melody or soundtrack orchestration.
