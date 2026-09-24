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

### starswarm-laser.ogg, starswarm-chargeshot.ogg, starswarm-explosion.ogg, starswarm-gameover.ogg, starswarm-waveclear.ogg

_(Previously placed — provenance to be confirmed)_

### starswarm-playerhit.ogg

- **Event:** Player ship takes a hit (life lost, not game over)
- **Original filename:** `forceField_000.ogg`
- **Source:** Kenney Sci-Fi Sounds v1.0 (www.kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Force-field deflection sound. Signals a shield/hull hit without sounding like a full explosion.

### starswarm-challengingstage.ogg

- **Event:** Challenging Stage phase begins
- **Original filename:** `phaserUp5.ogg`
- **Source:** Kenney Digital Audio (www.kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Rising phaser sting. Signals the start of the bonus Challenging Stage wave.

### starswarm.beamcharge / starswarm.beamfire / starswarm.reinforce (#2485, reuse)

- **Event:** Carrier sweep-beam telegraph, beam firing, reinforcement launch
- **Files:** reuse `starswarm-chargeshot.ogg`, `starswarm-laser.ogg`, `starswarm-freefirezone.ogg` (see their entries)
- **Notes:** No new files — kenney.nl is unreachable from the build container. Dedicated Kenney CC0
  stings are tracked in #2492; swap the keys in `sounds.ts` when they land.

### starswarm.salvage / starswarm.hullup / starswarm.hullhit (#2488, reuse)

- **Event:** salvage crate collected (gun level up), hull plating collected, plating absorbs a hit
- **Files:** reuse `starswarm-powerup-lightning.ogg`, `starswarm-powerup-shield.ogg`, `starswarm-playerhit.ogg`
- **Notes:** No new files (kenney.nl unreachable from the build container); dedicated stings tracked in #2492.

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

### cascade-cascade-combo.ogg

- **Event:** Chain of 3+ consecutive merge steps (cascadeCombo event)
- **Original filename:** `waveclear.ogg` from Kenney Digital Audio (same source as `starswarm-waveclear.ogg`)
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Escalating whoosh/clear sting fired once when a combo chain crosses the 3-merge threshold.

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
