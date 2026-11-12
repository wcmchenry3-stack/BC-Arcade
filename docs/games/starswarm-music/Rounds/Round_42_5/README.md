# Round 42.5 — Determined Pursuit (foundation-only emotional experiment)

**Status: awaiting owner feedback (November 12, 2026).** Following the full Round 42 review, the owner approved the seven-minute structure and development but identified a mournful/sad emotional tone. They explicitly requested **no signature sounds** in the next experiment: the underlying score must convey urgency, power and determined engagement by itself.

## Controlled 60-second A/B
- **A — `starswarm-round42_5-A-mournful-control.mp3`**: independent source-code render of original Round 42's opening minute, preserving its original chord and melodic material.
- **B — `starswarm-round42_5-B-determined-pursuit.mp3`**: identical 60-second source-synthesized architecture, pace, dynamics, instrument roles, and section boundaries; only the harmonic grammar and melodic contour/pitch vocabulary are revised. The new passage uses D-minor-ninth, G-major, C-add-nine and A-suspended colors with a more upward-leaning melodic trajectory, intending *conviction and suspense*, **not** celebratory major-key or fantasy music.
- **Neither** contains robotic signals, astronomical rises, Shepard tones, swarm chorus, organ color or electromagnetic choir.

Both are **60.048 seconds**, **24 kHz stereo MP3 at 112 kbps**, **841,052 bytes** each, and approximately **−23.0 LUFS**. This is a controlled *composition and emotion* test, not a final mix or master, and the different melodic material means it is not a literal one-variable instrumentation test.

## Listening gate
1. Does B feel **determined, urgent and mission-driven** rather than mournful or resigned?
2. Does it retain coherent, dark sci-fi suspense rather than becoming triumphant, bright fantasy, or dissonant/noisy?
3. Is the continuous musical motion and expressiveness maintained without signature effects?
4. If it works, transfer the **musical logic** (not a mechanically repeated chord progression) into a revised seven-minute foundation while preserving Round 42's development and variety. If not, revise the underlying emotional grammar before Round 43.

## Reproducibility and files
The complete **`StarSwarm_Round42_5_Determined_Pursuit.zip`** includes the two rendered MP3s, exact procedural original Round 42 source, the short `make_variants.py` orchestration script, exact render scripts `_A_render.py` and `_B_render.py`, and README. No third-party source recordings, samples or prior rendered MP3 were read by the render.

| File | SHA-256 |
|---|---|
| A MP3 | `816294e1562ef9ba5e81194744682b1a13a57cfcb0fe8a303d0164ddfc1f6913` |
| B MP3 | `2d43f82d18fc84303d372e40c007a552547487a41466e0bc0b0233cb1685ea6e` |
| `make_variants.py` | `35c44b1f7357b44e07255d574613f0f69849ba0049b3b4781324d9b480387e3d` |
| `_A_render.py` | `1109fe060759f6ef82e26e4cd092729e18350da3fa041bbca84d0d64aa610865` |
| `_B_render.py` | `066dc301d08d08bf941969e952052647b23023219690c532507edfe2e4d8d5f7` |

**Archive state:** this README is committed to existing draft PR #3734; ZIP and render files are available in ChatGPT but have **not** been uploaded to the PR branch through this connector. Owner can upload the ZIP to this folder. Production game audio remains untouched.

Related: epic #3635, audition #3642, Round 42 README and Round 41 storyboard.

## Owner's explicit sonic target — November 12, 2026 (supersedes the Round 42.5 B tonal experiment)

The owner rejects Round 42.5B as **still not right**, and supplies the following clearer aesthetic direction for the foundation:

> Synthesized ambient and electronic classical arrangement, evoking a cosmic, meditative, ethereal atmosphere. Lush, swirling synthesizer pads and electronic oscillator sweeps producing an expansive cosmic soundscape; a soaring, organ-like electronic lead with sustained hymn-like melody, rich vibrato and vintage warmth; immersive continuous drone integrated seamlessly with melodic phrasing; sparse, deliberate pacing where harmonies swell and decay, conveying profound space and introspection.

