# Round 44 — Seven-minute ambient foundation

**Status:** rendered creative audition, **owner listening pending** (November 12, 2026). This follows owner approval of Round 42.8B's **ambient-first electronic palette**, not its one-minute form or any production deployment. Full orchestration of previously approved astronomical rises, Shepard descents, robotic signals, Gathering Swarm Chorus and Electromagnetic Choir is still deferred.

## Creative approach

Keep Round 42.8's **driving but low-fatigue electronic sci-fi current**, broadly suspended pads and drone as the foreground *musical environment*, sparse sustained/expressive warm electronic lead and free mid/high-frequency space for gameplay. Preserve Round 42's successful seven-minute structural *development*, but do not revive its rejected mournful/ceremonial musical vocabulary. The new recording is **newly synthesized**, without sampling prior MP3s, WAV recordings, or third-party BG-1/BG-2/BG-3 tracks.

Seven related but different harmonic/melodic regions are generated at 63 seconds each with 3.5-second equal-power overlaps, giving **420 seconds** of continuous music. Regions vary pad voicings, harmonic pedal centers, subtle oscillator and spectral modulation, restrained low-frequency undercurrent, number/location of electronic lead phrases and dynamic pressure.

| Approximate musical time | Region |
|---|---|
| 0:00–0:59.5 | Persistent horizon — the approved palette, E drone, space for melody |
| 0:59.5–1:59 | Spectral expansion — new suspensions and light |
| 1:59–2:58.5 | Dark current — lower weight and quieter movement |
| 2:58.5–3:58 | Undercurrent — changed drone center and subtle rising brightness |
| 3:58–4:57.5 | New pressure — more dynamic tension without full foreground orchestration |
| 4:57.5–5:57 | Distant resolve — lower energy, gently shifting unresolved color |
| 5:57–7:00 | Return without cadence — revisits initial sonic family in a different harmonic context |

These are composition regions, not timed gameplay events and **not the same 60-second clip looped seven times**.

## Verified deliverables

- MP3: `starswarm-round44-seven-minute-ambient-foundation.mp3`, **420.048 seconds**, **24 kHz stereo**, **128 kbps**, **6,721,196 bytes**.
- Integrated loudness **−23.0 LUFS**, loudness range **6.5 LU**, true peak **−9.5 dBTP**. Clean headroom; the waveform has continuous blends, with no large discontinuity at the six section joins based on join inspection.
- Source: `starswarm_round44_ambient_longform.py`. Reproducible deterministic procedural synthesizer; requires Python, numpy, scipy, soundfile, ffmpeg. No external source audio; no licensed samples.
- `starswarm-round44-seven-minute-ambient-foundation.mp3` and `starswarm_round44_ambient_longform.py` are committed in this directory (the original ZIP was unpacked: it exceeded the 5 MiB limit). The MP3 is 6.4 MiB and allow-listed by exact path and size in `scripts/check_large_files.py`.
- SHA-256 MP3: `0e7e10a3a60d3825a2b60ce75789d9889c20b350108bb1158329275cb032a14d`
- SHA-256 source: `cd0567b4b9502b2887d5470aa1666fff9205351d3626f1edfdb0a9053ec3e854`

## Owner listening questions

1. Does the *entire* seven minutes preserve Round 42.8B's **cosmic, hypnotic suspenseful gameplay-bed character** rather than a ceremonial/mournful standalone song?
2. Are contrasting regions connected and sufficiently developed without growing repetitive or abruptly changing direction?
3. Are quieter passages still moving? Does the restrained lead remain a meaningful accent without monopolizing attention?
4. Is the atmosphere suitable under weapon and explosion SFX, leaving room for *later* signatures?

**Not complete:** final music approval, arranging/varied sound signatures, gameplay SFX level tests, high-fidelity master, a truly seamless final loop (this rough currently fades in and out), distributed safe starts, and replacing game audio.

The MP3 and source are committed in this directory (see above); this documentation was first committed to [draft PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734).

[Music epic #3635](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3635) · [Audition issue #3642](https://github.com/wcmchenry3-stack/BC-Arcade/issues/3642).

## Owner review — November 12, 2026

**Owner verdict: “this is a solid foundation.”** Treat Round 44 as the **accepted working seven-minute ambient bed for future signature orchestration**, preserving its hypnotic sustained momentum, cosmic electronic texture, sparse expressive lead, and evolving/non-repetitive long form. This is **not** final signoff on the complete soundtrack, mastering, codec, loop seam, dynamic mixing beneath gameplay SFX, or integration.

**Next step:** orchestrate the already approved signature sound families against the seven-minute Round 44 foundation, first with a limited placement excerpt as necessary, then over the full arc. Allow roughly **10–20 seconds of foundation-only breathing room** between salient signature events, prioritize musical phrase boundaries over rigid stopwatch spacing, and keep astronomical rises and descending Shepard tones deliberately separated. Recurring appearances should be **musically varied**, not identical pasted samples. Preserve Shepard audibility over moving music and maintain distinct swarm and electromagnetic choir identities. Check that effects do not displace the ambient foundation or overcrowd gameplay SFX. Do not replace production audio until owner reviews the composite.
