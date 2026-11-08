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

## Card and puzzle games: shared synthesized sounds (#3563)

Since #3563 the card and puzzle games' sound effects are being replaced with **original sounds, synthesized in-house** by `tools/assets/synth_arcade_sfx.py` (no samples, no third-party audio). One file can serve several games' keys. The reasoning behind each sound is in `docs/games/arcade-sound-design.md`.

### card-place-1.ogg

- **Event:** A card placed or played: `solitaire.cardPlace`, `freecell.cardPlace`, `hearts.cardPlay` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-place-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.10 s "slide and settle": 45 ms of grainy card-on-felt friction (band-limited noise, 1.2–7.5 kHz, with sparse micro-bursts) ending in a soft flat flap of air (a ~3 ms broadband puff with a darker after-puff), with no tonal body. Replaced `solitaire-card-place.ogg` (Kenney Casino Audio) and `freecell-card-place.mp3` (Freesound, el_boss).

### card-place-2.ogg

- **Event:** A card placed or played: `solitaire.cardPlace`, `freecell.cardPlace`, `hearts.cardPlay` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-place-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.10 s "slide and settle": 50 ms of grainy card-on-felt friction (band-limited noise, 1.2–7.5 kHz, with sparse micro-bursts) ending in a soft flat flap of air (a ~3 ms broadband puff with a darker after-puff), with no tonal body. Replaced `solitaire-card-place.ogg` (Kenney Casino Audio) and `freecell-card-place.mp3` (Freesound, el_boss).

### card-place-3.ogg

- **Event:** A card placed or played: `solitaire.cardPlace`, `freecell.cardPlace`, `hearts.cardPlay` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-place-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.10 s "slide and settle": 40 ms of grainy card-on-felt friction (band-limited noise, 1.2–7.5 kHz, with sparse micro-bursts) ending in a soft flat flap of air (a ~3 ms broadband puff with a darker after-puff), with no tonal body. Replaced `solitaire-card-place.ogg` (Kenney Casino Audio) and `freecell-card-place.mp3` (Freesound, el_boss).

### card-flip-1.ogg

- **Event:** Solitaire card flip, `solitaire.cardFlip` (variation 1 of 3, played by `useSoundVariants`): a Draw-1 stock draw, or a face-down tableau card revealed by a move (with card place); silent during Auto-Complete
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-flip-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.10 s "turn and lay": a 30 ms smooth whoosh of air (0.6–3.5 kHz noise, rising then falling) as the card turns, then the card laid down: a soft flap of air (~3 ms broadband puff, 5 kHz cut, no tonal body). Replaced Solitaire's use of `solitaire-card-flip.ogg` (Kenney Casino Audio); that file was removed once Hearts moved to `trick-gathered-*.ogg` (#3563).

### card-flip-2.ogg

- **Event:** Solitaire card flip, `solitaire.cardFlip` (variation 2 of 3, played by `useSoundVariants`): a Draw-1 stock draw, or a face-down tableau card revealed by a move (with card place); silent during Auto-Complete
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-flip-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.10 s "turn and lay": a 34 ms smooth whoosh of air (0.6–3.5 kHz noise, rising then falling) as the card turns, then the card laid down: a soft flap of air (~3 ms broadband puff, 5 kHz cut, no tonal body). Replaced Solitaire's use of `solitaire-card-flip.ogg` (Kenney Casino Audio); that file was removed once Hearts moved to `trick-gathered-*.ogg` (#3563).

### card-flip-3.ogg

