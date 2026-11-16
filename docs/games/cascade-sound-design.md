# Cascade sound design log (#3702)

This log explains why Cascade's sound effects sound the way they do: the owner's brief, the options auditioned, what was picked and why, and the feedback that shaped it. The other games have their own logs: [`arcade-sound-design.md`](arcade-sound-design.md) (card games, #3563), [`puzzle-sound-design.md`](puzzle-sound-design.md) (puzzle, tile and dice games, #3578) and [`starswarm-sound-design.md`](starswarm-sound-design.md) (#3560).

The **recipes** live in `tools/assets/synth_cascade_sfx.py`, with the shared building blocks in `tools/assets/synth_common.py` (and the glass bell and die tick of `synth_puzzle_sfx.py`). Each file's credit and one-line recipe is in `frontend/assets/sounds/SOUND_CREDITS.md`. What plays when is in [Cascade's Sound section](cascade.md#sound-3702). This log keeps the **reasoning**. Add an entry for every sound you change.

## Brief

- **Before.** Cascade played three borrowed Kenney Digital Audio files: `cascade-fruit-merge.ogg` (5.9 KB, every merge at a volume scaled by tier), `cascade-combo.ogg` (17.4 KB, an old Star Swarm sting, no longer wired) and `cascade-game-over.ogg` (6.1 KB). There was no drop, land, chain, danger or win sound. Cascade was the only game left out of the synthesized-sound work.
- **Owner rules (2026-11-16).**
  - No sound we don't have the recipe for: every Cascade sound is generated in-house, with its recipe in `SOUND_CREDITS.md`. The three Kenney files are removed.
  - The merge ladder is pre-pitched files, one per tier (11 tiers, Cherry to Pumpkin), with no `playbackRate` pitch shift.
  - The sounds are cut to the motion (#3701, `motion.ts`) and the win celebration (#3699, `celebration.ts`).
- **Sounds.** Drop; land (a soft thud scaled by tier); merge per tier, rising with the tier; chain (rising per link, on the counter's 80 ms steps); danger (tied to `dangerRatio`, the blink is ≤ 3 Hz); win (the card at 2.1 s); game over (the card at 1000 ms).

## Direction

The house rules (see [arcade-sound-design.md](arcade-sound-design.md#direction-for-the-whole-set)) hold: original and synthesized from oscillators, noise, envelopes and filters with fixed seeds; frequent sounds short and soft-edged; loudness matched by the loudest 50 ms (`level_rms`), not by peak; mono Ogg Vorbis q5.

**Levels**, the same for both sets so a skin switch never jumps, matched to the shipped sounds (2048's spawn −27, its merge −22, Mahjong's match −20.5, 2048's win −16 and game over −21, in dB over the loudest 50 ms):

| Sound              | Level (dB)                   | Why                                                                                  |
| ------------------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| drop               | −27                          | every turn: the quietest, like 2048's spawn                                          |
| land light / heavy | −26 / −23                    | the player adds 0.6 → 1 volume by tier                                               |
| merge t0 … t10     | −23 → −18 (+0.5 dB per tier) | a bigger merge is a bigger reward (the old file was about −6 before its tier volume) |
| chain 1 … 4        | −22 → −19                    | rising with the chain                                                                |
| danger             | −26                          | it repeats: a nudge, not an alarm; 0.45 → 1 volume by ratio                          |
| win                | −15                          | the top of the ladder, like Yacht's win                                              |
| game over          | −21                          | gentle, like 2048's game over                                                        |

## Round 1: three sets (2026-11-16)

Three complete sets of 20 sounds (the Cosmos win was then an optional 21st), each a spectrogram mp4 with every sound labelled: drop, land on t0/t5/t9, merge t0 … t10, a 4-chain, danger at ratio 0.3/0.7/1.0, win and game over. The prototype is in the #3702 thread.

- **A, "Wooden marimba".** Warm and round: a woodblock "tok" drop, a muffled wooden thud, a wooden knock plus a marimba note per merge (C4 → C6), a marimba run and rolled chord for the win. The house's mallet vocabulary, but a cousin of 2048.
- **B, "Juicy pops"** (picked for Fruits). Bubbly and plucky: a bubble "plip" drop, a squish landing, a bubble pop plus a Karplus-Strong plucked string per merge (G4 → G6) with a fizz of bubbles on big fruit, a "bloop-bloop" heartbeat for danger, a fizz into a strummed chord for the win and a deflating balloon for the game over. The most "fruit" character.
- **C, "Glass chimes".** Crystalline: a glass tick drop, a felt thud with a faint ring, a glass bell per merge (C5 → C7), crystal pings, a chime cascade win.

**Budget.** At the house encoding the sets came to 170-196 KB against the 120 KB budget (#3692): every Ogg carries about 3.7 KB of fixed Vorbis header, so 20 files cost about 75 KB before any audio. The round-1 clips were encoded at 22.05 kHz q3 to fit (103-116 KB), with two landing files instead of three and shorter merges. The owner asked for the house encoding instead and **raised the budget** (below).

**Pick: B for Fruits**, and Cosmos gets its own full set rather than a variant of the win.

## Round 2: three Cosmos sets (2026-11-16)

All "space", distinct from Fruits' bubbles and plucks, at the same loudness and punch, at 44.1 kHz q5:

- **A, "Retro blips".** FM "blip-bells" that glide up into a pure tone, a sub "whumf" landing, a sonar beep for danger, an FM arpeggio with a galaxy-swirl sweep for the win, a power-down slide for the game over. The punchiest; risks reading as 8-bit arcade.
- **B, "Starlight glass"** (picked). A glass bell per merge over a sub sine that grows with the tier (a planet's weight), a two-note twinkle drop, crystal pings with an echo, a low bell beating against its neighbour for danger, a deep pad and glass run into a bright chord for the win, falling glass over a dark drone for the game over.
- **C, "Orbit bells".** Soft chorused "orb" tones with space echoes: the most ambient, the largest (192 KB), and its echoes smear in fast chains.

**Pick: B for Cosmos.** Bells read pitch most clearly across 11 tiers, the sub gives big planets weight, it is the smallest of the three, and it reads as space at once.

## What shipped

- **Two sets of 21 files** (`cascade-fruits-*`, `cascade-cosmos-*`): drop, land light and heavy, merge t0 … t10, chain 1 … 4, danger, win, game over. (The plan said 20 per set; drop + 2 + 11 + 4 + danger + win + game over is 21.) The recipes are the approved clips' exactly: the generator's output decodes identically to the audition files.
- **Size:** 345,258 B (Fruits 182,373, Cosmos 162,885) at 44.1 kHz mono q5. The owner raised Cascade's sound budget from 120 KB to about 345 KB; `frontend/src/game/cascade/__tests__/sounds.test.ts` caps it at 350 KiB. The three Kenney files (29,360 B) are deleted.
- **Timing.** Merges (0.35-0.67 s) end inside the merge's 620 ms confetti; the chain steps (≤ 0.2 s) sit on the 80 ms steps; each danger tick (≤ 0.3 s) is shorter than the fastest blink period (340 ms), so ticks never overlap; the win's chord is at 2.1 s and the game over's at 1.0 s from when they start, which is the winning merge and the game over. `tools/assets/tests/synth_cascade_sfx_test.py` reads these numbers from `motion.ts` and `celebration.ts`.

## Deviations from the brief, and known limits

- **Danger rate.** The plan asked for 1 + 2 × ratio ticks a second, at most 3 Hz, phase-locked to the blink. The tick follows the blink instead, one per on-beat: the board's UI-thread frame callback, which steps the blink, calls the pacer when an on-beat starts (review S1: a second phase integrated on the JS thread drifted by 120-136 ms on a JS stall). The blink's period is 1000 → 340 ms (`dangerPeriodMs`, 1.0 → 2.94 Hz), so at ratio 0.5 the tick is 1.5 Hz, not 2. It never passes 3 Hz either way.
- **Danger under Reduce Motion.** There is no blink (#3701), so no onsets. The tick keeps its own timer at the period the blink would have: the warning is a sound, not motion, so a Reduce Motion player still hears it.
- **Reduce Motion win.** The card comes at 1.6 s; the win file starts 0.5 s in, so its chord lands with it.
- **A late celebration.** The win sound starts at the winning merge. If the celebration's style is not ready by then (it is built ahead while a tier-9 piece is on the board, so it normally is), the celebration starts late and its card can come up to the delay later than the chord.
- **Phone speakers** (for the owner's ear check on iOS and Android). Some sounds are mostly below 300 Hz, where phone speakers give little: Fruits' landings (95-97 %), Fruits' danger heartbeat (125 Hz, 100 %) and Cosmos' landings (97-99 %, the sub "whumf"). The clips were approved on full-range playback. If the danger tick is too quiet on a phone, the fix is a harmonic an octave or two up, not more volume.
- **DC in the plucks.** The Karplus-Strong plucks keep a little of their noise burst's DC offset (inaudible); in Fruits' t4, t8 and t10 it is a quarter to a third of the energy, so those merges sound up to about 2 dB quieter than their level says. Left as approved; a DC block would change the levels the owner heard.

## Removed

| File                      | Size     | Source                                      | Now                               |
| ------------------------- | -------- | ------------------------------------------- | --------------------------------- |
| `cascade-fruit-merge.ogg` | 5,910 B  | Kenney Digital Audio (`tile-move.ogg`)      | `cascade-<set>-merge-t0` … `-t10` |
| `cascade-combo.ogg`       | 17,357 B | Kenney Digital Audio (`twotone`, not wired) | `cascade-<set>-chain-1` … `-4`    |
| `cascade-game-over.ogg`   | 6,093 B  | Kenney Digital Audio (`phaserDown2.ogg`)    | `cascade-<set>-game-over`         |
