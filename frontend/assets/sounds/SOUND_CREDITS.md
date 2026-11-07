# BC Arcade — Sound Asset Credits

Attribution is tracked here even when the license does not require it.
This protects against provenance loss if a source URL becomes unavailable.

## License snapshot policy

When adding a sound:

1. Record the source URL, license name, and the full license text or a permalink
   to an archived copy (e.g. web.archive.org snapshot).
2. Record the download date — licenses can change for _new_ assets; your copy
   is protected under the terms in effect on the download date.
3. Use a semantic filename (`<game>-<event>.mp3`) — never commit the raw
   download filename. Keep the original filename here for traceability.
4. If attribution is required (CC-BY etc.), add the credit string to
   `frontend/src/screens/CreditsScreen.tsx` (or equivalent) as well.

---

## Hearts

### hearts-moon-shot.mp3

- **Event:** Shooting the moon (player takes all 13 hearts + Queen of Spades)
- **Original filename:** u_it78ck90s3-orchestral-win-331233.mp3
- **Source URL:** https://pixabay.com/sound-effects/orchestral-win-331233/
- **Creator:** u_it78ck90s3 on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-25
- **Notes:** Orchestral win fanfare. Replaced original "wow" sting for a more triumphant moon-shot feel.
- **Replaced:** kaykay12-wow-171498.mp3 (https://pixabay.com/sound-effects/wow-171498/) — swapped 2026-04-25

### hearts-broken.mp3

- **Event:** Hearts broken (first heart played into a trick)
- **Original filename:** lordsonny-rock-break-hard-184891.mp3
- **Source URL:** https://pixabay.com/sound-effects/rock-break-hard-184891/
- **Creator:** lordsonny on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-25
- **Notes:** Hard rock-break crack (~0.5s). Represents the moment hearts shatter open.

### hearts-queen-of-spades.mp3

- **Event:** Queen of Spades played into a trick
- **Original filename:** phoenix_connection_brazil-surprise-sound-effect-99300.mp3
- **Source URL:** https://pixabay.com/sound-effects/surprise-sound-effect-99300/
- **Creator:** phoenix_connection_brazil on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-25
- **Notes:** Ominous surprise sting (~0.75s). Signals the Black Maria landing.

---

## FreeCell (#844)

### freecell-card-place.mp3

- **Event:** Card placed to tableau, free cell, or foundation
- **Original filename:** `571575__el_boss__playing-card-deal-variation-3.wav` (preview lq)
- **Source URL:** https://freesound.org/people/el_boss/sounds/571575/
- **Creator:** el_boss on Freesound
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-25
- **Notes:** Louder variation of a card dealing onto a wooden table; suitable for any card placement event.

### freecell-supermove.mp3

- **Event:** Multi-card supermove (≥2 cards moved at once)
- **Original filename:** `60013__qubodup__whoosh.wav` (preview lq)
- **Source URL:** https://freesound.org/people/qubodup/sounds/60013/
- **Creator:** qubodup on Freesound
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-25
- **Notes:** Short air whoosh. Represents the satisfying sweep of multiple cards moving together.

### freecell-foundation-complete.mp3

- **Event:** All 13 cards of one suit placed on its foundation (fires up to 4×)
- **Original filename:** `456967__FunWithSound__success-resolution-video-game-sound-effect-strings.mp3` (preview lq)
- **Source URL:** https://freesound.org/people/FunWithSound/sounds/456967/
- **Creator:** FunWithSound on Freesound
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-25
- **Notes:** Strings success sting. Rising resolution tone, perfect for completing a suit.

### freecell-game-win.mp3

- **Event:** All 52 cards placed in foundations — game complete
- **Original filename:** `466133__humanoide9000__victory-fanfare.mp3` (preview lq)
- **Source URL:** https://freesound.org/people/humanoide9000/sounds/466133/
- **Creator:** humanoide9000 on Freesound
- **License:** Creative Commons Attribution 4.0 (CC-BY 4.0)
- **License URL:** https://creativecommons.org/licenses/by/4.0/
- **Attribution required:** Yes — credit "humanoide9000 on Freesound"
- **Commercial use:** Yes (with attribution)
- **Download date:** 2026-04-25
- **Notes:** Short victory fanfare. Triumphant conclusion to a completed FreeCell game.

### freecell-invalid-move.mp3

- **Event:** Move rejected — wrong card, full free cell, or supermove limit exceeded
- **Original filename:** `493163__Breviceps__buzzer-wrong-answer-error.mp3` (preview lq)
- **Source URL:** https://freesound.org/people/Breviceps/sounds/493163/
- **Creator:** Breviceps on Freesound
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-25
- **Notes:** Short buzzer for wrong answer / error. Signals an invalid move without being jarring.

---

## Star Swarm (#803)

### Provenance of the original gameplay sounds (#2492)

Three of the original gameplay sounds were shipped unchanged: `starswarm-explosion.ogg` (still shipped)
and the since-retired `starswarm-laser.ogg` (retired in #3560) and `starswarm-freefirezone.ogg`. They were committed without a source
filename. Each carries the title Kenney embedded in it (a Vorbis `TITLE` comment, encoder
`Xiph.Org libVorbis I 20070622`) — the same tag convention and encoder as the repo's other Kenney
Digital Audio sounds (for example `blackjack-win.ogg` carries `TITLE=powerUp1` and is Digital Audio
`powerUp1.ogg`). Where the title is also a filename in that pack, the match is definite.

#3526 replaced the rest of the Star Swarm set (the byte-identical power-up copies, the charge shot,
and the game-over / wave-clear / player-hit sounds) with the files below. Every file added in
#3526 was prepared once and shipped as-is; the "Edit" line records how it was made from the pack
file. All are Kenney, CC0 1.0, and need no attribution.

#3560 is replacing the Star Swarm set again, sound by sound, with **original sounds synthesized
in-house** by `tools/assets/synth_starswarm_sfx.py` (no samples, no third-party audio). Their entries
below say "Original sound, synthesized" and give the generator command and a one-line recipe.

### starswarm-explosion.ogg

- **Event:** Any new explosion (every enemy kill), except on the tick a Smart Bomb detonates or a Buddy goes down (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds explosion`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.30 s "digital puff": a retro falling blip (900 -> 110 Hz) over a soft filtered puff. Light, because it plays on every kill; default volume 0.2. Replaced a 0.91 s file.

### starswarm-asteroid-split.ogg

- **Event:** A large rock breaks (shot, bomb or contact), `starswarm.asteroidsplit` (#3560); it replaces the generic explosion for rock breaks
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds asteroid-split`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.50 s "rock cracking in two": a double stone crack, a low knock and scattering gravel. Stone, not fire, so a rock break never sounds like a kill; shares the `asteroid` volume (default 0.5). #3560 consistency pass: cracks and gravel darkened (crack to 3.5 kHz, gravel to 3 kHz).

### starswarm-asteroid-small.ogg

- **Event:** A small rock breaks, including shattering on a hull, `starswarm.asteroidsmall` (#3560); it replaces the generic explosion for rock breaks
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds asteroid-small`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.30 s "small rock destroyed": a higher crack and a little gravel; baked quieter than the split sound. #3560 consistency pass: crack and gravel darkened (to ~4 kHz).

### starswarm-bosswave.ogg (`starswarm.bosswave`)

- **Event:** Boss wave sighted: the Carrier and its escorts swoop in (#2490); also the Carrier's final stand (#2843). #3560 replaced the old `starswarm-freefirezone.ogg` (Kenney Digital Audio `phaserUp5`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds bosswave`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.50 s "ominous horn": a slow two-note synth-brass horn, "dun... DUN", stepping down a semitone (110 -> 103.8 Hz), with a sub thump under the second note and a little of the beam charge's reactor buzz underneath.

### starswarm-pickup.ogg (`starswarm.poweruplightning` / `powerupshield` / `powerupbuddy` / `powerupbomb` / `salvage` / `hullup`)

- **Event:** Collecting any ordinary power-up (banked or not), a salvage crate or hull plating (#3526, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds pickup`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.42 s "warm mallet": two soft mallet notes rising a fifth (C5 -> G5) with a faint shimmer an octave above. Replaced the Kenney Digital Audio `spaceTrash5` (1.43 s).

### starswarm-bombblast.ogg (`starswarm.bombblast`)

- **Event:** Smart Bomb detonates (#3526, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds bombblast`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.50 s "shockwave": a sub boom plus an expanding "whumm" as a noise band opens and closes. Replaced the Kenney Sci-Fi Sounds `explosionCrunch_004`.

### starswarm-shield-on.ogg (`starswarm.shieldon`)

- **Event:** Once on the tick the Shield becomes active (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds shield-on`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.40 s rising shimmer, the loudest part of the Shield set.

### starswarm-shield-loop.ogg (`starswarm.shieldloop`)

- **Event:** Loop while the Shield power-up is active (#3526, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds shield-loop`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.0 s seamless soft two-tone hum (220/330/440 Hz), baked quiet under the other sounds. Replaced the Kenney Sci-Fi Sounds `engineCircular_000`.

### starswarm-shield-warn.ogg (`starswarm.shieldwarn`)

- **Event:** Once per Shield activation, when 1 s of the Shield is left (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds shield-warn`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.70 s stutter, a warning that the Shield is about to end.

### starswarm-shield-off.ogg (`starswarm.shieldoff`)

- **Event:** Once when an active Shield stops for any in-run reason: expiry, replaced by Lightning, wave boundary (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds shield-off`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.45 s falling sweep.

### starswarm-buddy-in.ogg (`starswarm.buddyin`)

- **Event:** A Buddy ship enters (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds buddy-in`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.55 s soft thruster whoosh in.

### starswarm-buddy-loop.ogg (`starswarm.buddyloop`)

- **Event:** Loop while a Buddy is on station (#3526, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds buddy-loop`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.0 s seamless quiet hover warble, quieter than the Shield hum. Replaced the Kenney Sci-Fi Sounds `spaceEngineSmall_003`.

### starswarm-buddy-out.ogg (`starswarm.buddyout`)

- **Event:** A Buddy peels off and leaves (not when it is shot down) (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds buddy-out`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.75 s fly-by fade out.

### starswarm-buddy-down.ogg (`starswarm.buddydown`)

- **Event:** A Buddy is shot down; replaces the generic explosion sound that tick (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds buddy-down`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.90 s: three sad descending blips (E5, C5, G4) then a soft pop.

### starswarm-lightning-loop.ogg (`starswarm.lightningloop`)

- **Event:** Loop while the Lightning power-up is active; replaced the per-shot laser (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds lightning-loop`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.0 s seamless "Tesla-coil buzz": a buzzing 120 Hz saw arc with a 30 Hz flutter and fixed-position crackles. #3560 consistency pass: crackles low-passed at 4 kHz and ~3 dB quieter (it was the brightest sound in the set).

### starswarm-rout-loop.ogg (`starswarm.rout`)

- **Event:** Loop while any grunt is Fleeing, the ROUT! banner's condition (#2489, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds rout-loop`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.00 s seamless loop, "panic warble": one engine at ~165 Hz with a 6 Hz vibrato and a 3 Hz tremolo over a dark roar. Every modulation completes whole cycles in the loop; the tail is equal-power crossfaded into the head.

### starswarm-guns-1.ogg (`starswarm.guns1`)

- **Event:** Gun level rises to 1 (#2488, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds guns-1`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** "laser blips": 1 bright blip bending up, climbing C5-E5-G5 (0.09 s apart).

### starswarm-guns-2.ogg (`starswarm.guns2`)

- **Event:** Gun level rises to 2 (#2488, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds guns-2`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** "laser blips": 2 bright blips bending up, climbing C5-E5-G5 (0.09 s apart).

### starswarm-guns-3.ogg (`starswarm.guns3`)

- **Event:** Gun level rises to 3 (#2488, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds guns-3`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** "laser blips": 3 bright blips bending up, climbing C5-E5-G5 (0.09 s apart).

### starswarm-gunsdown-1.ogg (`starswarm.gunsdown1`)

- **Event:** Gun level drops to 1 (a life lost) (#2488, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds gunsdown-1`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1 duller blip in a lower octave and a minor key that bend down (Eb4, 0.13 s apart), so a loss never sounds like a reward.

### starswarm-gunsdown-2.ogg (`starswarm.gunsdown2`)

- **Event:** Gun level drops to 2 (a life lost) (#2488, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds gunsdown-2`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2 duller blips in a lower octave and a minor key that bend down (Eb4, C4, 0.13 s apart), so a loss never sounds like a reward.

### starswarm-beamcharge.ogg (`starswarm.beamcharge`)

- **Event:** Carrier beam telegraph (`BEAM_CHARGE_MS` = 600 ms) (#2485, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds beamcharge`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.60 s "reactor" charge-up: a low buzz brightens and climbs ~0.6 octave while a pulse speeds up 3 -> 12 Hz. Ends as the beam fires. #3560 consistency pass: most of the 27-41 Hz sub moved to the 2nd/3rd harmonics so phone speakers play the warning (generator recipe `beam_charge_phone`); default volume 0.9.

### starswarm-attackrun.ogg (`starswarm.attackrun`)

- **Event:** Carrier attack-run brace (`ATTACK_RUN_BRACE_MS` = 800 ms) and the start of the swoop (#2843, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds attackrun`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.30 s: a 0.80 s "throttle-up" (rounded engine 52 -> 104 Hz with harmonics for small speakers, gentle throb 10 -> 24 Hz, dark rumble opening up), then a 0.5 s roar-away tail as the Carrier dives.

### starswarm-beamfire.ogg (`starswarm.beamfire`)

- **Event:** Carrier beam release (#2485, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds beamfire`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.90 s plasma blast: a detuned saw chord diving together, ring-modulated, with a sub thump and a short echo. The dive takes ~0.5 s (the bolt crosses the lane in ~0.4 s); the rest is ring-out.

### starswarm-reinforce.ogg (`starswarm.reinforce`)

- **Event:** Carrier reinforcements launch (#2485, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds reinforce`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.35 s: an airlock door (soft latch and a pressure "pfft"), then one smooth turbine spin-up (110 -> 230 Hz, dark roar opening up) that fades as the Grunts fly into formation.

### starswarm-waveclear.ogg (`starswarm.waveclear`)

- **Event:** Wave cleared (last kill) (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds waveclear`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.50 s "sector cleared": a rising laser sweep into a bright synth-brass major chord with an FM bell on top, echoing. Replaced Music Jingles `jingles_HIT11`.

### starswarm-bonuslife.ogg (`starswarm.bonuslife`)

- **Event:** Bonus life awarded (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds bonuslife`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.20 s "laser 1-up": the gun riff's laser blips race up two octaves into a held synth pad, echoing. Replaced Music Jingles `jingles_HIT16`.

### starswarm-gameover.ogg (`starswarm.gameover`)

- **Event:** Game over (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds gameover`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.00 s "descending minor brass": "dun, dun, duuun" (G4 Eb4 C4) in the boss horn's synth brass, with a sub under the last note. Replaced Music Jingles `jingles_HIT15`.

### starswarm-playerhit.ogg

- **Event:** A life is lost (not the fatal hit) (#3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds playerhit`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.70 s "damage alarm": an impact thump, then a descending two-tone warning (F#5 -> C#5). Replaced Kenney Music Jingles `jingles_HIT04`.

### starswarm-hullhit.ogg

- **Event:** Hull plating absorbs a hit (#2488, #3560)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3560). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_starswarm_sfx.py` (`python tools/assets/synth_starswarm_sfx.py frontend/assets/sounds hullhit`), fixed seed, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.32 s "dull plate thud": a low-mid knock with a short metallic rattle. Lighter than a life lost. Replaced Kenney Music Jingles `jingles_HIT00`.

### starswarm-bg-1.mp3 — starswarm-bg-4.mp3

- **Event:** Background music (looping ambient track, one chosen at random per game)
- **Original filenames:**
  - `audiopapkin-ambient-soundscapes-003-space-atmosphere-303242.mp3` → bg-1
  - `audiopapkin-ambient-soundscapes-001-space-atmosphere-303246.mp3` → bg-2
  - `audiopapkin-ambient-soundscapes-004-space-atmosphere-303243.mp3` → bg-3
  - `audiopapkin-ambient-soundscapes-007-space-atmosphere-304974.mp3` → bg-4
- **Source URL:** https://pixabay.com/users/audiopapkin-42202696/ (Pixabay)
- **Creator:** audiopapkin on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Ambient space-atmosphere soundscapes. Played at 20% volume (BG_VOLUME = 0.2) looped.
  File sizes are 4.4–6.1 MB each — exceed the 500 KB spec target. Compress with ffmpeg if needed:
  `ffmpeg -i starswarm-bg-N.mp3 -b:a 32k starswarm-bg-N-compressed.mp3`

---

## Twenty48 (#829)

### twenty48-tile-merge.ogg

- **Event:** Tile merge (two equal tiles combine)
- **Original filename:** `drop_001.ogg` from Kenney Interface Sounds
- **Source URL:** https://kenney.nl/assets/interface-sounds
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Short soft drop thud — muted "tile placed on a surface" feel. Played at volume 0.3. Sits in the background without becoming grating during extended play.
- **Replaced:** `pepSound2.ogg` from Kenney Digital Audio (https://kenney.nl/assets/digital-audio) — swapped 2026-04-26; original was too sharp and upbeat for a slow puzzle game (#936).

### twenty48-tile-spawn.ogg

- **Event:** New tile spawned on the board
- **Original filename:** `tone1.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Subtle single tone for the tile appearing after each move. Played at volume 0.2 (#936) — fires on every move so sits well in the background.

### twenty48-win.mp3

- **Event:** Player reaches the 2048 tile (win)
- **Original filename:** (reuses `hearts-moon-shot.mp3` — see Hearts section above)
- **Source URL:** https://pixabay.com/sound-effects/orchestral-win-331233/
- **Creator:** u_it78ck90s3 on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Notes:** Same orchestral win fanfare reused by Yacht and Blackjack for big moments.

### twenty48-game-over.ogg

- **Event:** Game over (no valid moves remain)
- **Original filename:** `phaserDown2.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Descending phaser tone — signals no moves remaining without being harsh.

---

## Sudoku (#833)

### sudoku-digit-place.ogg

- **Event:** Digit placed in a cell (normal mode, any digit)
- **Original filename:** `pepSound1.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Short upbeat pep sound — subtle confirmation of each digit placement.

### sudoku-error-entered.ogg

- **Event:** Wrong digit entered (value doesn't match solution)
- **Original filename:** `lowDown.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Descending digital tone. Accompanies the red flash on an incorrect digit.

### sudoku-unit-complete.ogg

- **Event:** A full row, column, or 3×3/2×3 box is completed correctly
- **Original filename:** `phaserUp1.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Rising phaser sting. Fires once per completed unit; multiple units completing on the same digit play the sound once each.

### sudoku-puzzle-complete (reuses hearts-moon-shot.mp3)

- **Event:** Puzzle fully solved (all cells filled correctly)
- **Original filename:** (reuses `hearts-moon-shot.mp3` — see Hearts section above)
- **Source URL:** https://pixabay.com/sound-effects/orchestral-win-331233/
- **Creator:** u_it78ck90s3 on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Notes:** Same orchestral win fanfare reused by Yacht, Twenty48, Blackjack, and Solitaire.

### daily-word-win (reuses hearts-moon-shot.mp3)

- **Event:** Daily Word puzzle solved (#2926)
- **Original filename:** (reuses `hearts-moon-shot.mp3` — see Hearts section above)
- **Source URL:** https://pixabay.com/sound-effects/orchestral-win-331233/
- **Creator:** u_it78ck90s3 on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Notes:** Same orchestral win fanfare as the other games' win stings.

---

## Solitaire (#831)

### solitaire-card-flip.ogg

- **Event:** Stock draw (cards flipped face-up) and face-down tableau card revealed
- **Original filename:** `card-slide-2.ogg` from Kenney Casino Audio 1.1
- **Source URL:** https://kenney.nl/assets/casino-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Card slide sound. Used for both stock draws and revealing a face-down tableau card.

### solitaire-card-place.ogg

- **Event:** Any card placed to tableau or foundation
- **Original filename:** `card-place-2.ogg` from Kenney Casino Audio 1.1
- **Source URL:** https://kenney.nl/assets/casino-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Card placement thud. Plays on every valid card move.

### solitaire-foundation-complete.ogg

- **Event:** All 13 cards of one suit placed on its foundation (fires up to 4×)
- **Original filename:** `powerUp1.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Rising power-up tone. Signals the satisfying completion of a full suit.

### solitaire-invalid-move.ogg

- **Event:** Move rejected (wrong card, wrong pile)
- **Original filename:** `lowDown.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Descending digital tone. Accompanies the red flash on an invalid move.

### solitaire-game-win (reuses hearts-moon-shot.mp3)

- **Event:** Game complete (all 52 cards in foundations)
- **Original filename:** (reuses `hearts-moon-shot.mp3` — see Hearts section above)
- **Source URL:** https://pixabay.com/sound-effects/orchestral-win-331233/
- **Creator:** u_it78ck90s3 on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Notes:** Same orchestral win fanfare reused by Yacht, Twenty48, and Blackjack for big moments.

---

## Yacht (#827)

### yacht-dice-roll.ogg

- **Event:** Dice rolled (every roll action)
- **Original filename:** `dice-shake-1.ogg` from Kenney Casino Audio 1.1
- **Source URL:** https://kenney.nl/assets/casino-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Dice shaking sound from the Kenney Casino Audio pack.

### yacht-die-hold.ogg

- **Event:** Die toggled hold / release
- **Original filename:** `chip-lay-1.ogg` from Kenney Casino Audio 1.1
- **Source URL:** https://kenney.nl/assets/casino-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Short chip-place click used as a satisfying toggle sound.

### yacht-yacht.mp3

- **Event:** Yacht scored (all 5 dice match)
- **Original filename:** (reuses `hearts-moon-shot.mp3` — see Hearts section above)
- **Source URL:** https://pixabay.com/sound-effects/orchestral-win-331233/
- **Creator:** u_it78ck90s3 on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Notes:** Same orchestral win fanfare reused by Blackjack (#826) for big moments.

### yacht-straight.ogg

- **Event:** Large or small straight scored
- **Original filename:** `highUp.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Ascending digital tone — suits the "streak" feeling of a straight.

### yacht-upper-bonus.ogg

- **Event:** Upper section bonus reached (cumulative upper score ≥ 63)
- **Original filename:** `pepSound3.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Upbeat pep sound for a one-time bonus notification.

---

## Cascade (#834)

### cascade-fruit-merge.ogg

- **Event:** Two same-tier fruits merge (tier-scaled playback volume: louder at higher tiers)
- **Original filename:** `tile-move.ogg` from Kenney Digital Audio (same source as `twenty48-tile-merge.ogg`)
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Satisfying merge thud. Volume scales from 0.35 (tier 0) to 1.0 (tier 10) to reward higher-tier merges.

### cascade-combo.ogg

- **Event:** Chain of 3+ consecutive merge steps (cascadeCombo event)
- **Original filename:** Kenney Digital Audio, embedded `TITLE=twotone` — likely `twoTone1.ogg` or `twoTone2.ogg`, exact pack filename unconfirmed. Byte-identical to the audio Star Swarm shipped as `starswarm-waveclear.ogg` (and `starswarm-powerup-lightning.ogg`) before #3526
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** not recorded — in the repo since the original Star Swarm audio (#803/#863, on or before 2026-04-26); the shallow clone can't recover more. CC0 terms don't change retroactively.
- **Notes:** Escalating whoosh/clear sting fired once when a combo chain crosses the 3-merge threshold. Split off as Cascade's own file in #3526 (it used to share `starswarm-waveclear.ogg`, which Star Swarm replaced).

### cascade-game-over.ogg

- **Event:** Game over (fruit crosses the danger line after grace period)
- **Original filename:** (same source as `twenty48-game-over.ogg` from Kenney Digital Audio)
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Descending game-over tone.

---

## Mahjong (#914)

### mahjong-tile-select.ogg

- **Event:** Free tile tapped — selection set or swapped to a different tile
- **Original filename:** `impactGeneric_light_000.ogg` from Kenney Impact Sounds (www.kenney.nl)
- **Source URL:** https://kenney.nl/assets/impact-sounds
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Subtle generic light impact — unobtrusive tap confirming tile selection.

### mahjong-tile-match.ogg

- **Event:** Matched pair successfully removed from the board
- **Original filename:** `impactBell_heavy_000.ogg` from Kenney Impact Sounds (www.kenney.nl)
- **Source URL:** https://kenney.nl/assets/impact-sounds
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Resonant bell impact — fits the zen/meditative atmosphere of Mahjong and complements the lo-fi background music.

### mahjong-shuffle.ogg

- **Event:** Shuffle used — remaining tiles redistributed into a new solvable arrangement
- **Original filename:** `card-shuffle.ogg` from Kenney Casino Audio 1.1 (www.kenney.nl)
- **Source URL:** https://kenney.nl/assets/casino-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Satisfying card-shuffle sound thematically appropriate for tile rearrangement.

### mahjong-win (reuses hearts-moon-shot.mp3)

- **Event:** All 144 tiles cleared — board complete
- **Notes:** Same orchestral win fanfare reused by Yacht, Twenty48, Blackjack, Solitaire, and Sudoku.

### mahjong-deadlock (reuses cascade-game-over.ogg)

- **Event:** No valid pairs remain and all shuffles are exhausted
- **Notes:** Same descending phaser tone used by Cascade and Twenty48 game-over events (`phaserDown2.ogg`, Kenney Digital Audio).

### mahjong-bg-1.mp3

- **Event:** Background music track 1 (looping, one of three chosen at random per game session)
- **Original filename:** `lofi_music_library-chill-amp-relaxing-lofi-music-455381.mp3`
- **Source URL:** https://pixabay.com/music/lofi-chill-amp-relaxing-lofi-music-455381/
- **Creator:** lofi_music_library on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Chill & relaxing lo-fi track. File is ~9.6 MB — compress with `ffmpeg -i mahjong-bg-1.mp3 -b:a 48k mahjong-bg-1.mp3` when ffmpeg is available. Played at BG_VOLUME = 0.2 (same level as Star Swarm).

### mahjong-bg-2.mp3

- **Event:** Background music track 2 (looping, one of three chosen at random per game session)
- **Original filename:** `fassounds-lofi-study-calm-peaceful-chill-hop-112191.mp3`
- **Source URL:** https://pixabay.com/music/lofi-lofi-study-calm-peaceful-chill-hop-112191/
- **Creator:** fassounds on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Lo-fi study / chill-hop track (~4.5 MB). Played at BG_VOLUME = 0.2.

### mahjong-bg-3.mp3

- **Event:** Background music track 3 (looping, one of three chosen at random per game session)
- **Original filename:** `lofi_music_library-coffee-lofi-chill-lofi-ambient-458901.mp3`
- **Source URL:** https://pixabay.com/music/lofi-coffee-lofi-chill-lofi-ambient-458901/
- **Creator:** lofi_music_library on Pixabay
- **License:** Pixabay Content License
- **License URL:** https://pixabay.com/service/license-summary/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Coffee lo-fi / chill ambient track (~6.0 MB). Played at BG_VOLUME = 0.2.

---

## Freesound CC0 License summary (as of 2026-04-25)

> Sounds licensed under Creative Commons Zero (CC0) have been dedicated to the
> public domain. You can copy, modify, distribute and perform them, even for
> commercial purposes, all without asking permission.
> See https://creativecommons.org/publicdomain/zero/1.0/ for full terms.

## Pixabay License summary (as of 2026-04-25)

> Content on Pixabay is made available under the Pixabay Content License, which
> allows use for free for commercial and non-commercial purposes, without
> attribution. You may not sell or redistribute Pixabay content as a standalone
> file. See https://pixabay.com/service/license-summary/ for full terms.

A copy of the full license has been archived at:
https://web.archive.org/web/2026/https://pixabay.com/service/terms/