- **Event:** Solitaire card flip, `solitaire.cardFlip` (variation 3 of 3, played by `useSoundVariants`): a Draw-1 stock draw, or a face-down tableau card revealed by a move (with card place); silent during Auto-Complete
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-flip-3`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.10 s "turn and lay": a 27 ms smooth whoosh of air (0.6–3.5 kHz noise, rising then falling) as the card turns, then the card laid down: a soft flap of air (~3 ms broadband puff, 5 kHz cut, no tonal body). Replaced Solitaire's use of `solitaire-card-flip.ogg` (Kenney Casino Audio); that file was removed once Hearts moved to `trick-gathered-*.ogg` (#3563).

### card-fan-1.ogg

- **Event:** Solitaire Draw 3, `solitaire.cardFan` (variation 1 of 3): a stock draw that turns more than one card; silent during Auto-Complete
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-fan-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.20 s three-card fan: three "turn and lay" card flips 38 and 36 ms apart at rising level (0.7, 0.8, 1.0).

### card-fan-2.ogg

- **Event:** Solitaire Draw 3, `solitaire.cardFan` (variation 2 of 3): a stock draw that turns more than one card; silent during Auto-Complete
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-fan-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.20 s three-card fan: three "turn and lay" card flips 38 and 36 ms apart at rising level (0.7, 0.8, 1.0).

### card-fan-3.ogg

- **Event:** Solitaire Draw 3, `solitaire.cardFan` (variation 3 of 3): a stock draw that turns more than one card; silent during Auto-Complete
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-fan-3`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.20 s three-card fan: three "turn and lay" card flips 38 and 36 ms apart at rising level (0.7, 0.8, 1.0).

### card-deal-1.ogg

- **Event:** Blackjack card deal, `blackjack.cardDeal` (variation 1 of 3), played as a card leaves for its hand. **Not wired yet:** it goes live with the deal motion in #3571, which flies each card in 240 ms. Until then the game still plays `blackjack-card-deal.ogg`.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-deal-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "dealer's toss": a crisp snap as the card leaves the deck (a ~1 ms 2.2–9 kHz click), a whoosh of air that fades as it travels (0.7–4.5 kHz), then the landing flap at 240 ms (`CARD_DEAL_FLIGHT`, the motion's flight).

### card-deal-2.ogg

- **Event:** Blackjack card deal, `blackjack.cardDeal` (variation 2 of 3), played as a card leaves for its hand. **Not wired yet:** it goes live with the deal motion in #3571, which flies each card in 240 ms. Until then the game still plays `blackjack-card-deal.ogg`.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-deal-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "dealer's toss": a crisp snap as the card leaves the deck (a ~1 ms 2.2–9 kHz click), a whoosh of air that fades as it travels (0.7–4.5 kHz), then the landing flap at 240 ms (`CARD_DEAL_FLIGHT`, the motion's flight).

### card-deal-3.ogg

- **Event:** Blackjack card deal, `blackjack.cardDeal` (variation 3 of 3), played as a card leaves for its hand. **Not wired yet:** it goes live with the deal motion in #3571, which flies each card in 240 ms. Until then the game still plays `blackjack-card-deal.ogg`.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-deal-3`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "dealer's toss": a crisp snap as the card leaves the deck (a ~1 ms 2.2–9 kHz click), a whoosh of air that fades as it travels (0.7–4.5 kHz), then the landing flap at 240 ms (`CARD_DEAL_FLIGHT`, the motion's flight).

### chip-bet-1.ogg

- **Event:** Blackjack bet (variation 1 of 3): a chip tapped from the tray slides into the betting circle. **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-bet-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.22 s "felt thud": a 90 ms felt slide, then a chip set down on felt (a soft, dark 0.25–1.6 kHz puff with a muffled 2.6 kHz tick).

### chip-bet-2.ogg

- **Event:** Blackjack bet (variation 2 of 3). **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-bet-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** As chip-bet-1, with other seeds.

### chip-bet-3.ogg

- **Event:** Blackjack bet (variation 3 of 3). **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-bet-3`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** As chip-bet-1, with other seeds.

### chip-payout.ogg

- **Event:** Blackjack payout on a win: the chips slide over and land on the stake. **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-payout`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.51 s: a felt slide, then five felt-thud chips landing over 0.26 s; 2 dB under the win chime.

### chip-collect.ogg

- **Event:** Blackjack loss: the stake swept away. **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-collect`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.50 s: a 0.38 s felt sweep with three chips tumbling.

### chip-nudge.ogg

- **Event:** Blackjack push: the stake nudged back to the player. **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-nudge`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.20 s: a short slide and one soft felt-thud chip.