**Crucial reconciliation with older constraints:** this is a *sound palette and phrasing aesthetic*, not a cancellation of prior owner approvals that Star Swarm's gameplay BGM needs **urgency, power, conviction, continuous propulsion and a dark sci-fi identity**. “Meditative” and “sparse” must not make the music static, sad, mournful or sleep-inducing. The desired paradox is **spacious textures above a persistent sense of forward motion**, not constant fast arpeggios or rigid beats. The warm, organ-like lead must sound electronically transformed and expansive—not the exposed traditional organ/horn that previously evoked fantasy, and not relentlessly hymn-like/sorrowful.

**Suggested next isolated foundation test, no signature effects:** Compare the existing baseline with a newly *scored* 45–60-second passage emphasizing (a) an internally animated layered pad/drone, (b) a soaring, expressive organ-adjacent lead with musically controlled vibrato, (c) oscillator sweeps woven into harmonic phrase transitions rather than unrelated FX, and (d) slow chord breathing paired with an active but unobtrusive bass/harmonic undercurrent. Reassess the **emotional read** (cosmic conviction vs lament) and felt urgency before rewriting all seven minutes. Do not simply overlay these textures on the existing mournful Round 42 track, or count new layers as orchestral scale. Preserve its successful seven-minute nonrepetitive *structure* as the longer-form template.

**Current status:** owner has supplied a target description; no new render or production change is authorized by this note alone.


## Owner's additional detailed composition specification — Nov 12, 2026

This is an **additive refinement** of the explicit synthesized ambient/electronic-classical foundation target, and takes priority over earlier generic “make the chords more determined” advice.

### 1. Melody / phrasing

- **Slow, hymn-like legato** with held, overlapping notes rather than short/punchy articulated synth notes. Phrases should soar and breathe, not read as a programmed sequence of uniform attacks.
- **Modal or classically inflected harmony**, timeless, reverent, **slightly melancholic** and choral-adjacent. Important nuance: slight melancholy is now **intended**; Round 42's pervasive *mournful/sad/resigned* atmosphere is still rejected. Do not remove all minor/modally ambiguous colors in a simplistic push to major-key “heroism.”
- A sense of purposeful motion may come through the **direction of harmonic swells, controlled tension/release, internal counter-motion and melodic shape**, not necessarily short note durations or percussion.

### 2. Lead and foundation timbres

- One clearly featured **vintage-style monophonic electronic lead**, warm analog-synth / electronic organ-like timbre, with **smooth, expressive vibrato** (ideally varying over notes/phrases, avoiding mechanical constant-depth wobble).
- **Continuous evolving synthesizer pad / multilayered harmonic drone**, rich, cosmic and expansive, with gradual motion within the texture. It should serve the melody; don't mask it.

### 3. Space and mix

- **Sparse, meditative arrangement**: avoid busy arpeggiator layers, dense competing leads and an artificial “make it powerful by piling on tracks” treatment.
- **Lush long-tail reverb** with cathedral/deep-space sense of scale, but control clarity so the lead remains perceptible and reverb doesn't blur melody or cause muddy low-end when multiple notes overlap.
- Electronic sweeps can be *part of the evolving pad / musical texture*; do **not** import our distinct astronomical rise, robotic, swarm, electromagnetic-choir or Shepard signatures yet.

### Next audition and what to judge

Create a **new original foundation-only ~45–60 second test** (rather than layer ornaments over Round 42B) centered on the sustained organ-like legato solo and slowly turning cosmic pads. The lead and pads should sound musically integrated, with spacious reverb. Use the user's target as the primary sonic acceptance test, while separately asking whether the result feels suitably tense/determined for background action or too passive/mournful. **Do not interpret “sparse & meditative” as a request to discard all urgency**, but equally do not force fast driving synth ostinatos at odds with the user's newly explicit melodic specification. This is a listening question to resolve through audio, not assumptions.

No new rendered audio is implied by this written note. Round 42's nonrepetitive seven-minute formal structure remains reusable **only if** the new musical aesthetic is approved.
