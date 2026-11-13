# Sound audition tools (#3673)

Dev tooling for the sound process in [`docs/games/puzzle-sound-design.md`](../../../docs/games/puzzle-sound-design.md) (#3578, #3665): preview the options, then play the game in a browser and check each sound against what is on screen. Nothing here is shipped, and nothing writes to `frontend/assets/sounds/`.

Run every command from the **repo root**. One-time setup:

```bash
python -m venv tools/.venv && source tools/.venv/bin/activate
pip install -r tools/assets/requirements.txt      # numpy, for the Python tools
cd e2e && npm ci && npx playwright install chromium && cd ..   # Playwright, for run.js
```

You also need `ffmpeg` and `ffprobe` on the PATH (libvorbis, libx264, aac, drawtext). To use an installed Chrome instead of Playwright's Chromium, set `CHROME_PATH=/usr/bin/google-chrome`.

## Step 1: preview the options (`preview.py`)

The generators keep each sound's runner-up options next to the pick (`OPTIONS` in the generator, never in `SOUNDS`). Write them to a scratch folder, then package each as an mp4 with a spectrogram still:

```bash
python tools/assets/synth_puzzle_sfx.py --options daily-word-win /tmp/opts     # win-A, B, C
python tools/assets/audition/preview.py /tmp/pv/win-B.mp4 /tmp/opts/daily-word-win-B.ogg --title "Win B"
```

`--options <sound> [scratch_dir]` is on `synth_puzzle_sfx.py`, `synth_arcade_sfx.py` and `synth_starswarm_sfx.py`. The scratch folder defaults to the system temp dir, and the flag refuses `frontend/assets/sounds/`. Option A is the pick that ships (the same recipe as `SOUNDS`); the rest are never shipped. What is saved today:

| Generator             | Options                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `synth_puzzle_sfx`    | `daily-word-win` and `daily-word-loss`: A (mallet run, ships), B (tiles and chimes), C (small and sweet), recovered from the #3665 thread. The design log describes the other runner-ups in words only. |
| `synth_arcade_sfx`    | None: the log gives no recipes. Add to its `OPTIONS` table when an owner asks to "try B again" and the log's description is enough.                                                                     |
| `synth_starswarm_sfx` | None, for the same reason.                                                                                                                                                                              |

To hear a sound in a gameplay rhythm, give `preview.py` several files, each with the second it starts (`file@seconds`):

```bash
python tools/assets/audition/preview.py /tmp/pv/rhythm-B.mp4 \
  frontend/assets/sounds/daily-word-correct-1.ogg@0.15 \
  frontend/assets/sounds/daily-word-correct-2.ogg@0.25 \
  /tmp/opts/daily-word-win-B.ogg@1.0
```

It writes `<out>.mp4` and `<out>.png` (the spectrogram) and prints the numbers the design log quotes: length, size, `level_rms` (dBFS over the loudest 50 ms) and the percent of energy below 300 Hz (phone speakers cannot play it).

## Step 2: play the game and log every sound (`run.js`)

Build the web build for the **dev** API. Use exactly this command, never a plain `expo export` (without `EXPO_PUBLIC_API_URL` the bundle has no API at all, and `EXPO_PUBLIC_TEST_HOOKS=1` is what the e2e builds use):

```bash
cd frontend
rm -rf dist && EXPO_PUBLIC_API_URL=https://dev-games-api.buffingchi.com EXPO_PUBLIC_TEST_HOOKS=1 EXPO_PUBLIC_SENTRY_DSN="" npx expo export --platform web
```

Check that the build holds no production API host. This must print nothing (the dev host is `//dev-games-api...`, so it does not match):

```bash
grep -rl "//games-api.buffingchi.com" dist
```

Serve it, and leave that running:

```bash
npx serve dist -p 8081 --single
```

(`serve` is in `e2e/`: from `frontend/`, `../e2e/node_modules/.bin/serve dist -p 8081 --single`. If 8081 is taken, `serve` picks another port and prints it: pass it to `run.js` with `--base`. `--base` must be a local or dev origin: the page's own origin passes through the network filter, and service workers are blocked.)

Then, from the repo root, record a scenario:

```bash
node tools/assets/audition/run.js --list
node tools/assets/audition/run.js daily-word --out /tmp/aud       # SLATE, too short, XYZZY, TRACE, CRANE
node tools/assets/audition/run.js mahjong --out /tmp/aud          # a four-tile board, select to win
```

| Scenario                 | What it plays                                                                     |
| ------------------------ | --------------------------------------------------------------------------------- |
| `daily-word`             | A won game: SLATE, a too-short word, XYZZY (refused by the server), TRACE, CRANE. |
| `daily-word-loss`        | A lost game: six wrong words, then the answer flips in.                           |
| `mahjong`                | A four-tile board: select, deselect, select, match, select, the winning match.    |
| `yacht`                  | Solo: a roll, two holds, a release, two re-rolls, then a score.                   |
| `twenty48` (also `2048`) | Eight calm swipes and eight fast ones on a board of pairs.                        |
| `twenty48-win`           | 1024 + 1024 merge into 2048, the win card.                                        |

Sort and Sudoku are not scripted yet (their sound stories are separate). A scenario is a function in `run.js`; add one the same way.

Each run writes `<scenario>.webm` and `<scenario>.plays.json` (every `HTMLMediaElement.play`, with its time in seconds from when the page opened; `marks` note moments like the last row). If a scenario fails it saves `<scenario>.failure.png` where it stopped. `AUDIT_DEBUG=1` prints the API calls and blocked requests.

**The network is closed.** The page can reach only `https://dev-games-api.buffingchi.com`, answered by mocks inside `run.js`: `/entitlements` with the JWT mock from `e2e/tests/helpers/api-mock.ts` (keep the two in step; a test compares them), and per-game routes (Daily Word's `/today`, `/guess` scored against the fixed answer CRANE, `/answer`). Every other request is aborted. So a recording never touches a real server, and a build pointed at production would fail loudly.

## Step 3: lay the sounds onto the video (`mix.py`)

```bash
python tools/assets/audition/mix.py /tmp/aud/daily-word.webm \
  --log /tmp/aud/daily-word.plays.json --dist frontend/dist \
  --out /tmp/aud/daily-word-audition.mp4
python tools/assets/audition/mix.py /tmp/aud/mahjong.webm --log /tmp/aud/mahjong.plays.json \
  --dist frontend/dist --skip=-bg- --out /tmp/aud/mahjong-audition.mp4
```

It decodes each logged file from `dist` (the build the recording came from; a file that is not there is an error), mixes it at its logged time onto the video and writes an mp4 with the sounds in it. It lists every sound and its time. `--skip=-bg-` leaves out files whose name contains that text (Mahjong's background music). `--offset 0.04` shifts every sound later by 40 ms if the video and the log sit a frame apart.

To check that a sound lands on the frame it should (a tile turning, a card showing), grab stills at given times, with or without `--out`:

```bash
python tools/assets/audition/mix.py /tmp/aud/daily-word.webm --frames 8.4,18.9 --frames-dir /tmp/aud/frames
```

## Tests

`cd tools && python -m pytest assets/tests/audition_test.py assets/tests/synth_options_test.py`. The ffmpeg tests build their own tiny inputs; the rest of `run.js` (the browser part) needs a web build and is checked by running it.
