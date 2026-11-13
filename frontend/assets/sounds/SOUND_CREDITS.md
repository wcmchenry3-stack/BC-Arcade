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

- **Event:** Solitaire card flip, `solitaire.cardFlip` (variation 1 of 3, played by `useSoundVariants`): a Draw-1 stock draw, or a face-down tableau card revealed by a move (with card place); silent during Auto-Complete. Also Blackjack's hole-card flip, `blackjack.cardFlip`, at the turn's start (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-flip-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.10 s "turn and lay": a 30 ms smooth whoosh of air (0.6–3.5 kHz noise, rising then falling) as the card turns, then the card laid down: a soft flap of air (~3 ms broadband puff, 5 kHz cut, no tonal body). Replaced Solitaire's use of `solitaire-card-flip.ogg` (Kenney Casino Audio); that file was removed once Hearts moved to `trick-gathered-*.ogg` (#3563).

### card-flip-2.ogg

- **Event:** Solitaire card flip, `solitaire.cardFlip` (variation 2 of 3, played by `useSoundVariants`): a Draw-1 stock draw, or a face-down tableau card revealed by a move (with card place); silent during Auto-Complete. Also Blackjack's hole-card flip, `blackjack.cardFlip2`, at the turn's start (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-flip-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.10 s "turn and lay": a 34 ms smooth whoosh of air (0.6–3.5 kHz noise, rising then falling) as the card turns, then the card laid down: a soft flap of air (~3 ms broadband puff, 5 kHz cut, no tonal body). Replaced Solitaire's use of `solitaire-card-flip.ogg` (Kenney Casino Audio); that file was removed once Hearts moved to `trick-gathered-*.ogg` (#3563).

### card-flip-3.ogg

- **Event:** Solitaire card flip, `solitaire.cardFlip` (variation 3 of 3, played by `useSoundVariants`): a Draw-1 stock draw, or a face-down tableau card revealed by a move (with card place); silent during Auto-Complete. Also Blackjack's hole-card flip, `blackjack.cardFlip3`, at the turn's start (#3581).
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

- **Event:** Blackjack card deal, `blackjack.cardDeal` (variation 1 of 3, played by `useSoundVariants`), played as a card is launched for its hand; it lands with the card at 240 ms (wired with the deal motion, #3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-deal-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "dealer's toss": a crisp snap as the card leaves the deck (a ~1 ms 2.2–9 kHz click), a whoosh of air that fades as it travels (0.7–4.5 kHz), then the landing flap at 240 ms (`CARD_DEAL_FLIGHT`, the motion's flight).

### card-deal-2.ogg

- **Event:** Blackjack card deal, `blackjack.cardDeal2` (variation 2 of 3, played by `useSoundVariants`), played as a card is launched for its hand; it lands with the card at 240 ms (wired with the deal motion, #3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-deal-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "dealer's toss": a crisp snap as the card leaves the deck (a ~1 ms 2.2–9 kHz click), a whoosh of air that fades as it travels (0.7–4.5 kHz), then the landing flap at 240 ms (`CARD_DEAL_FLIGHT`, the motion's flight).

### card-deal-3.ogg

- **Event:** Blackjack card deal, `blackjack.cardDeal3` (variation 3 of 3, played by `useSoundVariants`), played as a card is launched for its hand; it lands with the card at 240 ms (wired with the deal motion, #3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds card-deal-3`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.32 s "dealer's toss": a crisp snap as the card leaves the deck (a ~1 ms 2.2–9 kHz click), a whoosh of air that fades as it travels (0.7–4.5 kHz), then the landing flap at 240 ms (`CARD_DEAL_FLIGHT`, the motion's flight).

### chip-bet-1.ogg

- **Event:** Blackjack bet, `blackjack.chipBet` (variation 1 of 3, played by `useSoundVariants`): a chip tapped from the tray slides into the betting circle, or a split's second stake slides to the new hand; played at the chip's launch (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-bet-1`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.22 s "felt thud": a 90 ms felt slide, then a chip set down on felt (a soft, dark 0.25–1.6 kHz puff with a muffled 2.6 kHz tick).

### chip-bet-2.ogg

- **Event:** Blackjack bet, `blackjack.chipBet2` (variation 2 of 3), as chip-bet-1 (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-bet-2`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** As chip-bet-1, with other seeds.

### chip-bet-3.ogg

- **Event:** Blackjack bet, `blackjack.chipBet3` (variation 3 of 3), as chip-bet-1 (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-bet-3`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** As chip-bet-1, with other seeds.

### chip-payout.ogg

- **Event:** Blackjack payout on a win, `blackjack.chipPayout`: the payout chip slides onto the stake, ~420 ms after the win's chime (on a split, each winning hand in turn) (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-payout`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.51 s: a felt slide, then five felt-thud chips landing over 0.26 s; 2 dB under the win chime.

### chip-collect.ogg

- **Event:** Blackjack loss, `blackjack.chipCollect`: the stake swept away, ~420 ms after the loss's or bust's chime (on a split, each losing hand in turn) (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-collect`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.50 s: a 0.38 s felt sweep with three chips tumbling.

### chip-nudge.ogg

- **Event:** Blackjack push, `blackjack.chipNudge`: the stake nudged toward the player and back, ~420 ms after the push's chime (on a split, each push hand in turn) (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds chip-nudge`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.20 s: a short slide and one soft felt-thud chip.

### result-win.ogg

- **Event:** Blackjack win (`blackjack.win`), with the result banner; a split round's net win (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-win`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.75 s "soft chimes": two mallet notes rising a fifth (E5 → B5).

### result-push.ogg

- **Event:** Blackjack push (`blackjack.push`), with the result banner; a split round that comes out even (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-push`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.52 s: one neutral mallet note (E5).

### result-lose.ogg

- **Event:** Blackjack plain loss (`blackjack.lose`, a new trigger: a plain loss was silent before), with the result banner; a split round's net loss (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-lose`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.82 s: a soft falling minor third (G4 → E♭4).

### result-bust.ogg

- **Event:** Blackjack bust (`blackjack.bust`), with the result banner and the red flash; a split hand's own bust as its card lands (#3581).
- **Source:** Original sound, synthesized in-house for BC Arcade (#3563). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Generator:** `tools/assets/synth_arcade_sfx.py` (`python tools/assets/synth_arcade_sfx.py frontend/assets/sounds result-bust`), fixed seeds, so the decoded audio is reproducible.
- **Recipe:** 0.76 s: a shorter, duller falling third (F5 → D♭5).

### result-blackjack.ogg

- **Event:** Blackjack natural (`blackjack.blackjack`): the player's natural, as its second card lands, with the gold edge and the lift; it is the round's result chime (#3621). It replaced Blackjack's use of `hearts-moon-shot.mp3` (#3581).
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

- **Event:** Win fanfare for Sudoku (until #3578 replaces it; Yacht, 2048 and Mahjong moved off it with #3578, Daily Word with #3665, Blackjack with #3581, now `result-blackjack.ogg`). Hearts' moon shot used it until #3563 (now `hearts-moon-howl.ogg`).
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
- **Status (#3661):** No game uses this file any more: FreeCell moved to synthesized sounds (#3563) and Bottle Sort to its own set (#3661, `sort-win.ogg`). It is not bundled in the app, so the CC BY duty applies again only if it ships; kept in the repo.

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

- **Event:** Carrier opens its bay for a reinforcement batch: the telegraph start, 0.4 s before the Grunts launch (#2485, #3560, #3561)
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

### starswarm-bgm.mp3

- **Event:** Background music, played since #3638: one 6:52.7 looping track (Round 46, starting points 0:00, 1:06.5, 2:36.5, 3:43.5, 4:50.5), carried over between games, opening each visit at a starting point with a 1.5 s fade-in; volume 0.57. It replaced the four audiopapkin (Pixabay) tracks `starswarm-bg-1..4.mp3`, deleted in #3638.
- **Source:** Original, project-owned. Generated by the owner with procedural Python synthesis scripts produced in a ChatGPT workspace, Rounds 1-46 (the track is Round 46, the "Seven Minute Signature Mix", owner-approved 2026-11-12). Archive: `docs/games/starswarm-music/` (#3675); decision #3642; design log `docs/games/starswarm-music-design.md` (#3637).
- **Edit:** one loop edit only, owner-approved 2026-11-12: baked-in fades trimmed (2.5 s head, tail after 418.2 s), 3 s equal-power seam, +2.9 dB, one libmp3lame 128 kbps encode (`tools/assets/make_starswarm_bgm_loop.py`, SHA-256 `6e054c25581d6b04f2ec29ed826a04488a2b3363b20ed1b23dbce3d58d02680e`). The composition is unchanged.
- **SHA-256 (track):** `85950430fbfaf0ed9c6425e7b79ee238a44fd6be40c99de934709f661a13426c` (6,604,461 B, 412.700 s, -21.5 LUFS)
- **SHA-256 (source render):** `29b0a1604e458fa1b0cb92d0502c283b836d1b1f9b2a63a3f012fd3c815f442a` (`docs/games/starswarm-music/Rounds/Round_46/starswarm-round46-seven-minute-signature-mix.mp3`, #3734; unpacked from its zip in #3762)
- **SHA-256 (generator):** `777de55dbf1eff9fbe8f85c3bcfa6b9be96dfce03a59bbd32d2839e874702e4f` (the Round 46 generator in the same zip)
- **Third-party material:** None. No third-party samples. `starswarm-bg-1..4` were listening and analysis references only, never sampled.
- **License:** Owned by the project
- **Attribution required:** No

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
- **Notes:** Same orchestral win fanfare. Sudoku is its last user: Solitaire moved off it with #3563, Yacht and 2048 with #3578, Blackjack with #3581.

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
- **Notes:** No longer used: Solitaire's game win plays `card-game-won.ogg` since #3563. The fanfare's other former users moved off it too (Yacht and 2048 with #3578, Blackjack with #3581); only Sudoku still plays it.

---

## Puzzle, tile and dice games: shared synthesized sounds (#3578)

Since #3578 the sound effects of Sort, 2048, Yacht, Daily Word, Sudoku and Mahjong are being replaced with **original sounds, synthesized in-house** by `tools/assets/synth_puzzle_sfx.py` (no samples, no third-party audio). One file can serve several games' keys. The reasoning behind each sound is in `docs/games/puzzle-sound-design.md`.

### dice-roll-1.ogg

- **Event:** Dice rolled: `yacht.diceRoll` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds dice-roll-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.75 s "short cup and spill": a ~90 ms muffled rattle in a cup (7–8 small clicks, 0.5–4.5 kHz with noise resonances near 0.8 and 2.9 kHz), then five dice spill onto a wooden tray and bounce to rest by ~0.42 s (each impact a broadband click plus noise rung at ~1.5–2.1 and 3.2–4.2 kHz, gaps shrinking ×0.66 per bounce, a few die-on-die knocks), with no tonal body. Replaced `yacht-dice-roll.ogg` (Kenney Casino Audio).

### dice-roll-2.ogg

- **Event:** Dice rolled: `yacht.diceRoll` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds dice-roll-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.75 s "short cup and spill": a ~90 ms muffled rattle in a cup (7–8 small clicks, 0.5–4.5 kHz with noise resonances near 0.8 and 2.9 kHz), then five dice spill onto a wooden tray and bounce to rest by ~0.42 s (each impact a broadband click plus noise rung at ~1.5–2.1 and 3.2–4.2 kHz, gaps shrinking ×0.66 per bounce, a few die-on-die knocks), with no tonal body. Replaced `yacht-dice-roll.ogg` (Kenney Casino Audio).

### dice-roll-3.ogg

- **Event:** Dice rolled: `yacht.diceRoll` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds dice-roll-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.75 s "short cup and spill": a ~90 ms muffled rattle in a cup (7–8 small clicks, 0.5–4.5 kHz with noise resonances near 0.8 and 2.9 kHz), then five dice spill onto a wooden tray and bounce to rest by ~0.42 s (each impact a broadband click plus noise rung at ~1.5–2.1 and 3.2–4.2 kHz, gaps shrinking ×0.66 per bounce, a few die-on-die knocks), with no tonal body. Replaced `yacht-dice-roll.ogg` (Kenney Casino Audio).

### die-hold-1.ogg

- **Event:** A die held: `yacht.dieHold` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds die-hold-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "pick up": a fingertip click on the die (a tiny bright noise click, 2.5–10 kHz, rung near 5 kHz), then a small rising puff of air (1.2–5 kHz noise, ~45 ms) as it is lifted, with no tonal body. With `die-release-*.ogg`, replaced `yacht-die-hold.ogg` (Kenney Casino Audio), which played for both hold and release.

### die-hold-2.ogg

- **Event:** A die held: `yacht.dieHold` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds die-hold-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "pick up": a fingertip click on the die (a tiny bright noise click, 2.5–10 kHz, rung near 5 kHz), then a small rising puff of air (1.2–5 kHz noise, ~45 ms) as it is lifted, with no tonal body. With `die-release-*.ogg`, replaced `yacht-die-hold.ogg` (Kenney Casino Audio), which played for both hold and release.

### die-hold-3.ogg

- **Event:** A die held: `yacht.dieHold` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds die-hold-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "pick up": a fingertip click on the die (a tiny bright noise click, 2.5–10 kHz, rung near 5 kHz), then a small rising puff of air (1.2–5 kHz noise, ~45 ms) as it is lifted, with no tonal body. With `die-release-*.ogg`, replaced `yacht-die-hold.ogg` (Kenney Casino Audio), which played for both hold and release.

### die-release-1.ogg

- **Event:** A held die released: `yacht.dieRelease` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds die-release-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "set down": a soft tap on wood (a noise click rung near 1.5–2.1 and 3.2–4.2 kHz, softened above 5 kHz), then a tiny settle bounce ~25 ms later, with no tonal body; 1 dB under the hold. With `die-hold-*.ogg`, replaced `yacht-die-hold.ogg` (Kenney Casino Audio).

### die-release-2.ogg

- **Event:** A held die released: `yacht.dieRelease` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds die-release-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "set down": a soft tap on wood (a noise click rung near 1.5–2.1 and 3.2–4.2 kHz, softened above 5 kHz), then a tiny settle bounce ~25 ms later, with no tonal body; 1 dB under the hold. With `die-hold-*.ogg`, replaced `yacht-die-hold.ogg` (Kenney Casino Audio).

### die-release-3.ogg

- **Event:** A held die released: `yacht.dieRelease` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds die-release-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "set down": a soft tap on wood (a noise click rung near 1.5–2.1 and 3.2–4.2 kHz, softened above 5 kHz), then a tiny settle bounce ~25 ms later, with no tonal body; 1 dB under the hold. With `die-hold-*.ogg`, replaced `yacht-die-hold.ogg` (Kenney Casino Audio).

### score-commit.ogg

- **Event:** A score with no milestone: `yacht.scoreCommit`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds score-commit`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s: a pencil tapped on a wooden scorepad (a noise click rung at wood resonances, softened above 6 kHz), with no tonal body.

### score-zero.ogg

- **Event:** A 0 scored: `yacht.scoreZero`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds score-zero`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.14 s: a dull pencil scratch (grainy noise, 0.4–2.2 kHz) then a dull wooden tap.

### small-straight.ogg

- **Event:** A small straight scored: `yacht.smallStraight`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds small-straight`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.6 s: four rising marimba-like mallet notes (C5 D5 E5 G5, 55 ms apart; sine partials with exponential decay). Replaced `yacht-straight.ogg` (Kenney Digital Audio), which played for both straights.

### large-straight.ogg

- **Event:** A large straight scored: `yacht.largeStraight`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds large-straight`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.7 s: five rising mallet notes (C5 D5 E5 G5 C6, 50 ms apart), the top one accented. Replaced `yacht-straight.ogg` (Kenney Digital Audio), which played for both straights.

### full-house.ogg

- **Event:** A full house scored: `yacht.fullHouse`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds full-house`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.65 s: "three and two": a rolled C major mallet triad, then a C6–G5 pair 160 ms later.

### upper-bonus.ogg

- **Event:** The upper bonus earned: `yacht.upperBonus`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds upper-bonus`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.2 s achievement: a rising mallet run (G4 C5 E5 G5) into a held mallet roll on C major (18 strikes a second, fading), with a small glass-bell sparkle (a sine with inharmonic partials) on top. Replaced `yacht-upper-bonus.ogg` (Kenney Digital Audio).

### cpu-score-commit.ogg

- **Event:** The computer's score with no milestone: `yacht.cpuScoreCommit`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-score-commit`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s: a darker wooden tap (softened above 3 kHz), 2.5 dB under the player's.

### cpu-score-zero.ogg

- **Event:** The computer scores a 0: `yacht.cpuScoreZero`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-score-zero`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.14 s: a darker scratch and tap, 2.5 dB under the player's.

### cpu-small-straight.ogg

- **Event:** The computer scores a small straight: `yacht.cpuSmallStraight`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-small-straight`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.45 s: four falling minor mallet notes an octave down (G4 F4 Eb4 C4, 45 ms apart).

### cpu-large-straight.ogg

- **Event:** The computer scores a large straight: `yacht.cpuLargeStraight`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-large-straight`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.5 s: five falling mallet notes (C5 Bb4 G4 F4 C4, 42 ms apart).

### cpu-full-house.ogg

- **Event:** The computer scores a full house: `yacht.cpuFullHouse`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-full-house`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.45 s: a rolled C minor mallet triad, then a falling G4–C4 pair.

### cpu-upper-bonus.ogg

- **Event:** The computer earns its upper bonus: `yacht.cpuUpperBonus`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-upper-bonus`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.5 s: a quick minor "sigh": an F minor mallet chord, then C minor.

### jackpot-yacht.ogg

- **Event:** A yacht scored, with its celebration: `yacht.yacht`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds jackpot-yacht`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.9 s "mallet fanfare", the top of the scoring ladder: a two-octave rising mallet run (C5 E5 G5 C6 E6 G6, 45 ms apart) into a held mallet roll on C major (18 strikes a second, fading), with glass-bell sparkles falling. Replaced Yacht's use of `hearts-moon-shot.mp3` (Pixabay), which other games still use.

### jackpot-joker.ogg

- **Event:** A joker (another yacht) scored, with its celebration: `yacht.joker`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds jackpot-joker`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.9 s: the yacht fanfare a whole step higher (D major), with a double "again!" glass bell. Replaced Yacht's use of `hearts-moon-shot.mp3`.

### cpu-jackpot-yacht.ogg

- **Event:** The computer scores a yacht: `yacht.cpuYacht`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-jackpot-yacht`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.7 s: a fast falling minor mallet run (C5 Bb4 G4 Eb4 C4, 35 ms apart) into a low C minor chord, 3 dB under yours.

### cpu-jackpot-joker.ogg

- **Event:** The computer scores a joker: `yacht.cpuJoker`. One sound per score: a milestone replaces the commit.
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds cpu-jackpot-joker`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.7 s: a falling run (Eb5 C5 Ab4 F4 C4) into a low F minor chord.

### tile-merge-1.ogg

- **Event:** 2048 tiles merge: `twenty48.tileMerge` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds tile-merge-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.22 s "wooden tiles": a faint slide of air (0.9–3.5 kHz noise, 85 ms), then two wooden tiles clacking together at 100 ms, as the two sliding tiles meet and the merged tile pops (#3690) (a noise click rung at wood resonances, with a softer double 6 ms later); no tonal body. Replaced `twenty48-tile-merge.ogg` (Kenney Interface Sounds).

### tile-merge-2.ogg

- **Event:** 2048 tiles merge: `twenty48.tileMerge` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds tile-merge-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.22 s "wooden tiles": a faint slide of air (0.9–3.5 kHz noise, 85 ms), then two wooden tiles clacking together at 100 ms, as the two sliding tiles meet and the merged tile pops (#3690) (a noise click rung at wood resonances, with a softer double 6 ms later); no tonal body. Replaced `twenty48-tile-merge.ogg` (Kenney Interface Sounds).

### tile-merge-3.ogg

- **Event:** 2048 tiles merge: `twenty48.tileMerge` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds tile-merge-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.22 s "wooden tiles": a faint slide of air (0.9–3.5 kHz noise, 85 ms), then two wooden tiles clacking together at 100 ms, as the two sliding tiles meet and the merged tile pops (#3690) (a noise click rung at wood resonances, with a softer double 6 ms later); no tonal body. Replaced `twenty48-tile-merge.ogg` (Kenney Interface Sounds).

### tile-spawn-1.ogg

- **Event:** A new 2048 tile appears (every swipe): `twenty48.tileSpawn` (variation 1 of 3)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds tile-spawn-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.16 s: a small tile set down at 60 ms, as the new tile scales in (a tiny bright noise click, softened above 6 kHz); the quietest sound in the game. Replaced `twenty48-tile-spawn.ogg` (Kenney Digital Audio).

### tile-spawn-2.ogg

- **Event:** A new 2048 tile appears (every swipe): `twenty48.tileSpawn` (variation 2 of 3)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds tile-spawn-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.16 s: a small tile set down at 60 ms, as the new tile scales in (a tiny bright noise click, softened above 6 kHz); the quietest sound in the game. Replaced `twenty48-tile-spawn.ogg` (Kenney Digital Audio).

### tile-spawn-3.ogg

- **Event:** A new 2048 tile appears (every swipe): `twenty48.tileSpawn` (variation 3 of 3)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds tile-spawn-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.16 s: a small tile set down at 60 ms, as the new tile scales in (a tiny bright noise click, softened above 6 kHz); the quietest sound in the game. Replaced `twenty48-tile-spawn.ogg` (Kenney Digital Audio).

### win-2048.ogg

- **Event:** The 2048 tile is reached, with the win card: `twenty48.win2048`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds win-2048`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.6 s (rings ~2.5 s) "wood and mallet": from 100 ms, as the 2048 tile pops, a two-octave rising mallet run (C5 E5 G5 C6 E6 G6, 50 ms apart) into a held mallet roll on C major with falling glass sparkles, then a final "ta-da" mallet chord (C5 G5 C6 E6) with a high glass bell at 1.0 s, as the win card shows (#3690). Replaced 2048's use of `hearts-moon-shot.mp3` (Pixabay), which other games still use.

### game-over-2048.ogg

- **Event:** No moves left, with the result card: `twenty48.gameOver`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds game-over-2048`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.1 s (rings ~2.0 s): a last wooden tile clack at 100 ms as the move lands, a gentle falling mallet line (G5 E5 D5 C5, 100 ms apart from 200 ms) over the board's dim and shake, settling on a soft low A minor chord (A4 C5 E5) at 0.6 s as the result card shows (#3690); gentle, not a punishment. Replaced 2048's use of `cascade-game-over.ogg` (Kenney Digital Audio), which Cascade keeps.

### mahjong-select-1.ogg

- **Event:** Mahjong tile selected: `mahjong.tileSelect` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-select-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "real tiles, crisp clack": a bright fingertip tick on a dense mahjong tile (a noise click rung at tile resonances near 2.4, 3.7 and 5.6 kHz), with a breath of cloth (2–6 kHz noise, 50 ms), on the tap. Replaced `mahjong-tile-select.ogg`.

### mahjong-select-2.ogg

- **Event:** Mahjong tile selected: `mahjong.tileSelect` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-select-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "real tiles, crisp clack": a bright fingertip tick on a dense mahjong tile (a noise click rung at tile resonances near 2.4, 3.7 and 5.6 kHz), with a breath of cloth (2–6 kHz noise, 50 ms), on the tap. Replaced `mahjong-tile-select.ogg`.

### mahjong-select-3.ogg

- **Event:** Mahjong tile selected: `mahjong.tileSelect` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-select-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "real tiles, crisp clack": a bright fingertip tick on a dense mahjong tile (a noise click rung at tile resonances near 2.4, 3.7 and 5.6 kHz), with a breath of cloth (2–6 kHz noise, 50 ms), on the tap. Replaced `mahjong-tile-select.ogg`.

### mahjong-match-1.ogg

- **Event:** Mahjong pair matched: `mahjong.tileMatch` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-match-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.5 s "real tiles, crisp clack": a light tap on the second tile, the pair flying (1.5–5 kHz air, 200 ms), a crisp clack and its softer double as the tiles meet face to face at 264 ms (the match motion's meeting point), then two tiny high glass sparks on the burst. Replaced `mahjong-tile-match.ogg`.

### mahjong-match-2.ogg

- **Event:** Mahjong pair matched: `mahjong.tileMatch` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-match-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.5 s "real tiles, crisp clack": a light tap on the second tile, the pair flying (1.5–5 kHz air, 200 ms), a crisp clack and its softer double as the tiles meet face to face at 264 ms (the match motion's meeting point), then two tiny high glass sparks on the burst. Replaced `mahjong-tile-match.ogg`.

### mahjong-match-3.ogg

- **Event:** Mahjong pair matched: `mahjong.tileMatch` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-match-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.5 s "real tiles, crisp clack": a light tap on the second tile, the pair flying (1.5–5 kHz air, 200 ms), a crisp clack and its softer double as the tiles meet face to face at 264 ms (the match motion's meeting point), then two tiny high glass sparks on the burst. Replaced `mahjong-tile-match.ogg`.

### mahjong-shuffle-wash.ogg

- **Event:** Mahjong shuffle spent: `mahjong.shuffle`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from noise, resonant filters, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-shuffle-wash`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.05 s "real tiles, washing the tiles": a dense clatter of ~140 tile clicks pushed around on the felt (noise clicks rung at tile resonances), swelling with the 880 ms shuffle swirl over a soft felt rumble (0.4–2.5 kHz air), then 12 tiles landing left to right over 572–880 ms, as the swirl's wave lands. Replaced `mahjong-shuffle.ogg`.

### mahjong-win.ogg

- **Event:** Mahjong board cleared, with the spark cascade before the result card: `mahjong.win`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-win`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 3.4 s "gong and bells": a small gong (F4, inharmonic partials, some slowly beating) swells under the spark cascade while bells ring a C pentatonic carillon (C6 to A7), then a bright gong stroke (G4) and a bell chord (C6 E6 G6 A6) at 1.45 s, as the result card shows. Replaced Mahjong's use of `hearts-moon-shot.mp3`, which other games keep.

### mahjong-deadlock.ogg

- **Event:** Mahjong deadlocked (no free pair, no shuffle left), with the board shake: `mahjong.deadlock`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds mahjong-deadlock`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.9 s "gong and bells": a muted gong (F4) with the board shake, then one soft falling bell (E5, then C5) as the result card shows at 0.5 s; gentle, not a punishment. Replaced Mahjong's use of `cascade-game-over.ogg` (Kenney Digital Audio), which Cascade keeps.

### daily-word-miss-1.ogg

- **Event:** Daily Word, a grey (absent) tile's colour showing, at its flip midpoint (`dailyWord.revealMiss`, variation 1 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-miss-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": a small wooden letter tile turning over: a dull, low-passed wooden tick with a soft body. The quietest of the three results. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-miss-2.ogg

- **Event:** Daily Word, a grey (absent) tile's colour showing, at its flip midpoint (`dailyWord.revealMiss2`, variation 2 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-miss-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": a small wooden letter tile turning over: a dull, low-passed wooden tick with a soft body. The quietest of the three results. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-miss-3.ogg

- **Event:** Daily Word, a grey (absent) tile's colour showing, at its flip midpoint (`dailyWord.revealMiss3`, variation 3 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-miss-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": a small wooden letter tile turning over: a dull, low-passed wooden tick with a soft body. The quietest of the three results. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-present-1.ogg

- **Event:** Daily Word, a yellow (present) tile's colour showing, at its flip midpoint (`dailyWord.revealPresent`, variation 1 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-present-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": the wooden tick, brighter, with a soft marimba E5 under it. 2 dB over a grey tile. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-present-2.ogg

- **Event:** Daily Word, a yellow (present) tile's colour showing, at its flip midpoint (`dailyWord.revealPresent2`, variation 2 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-present-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": the wooden tick, brighter, with a soft marimba E5 under it. 2 dB over a grey tile. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-present-3.ogg

- **Event:** Daily Word, a yellow (present) tile's colour showing, at its flip midpoint (`dailyWord.revealPresent3`, variation 3 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-present-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": the wooden tick, brighter, with a soft marimba E5 under it. 2 dB over a grey tile. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-correct-1.ogg

- **Event:** Daily Word, a green (correct) tile's colour showing, at its flip midpoint (`dailyWord.revealCorrect`, variation 1 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-correct-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": the wooden tick with a warm marimba G5 + C6 under it, so an all-green row rings. 4 dB over a grey tile. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-correct-2.ogg

- **Event:** Daily Word, a green (correct) tile's colour showing, at its flip midpoint (`dailyWord.revealCorrect2`, variation 2 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-correct-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": the wooden tick with a warm marimba G5 + C6 under it, so an all-green row rings. 4 dB over a grey tile. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-correct-3.ogg

- **Event:** Daily Word, a green (correct) tile's colour showing, at its flip midpoint (`dailyWord.revealCorrect3`, variation 3 of 3, played by `useSoundVariants`)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-correct-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.24 s "wooden letter tiles", "tick + marimba": the wooden tick with a warm marimba G5 + C6 under it, so an all-green row rings. 4 dB over a grey tile. Its tick is at 0; tiles turn 100 ms apart.

### daily-word-refused.ogg

- **Event:** Daily Word, a refused guess (too short, not a word, a repeat), with the row's "no" shake: `dailyWord.refused`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-refused`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.38 s "wooden letter tiles": two dull wooden taps on the shake's first swings, 120 ms apart, over a low falling minor second (A4, Ab4) on the marimba: a soft "no".

### daily-word-win.ogg

- **Event:** Daily Word puzzle solved, as the win dance starts: `dailyWord.win`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-win`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.4 s "mallet run": a marimba note on each tile's hop, rising C5 E5 G5 C6 E6 70 ms apart, a glass shimmer over the sparks, then a rolled C major "ta-da" with a high bell as the result card shows at 1.1 s. Replaced Daily Word's use of the shared `hearts-moon-shot.mp3` (10 s), which Sudoku keeps (Blackjack moved off it with #3581).

### daily-word-loss.ogg

- **Event:** Daily Word lost, as the answer starts to flip in: `dailyWord.loss`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3665, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds daily-word-loss`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.9 s: a soft falling marimba line, one note as each answer tile shows (G5 E5 D5 C5 A4, 120 ms apart), then a low A minor chord as the result card shows at 0.78 s; gentle, not a punishment. New: a loss had no sound.

### yacht-win.ogg

- **Event:** Yacht game won (vs: you beat the computer; solo: a new personal best), as the end beat starts: `yacht.win`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3750, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds yacht-win`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.6 s "mallet fanfare": a two-octave marimba run (C5 E5 G5 C6 E6 G6), a rolled C major from 0.45 s, then a final "ta-da" chord with a high glass bell as the result card shows at 1.0 s; a step above the jackpot. New: a win had no sound (BC_GAMES-6S).

### yacht-loss.ogg

- **Event:** Yacht vs game lost, as the end beat starts: `yacht.loss`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3750, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds yacht-loss`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.0 s: a gentle falling marimba line (G5 E5 D5 C5, 110 ms apart) into a soft low A minor chord as the result card shows at 0.6 s; gentle, like 2048's game over. New: a loss had no sound.

### yacht-tie.ogg

- **Event:** Yacht vs game tied, or a solo game that is not a new best, as the end beat starts: `yacht.tie`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3750, under #3578). No samples or third-party audio: built from oscillators, noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds yacht-tie`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.0 s: two level marimba notes (E5, G5) into an open, unresolved C-G-D chord with a faint bell as the result card shows at 0.6 s: "even". New: a tie had no sound.

### sort-select-1.ogg

- **Event:** Sort bottle selected, on the tap that lifts it: `sort.select` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-select-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "glass and water": a bright glass tick (a 12 ms noise burst, 2.5-9 kHz) and a tiny glass ping (3.1 kHz, inharmonic partials) as a fingertip touches the bottle. The three variations are pitched -5%, 0% and +5.5% with their own noise seeds. New: a select had no sound.

### sort-select-2.ogg

- **Event:** Sort bottle selected, on the tap that lifts it: `sort.select2` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-select-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "glass and water": a bright glass tick (a 12 ms noise burst, 2.5-9 kHz) and a tiny glass ping (3.1 kHz, inharmonic partials) as a fingertip touches the bottle. The three variations are pitched -5%, 0% and +5.5% with their own noise seeds. New: a select had no sound.

### sort-select-3.ogg

- **Event:** Sort bottle selected, on the tap that lifts it: `sort.select3` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-select-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.12 s "glass and water": a bright glass tick (a 12 ms noise burst, 2.5-9 kHz) and a tiny glass ping (3.1 kHz, inharmonic partials) as a fingertip touches the bottle. The three variations are pitched -5%, 0% and +5.5% with their own noise seeds. New: a select had no sound.

### sort-pour-lift-1.ogg

- **Event:** Sort pour starts, at the tap: `sort.pourLift` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-lift-1`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.2 s "glass and water": a faint glass touch (1.9 kHz ping and a soft tick), then a soft rising puff of air (0.5-2.4 kHz) as the bottle leaves the shelf; the quietest sound of the set. Three variations as the select. Replaces the start of `cascade-fruit-merge.ogg` as Sort's pour sound (Cascade keeps the file).

### sort-pour-lift-2.ogg

- **Event:** Sort pour starts, at the tap: `sort.pourLift2` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-lift-2`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.2 s "glass and water": a faint glass touch (1.9 kHz ping and a soft tick), then a soft rising puff of air (0.5-2.4 kHz) as the bottle leaves the shelf; the quietest sound of the set. Three variations as the select. Replaces the start of `cascade-fruit-merge.ogg` as Sort's pour sound (Cascade keeps the file).

### sort-pour-lift-3.ogg

- **Event:** Sort pour starts, at the tap: `sort.pourLift3` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-lift-3`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.2 s "glass and water": a faint glass touch (1.9 kHz ping and a soft tick), then a soft rising puff of air (0.5-2.4 kHz) as the bottle leaves the shelf; the quietest sound of the set. Three variations as the select. Replaces the start of `cascade-fruit-merge.ogg` as Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-1u-1.ogg

- **Event:** Sort pour of 1 unit, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream1u` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-1u-1`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.48 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-1u-2.ogg

- **Event:** Sort pour of 1 unit, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream1u2` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-1u-2`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.48 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-1u-3.ogg

- **Event:** Sort pour of 1 unit, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream1u3` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-1u-3`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.48 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-2u-1.ogg

- **Event:** Sort pour of 2 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream2u` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-2u-1`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.78 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-2u-2.ogg

- **Event:** Sort pour of 2 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream2u2` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-2u-2`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.78 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-2u-3.ogg

- **Event:** Sort pour of 2 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream2u3` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-2u-3`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.78 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-3u-1.ogg

- **Event:** Sort pour of 3 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream3u` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-3u-1`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.08 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-3u-2.ogg

- **Event:** Sort pour of 3 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream3u2` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-3u-2`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.08 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-3u-3.ogg

- **Event:** Sort pour of 3 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream3u3` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-3u-3`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.08 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-4u-1.ogg

- **Event:** Sort pour of 4 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream4u` (variation 1 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-4u-1`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.38 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-4u-2.ogg

- **Event:** Sort pour of 4 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream4u2` (variation 2 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-4u-2`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.38 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-pour-stream-4u-3.ogg

- **Event:** Sort pour of 4 units, once, when the stream starts (`flowStartMs`, `motion.ts`): `sort.pourStream4u3` (variation 3 of 3; `useSoundVariants` plays them in random order, never the same twice in a row)
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from damped sinusoids (a physical bubble model), noise, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-pour-stream-4u-3`), fixed seeds (1000 + 100 x units + variation), so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 1.38 s "glass and water", "stream4 A": liquid poured into a glass bottle, after van den Doel's bubble model. A Poisson stream of about 1,400 bubbles a second, each a damped sinusoid at the Minnaert frequency with a rising chirp, radii 0.5-4 mm (power law r^-2.5, about 0.8-6.5 kHz), shrinking 0.20 octave per unit as the destination fills (the pitch rises), over a light impact tap (-26 dB). The stream runs 0.3 s per unit plus a 0.18 s tail. No slow amplitude or formant modulation. Replaces the part of `cascade-fruit-merge.ogg` that was Sort's pour sound (Cascade keeps the file).

### sort-refused.ogg

- **Event:** Sort pour refused, on the destination's shake: `sort.refused`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-refused`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.26 s "glass and water": two dull glass taps, falling (900 Hz, then 760 Hz 120 ms later), like a bottle knocking its neighbour, on the shake's first swings (`REFUSED_SHAKE_MS` 240). New: a refused pour had no sound.

### sort-complete.ogg

- **Event:** Sort pour completes a bottle (not the winning pour), as the badge pops: `sort.complete`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-complete`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.5 s "glass and water": a two-note glass chime rising a fifth (E6, then B6 70 ms later). New: a completed bottle had no sound.

### sort-undo.ogg

- **Event:** Sort Undo, or "Back to last good move" (once per action): `sort.undo`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-undo`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.3 s "glass and water": a reversed clink (a 1.8 kHz glass ping played backward, a swell) ending in a tiny tick at 255 ms, as the board fades back in (`UNDO_FADE_MS` 280). New: undo had no sound.

### sort-hint.ogg

- **Event:** Sort hint shown (the source lifts and the destination rings; not the no-solution notice): `sort.hint`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-hint`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 0.65 s "glass and water": three soft rising glass pings 100 ms apart (G6, B6, D7), each a little louder. New: a hint had no sound.

### sort-win.ogg

- **Event:** Sort level solved, from the start of the win cascade: `sort.win`
- **Source:** Original sound, synthesized in-house for BC Arcade (#3661, under #3578). No samples or third-party audio: built from noise, inharmonic sine partials, envelopes and filters.
- **Generator:** `tools/assets/synth_puzzle_sfx.py` (`python tools/assets/synth_puzzle_sfx.py frontend/assets/sounds sort-win`), fixed seeds, so the decoded audio is reproducible.
- **License / rights:** Owned by the project. No attribution required; commercial use OK.
- **Recipe:** 2.0 s "glass and water": a glass chime cascade, one rising C major pentatonic note per cascade piece (C6, E6, G6, B6, D7, E7, 170 ms apart), then a bright glass chord (C6, G6, C7, G7) and a tick at 1.38 s (`WIN_CASCADE_MS`), as the result card opens. Replaces `freecell-game-win.mp3` (87,960 B, 10.56 s) as Sort's win sound; FreeCell keeps the file and its CC BY credit.

---

## Cascade (#834)

### cascade-fruit-merge.ogg

- **Event:** Two same-tier fruits merge (tier-scaled playback volume: louder at higher tiers)
- **Original filename:** `tile-move.ogg` from Kenney Digital Audio
- **Source URL:** https://kenney.nl/assets/digital-audio
- **Creator:** Kenney Vleugels (Kenney.nl)
- **License:** Creative Commons Zero (CC0)
- **License URL:** https://creativecommons.org/publicdomain/zero/1.0/
- **Attribution required:** No
- **Commercial use:** Yes
- **Download date:** 2026-04-26
- **Notes:** Satisfying merge thud. Volume scales from 0.35 (tier 0) to 1.0 (tier 10) to reward higher-tier merges.
- **Status (#3661):** Cascade only: Bottle Sort moved to its own synthesized pour sounds.

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
- **Original filename:** `phaserDown2.ogg` from Kenney Digital Audio
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
