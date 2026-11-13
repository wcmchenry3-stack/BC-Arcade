# Sort sound prototypes (#3661), archived

The scripts the Sort "glass and water" sounds were designed with: every round's options, including the ones not picked, so a sound can be recreated or changed later. **Reference only.** The shipped recipes live in [`tools/assets/synth_puzzle_sfx.py`](../../../tools/assets/synth_puzzle_sfx.py), which is the source of truth (and what generates `frontend/assets/sounds/sort-*.ogg`). The reasoning and the owner's feedback are in the [design log](../puzzle-sound-design.md). The same convention as [`../starswarm-music`](../starswarm-music): design/research scripts, linted with no rules (`ruff.toml`), scripts only (no audio or video).

## Scripts

| Script        | Round | What it is                                                                                                                                                                                                                                   |
| ------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sort_sfx.py` | 1     | The recipes for all seven sounds, options **A**, B and C each: select, pour lift, one-bubble glug (replaced), refused, complete, undo, hint, win. Imported by the others. **A** shipped for every sound except the pour.                     |
| `render.py`   | 1     | Renders every round-1 option to `out/<sound>-<option>-<n>.ogg` and `.wav` and prints length, size, level (loudest 50 ms RMS), peak and energy below 300 Hz.                                                                                  |
| `preview.py`  | 1     | Builds the gameplay-rhythm preview videos (a spectrogram card with the sounds laid at their motion times) from `render.py`'s output. Needs Pillow and ffmpeg.                                                                                |
| `glug2.py`    | 2     | Three "glug glug glug" options (A classic bottle glug, B deeper, C bubblier): three gulps per unit, one file per unit slot. A was picked, then **rejected** at the audition ("not liquid pouring").                                          |
| `pour3.py`    | 3     | Three continuous noise-formant streams (hiss, splash, a rising resonance). **Rejected**: "wavy, not like a liquid".                                                                                                                          |
| `pour4.py`    | 4     | Van den Doel bubble model, options A, B and C: a Poisson stream of damped-sinusoid bubbles (Minnaert frequency, rising chirp, power-law radii, pitch rising as the bottle fills). **A shipped** (`sort-pour-stream-{1,2,3,4}u-{1,2,3}.ogg`). |
| `_paths.py`   | n/a   | Import paths (this folder and `tools/assets` for `synth_common`) and the output folder.                                                                                                                                                      |

## Running

Needs numpy, Pillow and ffmpeg with libvorbis (and `synth_common.py` from `tools/assets`, found automatically). Run from this folder; all output goes to a temp folder (`$TMPDIR/sort-sfx-3661`), or `SORT_SFX_OUT=/some/dir`, **never** into `frontend/assets`.

```
python render.py     # round 1 audio (also what pour3/pour4's previews take the lift from)
python preview.py    # round 1 preview videos (after render.py)
python glug2.py      # round 2: audio and preview
python pour3.py      # round 3: audio and preview
python pour4.py      # round 4: audio and preview (needs render.py first, for the lift)
```

Previews are not stored; they rebuild from the scripts. Seeds are fixed, so the audio is reproducible: round 1's option A files and `pour4.py`'s `stream4-A-<n>u-<v>.ogg` decode to the same PCM (`synth_common.decoded_pcm_sha256`) as the shipped `sort-*.ogg` files. To change a shipped sound, edit `synth_puzzle_sfx.py` (and its tests and credits), not these scripts.