### result-win.ogg

- **Event:** Blackjack hand won (`blackjack.win`). **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-win`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.75 s "soft chimes": two mallet notes rising a fifth (E5 → B5).

### result-push.ogg

- **Event:** Blackjack push (`blackjack.push`). **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-push`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.52 s: one neutral mallet note (E5).

### result-lose.ogg

- **Event:** Blackjack plain loss (new trigger; silent today). **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-lose`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.82 s: a soft falling minor third (G4 → E♭4).

### result-bust.ogg

- **Event:** Blackjack bust (`blackjack.bust`). **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-bust`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.76 s: a shorter, duller falling third (F5 → D♭5).

### result-blackjack.ogg

- **Event:** Blackjack natural (`blackjack.blackjack`). **Not wired yet:** it goes live with the chip and result motion in #3571's motion story (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-blackjack`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 1.08 s: a quick sparkle arpeggio (C5 E5 G5 C6) with a soft bell shimmer an octave up.

### riffle-start.ogg

- **Event:** Auto-Complete in Solitaire and FreeCell (`solitaire.autoComplete*`, `freecell.autoComplete*`), played by `useRunSound` for as long as the run lasts; the cards it moves make no card-place sound of their own (start: as the run begins, with the loop)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds riffle-start`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.14 s pick-up: seven tiny card-edge clicks (band-limited noise, 1.6–8 kHz, ~1 ms decay) accelerating into the loop, peaking with it. Part of the "riffle shuffle".

### riffle-loop.ogg

- **Event:** Auto-Complete in Solitaire and FreeCell (`solitaire.autoComplete*`, `freecell.autoComplete*`), played by `useRunSound` for as long as the run lasts; the cards it moves make no card-place sound of their own (loop: for the whole run)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds riffle-loop`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 2.0 s seamless "riffle shuffle": a dense flutter of bright card edges (~42/s, 1.8–8.5 kHz clicks with timing and level jitter, wrapped at the loop point) over a papery whirr (1.5–7 kHz noise with a 3 Hz swell), crossfaded at the seam; set to −27 LUFS.

### riffle-settle.ogg

- **Event:** Auto-Complete in Solitaire and FreeCell (`solitaire.autoComplete*`, `freecell.autoComplete*`), played by `useRunSound` for as long as the run lasts; the cards it moves make no card-place sound of their own (settle: as the last card lands and the board is solved, with the win)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds riffle-settle`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.30 s squared pile: three last card edges, a short papery slide, then the deck tapped flat: two soft flaps of air (broadband puffs, 4–4.5 kHz cut, no tonal body).

### card-game-won.ogg

- **Event:** The game is won in Solitaire (`solitaire.gameWin`), FreeCell (`freecell.gameWin`) and Hearts (`hearts.gameWon`: the human finishes lowest, or tied for lowest). After an Auto-Complete it plays at the same instant as `riffle-settle.ogg`.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-game-won`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 2.45 s "rising swell": 0.25 s of silence for the riffle's settle, then a soft pad (three detuned saws per note, 2.8 kHz lowpass) swells into C major, with a bell sparkle and a mallet C6 as it opens.

### card-game-lost.ogg

