# Round 31 — Expressive performance of the electromagnetic lead

**Status:** owner audition pending (November 11, 2026).

## Creative question
The owner liked Round 30's harmony, sense of power, sci-fi character and ensemble balance, but the **lead sounded synthetic and lifeless, almost like a computer checking off notes**. The primary mood criteria are **urgency first, with power**, while cosmic grandeur, mystery, choruses and Shepard tones remain supporting elements. The next musical goal is **expressive performance** rather than more instrumental layers.

## Controlled test
- **`starswarm-round31-D-expressive-electromagnetic.mp3`** (26.064 s, 24 kHz stereo, 128 kbps, 417,452 bytes): same original harmonic/bass and atmospheric arrangement as Round 30C, with only the prominent lead synthesized and performed differently.
- **`starswarm_round31_expressive_lead.py`**: exact original synthesis script, deterministic; no reuse of earlier MP3 audio or original licensed sources.
- **Control**: `starswarm-round30-C-harmonic-electromagnetic.mp3` (26.064 s).

### Lead-expression changes
- Strong vs restrained note attacks based on musical role (not random variation).
- Small intentional timing inflections and select cadence holds.
- Moving brightness and harmonics **within** sustained notes, plus restrained evolving FM character.
- Short deliberate pitch approach/settling, with per-phrase accent contour.
- No extra instrument lines, new effects, reorchestration, tempo change, or more reverb.

The relative mix is close: **Round 31 −13.7 LUFS**, vs **Round 30 −13.4 LUFS**. True peak **−2.1 dBTP**.

## Acceptance gate
Does Round 31 feel more *alive, urgent and emotionally performed* without losing Round 30's coherent sci-fi force? Listen to phrase connections and the final ~10 seconds. If the lead still feels mechanical, determine whether performance or deeper compositional development is missing; do not immediately add more layers. If expressive performance works, compose a **second genuinely contrasting musical phrase** before testing whether the core can fill seven minutes. The special effects remain approved but excluded from this diagnosis.

## Integrity
| File | Bytes | SHA-256 |
|---|---:|---|
| `starswarm-round31-D-expressive-electromagnetic.mp3` | 417452 | `98b9dd528e71e82f5365e291e007e7fcaf59c4a9d6e856d314ddcad34e340fc8` |
| `starswarm_round31_expressive_lead.py` | 7855 | `e9cb95b06842e8bf7037348d40362823e5ea6f73399a037777f516570818f0de` |

**Archival status:** the MP3 and exact generator are present in the ChatGPT Round 31 ZIP, but are **not yet committed** to GitHub. This connector cannot transfer binary bytes or local source files directly. Add both files to this directory through the repo uploader before calling the round fully archived. The README is committed to the ongoing draft PR #3734; no production game files were changed.
