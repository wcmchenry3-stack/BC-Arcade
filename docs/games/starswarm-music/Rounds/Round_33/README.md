# Round 33 — Large sci-fi ensemble orchestration test

**Status: awaiting owner audition (November 11, 2026).** Diagnostic only; production audio remains unchanged.

## Core hypothesis

The original BG tracks give the impression of **a large orchestra**, while the more musical Round 31/32 foundation feels like a **small quartet**. Test whether coordinated ensemble orchestration can give more urgency, power and scale **without** slipping back into Renaissance-fair orchestration, clashing harmonics, or the rejected 'more unrelated layers' approach.

## Controlled comparison

Both tracks are **26.064 s, 24 kHz stereo, 128 kbps MP3, 417,452 bytes**, **−14.2 LUFS integrated**; both are rendered independently from original procedural source and have exactly the same core Round 32 notes, expressive lead, supporting harmony, harmonic rhythm and structure. No old ambient recording or third-party source is imported.

- **A — `starswarm-round33-A-small-ensemble-control.mp3`**: original Round 32 quartet-size score resynthesized, with common comparison gain.
- **B — `starswarm-round33-B-large-cinematic-ensemble.mp3`**: same score with a carefully scored sci-fi ensemble: differentiated multi-performer harmonic body; high spectral halo; articulated low harmonic motion; subtly independent section articulations, shared tonal direction and reflections. These supporting instrumental sections are all driven by the *same chord and phrase boundaries*, not separate competing melodies. Mastered to the **same overall LUFS** as A, rather than made louder.

The aim is **perceived musical size/weight**, not simple track count. The lead remains recognizable and its expressive Round 31/32 phrasing is preserved. The expansion may still sound crowded; that is what the audition tests.

## Files

- `starswarm_round33_ensemble_scale.py` is the deterministic generator.
- It imports the **original Round 32 Python generator** at sibling `../Round_32/starswarm_round32_living_neon_lead.py`. The ChatGPT ZIP also includes a copy of that dependency.
- No production game asset, gameplay timing or signature effects are modified. Approved Shepard falls, astronomical rises, robotic signals and swarm choruses remain separate for now.

## Owner decision gate

1. Does B sound notably **larger, more alive and more powerful** than A at the same loudness?
2. Does B retain the **urgency and sci-fi tone**, without turning into fantasy or mushy/noisy stacked synths?
3. Can the main melodic line still be followed? If it feels crowded, reduce/reorchestrate the sections rather than adding yet more layers.
4. If B works, develop contrasting melodic material before claiming a whole seven-minute composition is viable.

## Artifact integrity

| File | Bytes | SHA-256 |
|---|---:|---|
| `starswarm-round33-A-small-ensemble-control.mp3` | 417452 | `c58c63e7b281db9e3a6a6f58fc01d7fc18efd4e618e9a5a6203bfcca89e371b6` |
| `starswarm-round33-B-large-cinematic-ensemble.mp3` | 417452 | `032418c40e769e9ff426980469fdea4baf7a1aefeefeb39ab69b472cd8b455b7` |
| `starswarm_round33_ensemble_scale.py` | 5391 | `09aeb5619d92139aeebc7fa34667b7c42e554abbf70270ed9e5440dcb900817b` |

**Archive state:** source and MP3 files are in the ChatGPT Round 33 ZIP, but cannot be transferred directly to GitHub with the available connector. Upload the three Round 33 files through the repository uploader; Round 32 source must also be present in `Round_32` to reproduce the script. This README is committed to the ongoing [draft PR #3734](https://github.com/wcmchenry3-stack/BC-Arcade/pull/3734).