- **Event:** Hearts, the game ends and another seat finishes lowest (`hearts.gameLost`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-game-lost`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 1.40 s: a short pad swell (1.8 kHz lowpass) that sinks into A minor, ~4 dB under game won.

---

### card-invalid-move.ogg

- **Event:** A rejected move in Solitaire (`solitaire.invalidMove`) and FreeCell (`freecell.invalidMove`, played by `FreeCellBoard`), with the card shake.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-invalid-move`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "nope": two short, muted mallet notes falling a semitone (C5 → B4), lowpassed at 3 kHz; sits under card place.

### card-multi-move.ogg

- **Event:** A run of two or more cards moved at once: FreeCell's supermove (`freecell.supermove`) and Solitaire's tableau run (`solitaire.multiCardMove`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-multi-move`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.42 s "fan sweep": an air whoosh as the run lifts (0.7–4 kHz noise), then four soft flaps 28 ms apart as the cards fan down, the last firmer.

### card-no-moves.ogg

- **Event:** FreeCell has no moves left (`freecell.noMoves`): the engine's `noMovesAvailable` event, or Hint with nothing to suggest; with the "No moves left" banner.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-no-moves`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 1.0 s "shrug": three soft mallet notes drifting down (E5, D5, C#5) without resolving; under game lost.

## Hearts

### hearts-moon-howl.ogg

- **Event:** The human shoots the moon in Hearts (`hearts.moonShot`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds hearts-moon-howl`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 3.9 s "the pack answers": a wolf's howl (additive harmonics under a moving oo-ah vowel; pitch rises, holds with vibrato, falls), a second, farther wolf answering, in a wide synthetic hall.

### trick-gathered-1.ogg

- **Event:** Every Hearts trick, after the take-away animation (`hearts.trickWon`/`2`/`3`), one of three at random (`useSoundVariants`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds trick-gathered-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "whoosh": an air whoosh as the pile flies to the winner, then a soft landing flap; variation 1 of 3 (seed 0).

### trick-gathered-2.ogg

- **Event:** Every Hearts trick, after the take-away animation (`hearts.trickWon`/`2`/`3`), one of three at random (`useSoundVariants`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds trick-gathered-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "whoosh": an air whoosh as the pile flies to the winner, then a soft landing flap; variation 2 of 3 (seed 1).

### trick-gathered-3.ogg

- **Event:** Every Hearts trick, after the take-away animation (`hearts.trickWon`/`2`/`3`), one of three at random (`useSoundVariants`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds trick-gathered-3`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "whoosh": an air whoosh as the pile flies to the winner, then a soft landing flap; variation 3 of 3 (seed 2).

### hearts-broken-heartbeat.ogg

- **Event:** Hearts are broken (`hearts.heartsBroken`).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds hearts-broken-heartbeat`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.9 s heartbeat: a lub-dub thump (230/200 Hz with an upper partial for phone speakers), a small bright crack, one soft mallet note.

### queen-of-spades-gong.ogg

- **Event:** The Q♠ is played, by anyone (`hearts.queenOfSpades`; replaces the card-place sound for that card).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds queen-of-spades-gong`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 1.5 s "dark gong": a low whoosh as she lands, the card set down, then an inharmonic gong-like ring (330 Hz).

### hearts-moon-shot.mp3

- **Event:** Shared win fanfare for Yacht, Sudoku, 2048, Daily Word, Mahjong and Blackjack (until #3578 / #3581 replace it). Hearts' moon shot used it until #3563 (now `hearts-moon-howl.ogg`).
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

---

## FreeCell (#844)

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

Kept as history: before #3560, three original gameplay sounds (`starswarm-explosion.ogg`,
`starswarm-laser.ogg`, `starswarm-freefirezone.ogg`) shipped unchanged. They had no source filename,
and each was identified by the Kenney title embedded in it (a Vorbis `TITLE` comment, encoder
`Xiph.Org libVorbis I 20070622`, the same convention as the repo's other Kenney Digital Audio sounds).
#3526 then replaced the rest of the set with Kenney CC0 1.0 files. None of those Kenney files ship any
more.

Since #3560, **every Star Swarm sound effect is an original sound, synthesized in-house** by
`tools/assets/synth_starswarm_sfx.py` (no samples, no third-party audio). `starswarm-explosion.ogg`
keeps its filename but is now synthesized, and the laser and free-fire-zone sounds are retired. Each
entry below says "Original sound, synthesized" and gives the generator command and a one-line recipe.

### starswarm-explosion.ogg

- **Event:** Any new explosion (every enemy kill), except on a Smart Bomb tick and for the explosions of rocks and of a Buddy going down, which have their own sounds (#3560)
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

- **Event:** A Buddy is shot down; replaces the generic explosion sound for its own wreck (#3560)
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

- **Event:** Sudoku's error entered (`sudoku.errorEntered`). Solitaire and FreeCell used it for a rejected move until #3563 (now `card-invalid-move.ogg`).
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
