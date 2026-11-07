# Star Swarm sound design log (#3560)

Why each Star Swarm sound effect sounds the way it does: the owner's brief, the options
auditioned, what was picked and why, and the feedback that shaped it. The **recipes** live in
`tools/assets/synth_starswarm_sfx.py`, and each file's credit and one-line recipe in
`frontend/assets/sounds/SOUND_CREDITS.md`. This log keeps the **reasoning**. Add an entry for
every sound you change.

The key → file → trigger → volume table is the
[Sound section of `starswarm.md`](starswarm.md#sound).

## Direction for the whole set

- **One palette.** Every effect is synthesized in-house from the same building blocks: rounded
  sine-led tones, detuned saws through gentle filters, and dark filtered noise. So the game sounds
  like one world rather than a mix of sample packs. Background music (`bg1`–`bg4`) is out of
  scope. The owner moved off the Kenney picks shipped in #3559 because they didn't feel
  consistent.
- **Smooth over gritty.** The owner rejected the first attack-run drafts as "too rough". The
  set now favours sine-led tones, two-pole-filtered noise, a gentle throb, and little or no
  distortion.
- **Audible on phones.** iOS and Android are the primary platforms, and phone speakers barely
  reproduce anything under ~100 Hz. Keep the main energy above that, or add harmonics. The first
  attack-run brace (38–76 Hz) was "not noticeable enough" for this reason.
- **Telegraphs fit their window, tails don't have to.** A warning must end when its action fires,
  e.g. the beam charge is exactly `BEAM_CHARGE_MS`. Anything after the action, such as a blast
  ringing out or a roar following a swoop, can run longer at no gameplay cost.
- **Distinct threats sound distinct.** Two warnings that ask for different reactions must not
  blur together. The beam charge (dodge sideways) is a buzzy hum; the attack-run brace (a swoop
  is coming) is rumble and engine.
- **Small files.** Every sound is mono Ogg Vorbis (quality 5). Keep one-shots short and loops
  near 2 s, with the variation inside the loop rather than in a longer file. So far the
  synthesized set is a little smaller than the Kenney files it replaced (Star Swarm's `.ogg`
  total went from 401 KB to 388 KB).
- **The Carrier has one voice.** The Carrier's sounds share the beam charge's "reactor" buzz:
  the boss sting carries a little of it, so the sting introduces the ship the player hears for
  the rest of the fight.

## How a sound is chosen

1. The owner gives a brief: the feel, and optionally a reference.
2. 2–3 synthesized variants are built and auditioned by ear. A "contrast" file pairs the variant
   with a neighbouring sound when the two must stay distinct.
3. The pick is played in real gameplay. The web build runs in a headless browser at the right
   wave, using the dev panel's wave jump, infinite lives, Kill escorts and Player missiles off.
   The game's actual sounds are laid over the video at the moments they played.
4. On approval, the recipe goes into the generator and the file is regenerated from it.

## Sounds

### Carrier beam charge (`starswarm.beamcharge`)

- **Brief.** "Something starting up." The owner's reference ([freesound 253408](https://freesound.org/people/tfodor/sounds/253408/)) combined a charge-up and a blast but didn't fit the timing. The reference couldn't be fetched, so the sound was built from the description.
- **Constraint.** Exactly 0.60 s (`BEAM_CHARGE_MS`). It must end as the beam fires.
- **Auditioned.**
  - A, turbine spool-up.
  - B, capacitor whine with ticks.
  - **C, reactor hum** (picked): a low buzz that brightens and climbs while a pulse speeds up.
- **Iteration.** "Is it too fast?" Draft C packed a 5→28 Hz pulse and a full-octave climb into 0.6 s. Two ways to slow it were offered:
  - **(1)** calm the motion inside the same 0.6 s;
  - **(2)** lengthen the telegraph to 0.8 or 1.0 s, which is a balance change, out of scope.

  The owner picked the calm version: pulse 3→12 Hz, a ~0.6-octave climb.

- **Why it works.** It sounds like a machine powering up, and its buzz is the Carrier's
  "voice", reused under the boss sting.

### Carrier beam fire (`starswarm.beamfire`)

- **Brief.** A "strong laser or even space cannon".
- **Auditioned.**
  - A, a diving square-wave laser.
  - B, a saturated cannon thump.
  - **C, plasma blast** (picked): a detuned saw chord diving together, ring-modulated, with a sub thump.
- **Iteration.** The tail was lengthened from 0.5 s to 0.9 s, since the ring-out plays after the bolt has crossed the screen and doesn't affect gameplay.
- **Why it works.** A chord diving together reads as a heavy energy weapon rather than a
  pew-pew laser. Sharing the reactor palette makes charge and fire feel like one action.

### Carrier attack-run brace (`starswarm.attackrun`)

- **Brief.** The owner felt the Kenney `spaceEngine_000` brace was the closest of the old set:
  a heavy low engine with a fast throb. Keep that DNA in the new palette.
- **Constraint.** The brace is 0.80 s (`ATTACK_RUN_BRACE_MS`). It must stay distinct from the
  beam charge.
- **Auditioned.**
  - A, heavy throb.
  - **B, throttle-up** (picked): pitch climbs an octave while the throb speeds up into the lunge.
  - C, rear-and-lunge: a two-part wind-up plus a whoosh.
- **Iteration 1, "too rough".** Rebuilt sine-led: darker two-pole rumble, the throb depth halved
  (70% → 35%), and no distortion.
- **Iteration 2, "too quiet and perhaps short".**
  - Moved the engine up from 38–76 Hz to 52–104 Hz and added harmonics, so it carries on phone speakers.
  - Started it at ~2/3 level instead of ~1/3.
  - Added a 0.5 s roar-away tail that follows the swoop, so it lasts 1.3 s with no gameplay effect.
  - Raised the default volume from 0.7 to 0.9.

  The owner approved it from the in-game clip: "perfect".

- **Why it works.** A rising engine reads as "it's about to move", which is a different message from the beam's charging hum.

### Boss-wave sting (`starswarm.bosswave`)

- **Plays at** a boss wave being sighted, and the Carrier's final stand. It replaced the old
  0.31 s `freefirezone` phaser sting.
- **Recommendation accepted.** An alarm made from the Carrier's own sound, so the sting
  introduces the ship. It has no timing window, so it can be big. It needs mid-range presence to
  cut through the music.
- **Auditioned.**
  - **A, ominous horn** (picked): a slow two-note synth-brass "dun… DUN", down a semitone, with a thump under the second note and a reactor-buzz bed.
  - B, klaxon: three two-tone alarm pulses.
  - C, deep brass stab: one chord.
- **Why it works.** Two falling notes say "trouble has arrived" more than "alarm, react now".
  That fits a fight that opens with a swoop-in rather than an immediate threat.
- **Possible later.** Give the final stand its own key, with the same motif faster and higher.

### Carrier reinforcements (`starswarm.reinforce`)

- **Brief.** The Carrier's bay opens, then the ships come out: "a door open with a quick
  whoosh", with the door just before they appear and the whoosh as they arrive.
- **Finding.** Reinforcements currently fly in from the top corners on the normal wave-entry
  swoop, not out of the Carrier. They never happen on boss waves or in the final stand, which is
  why the owner had never noticed them. Launching them from the Carrier's bay is a gameplay change,
  filed as #3561. This sound works for both versions.
- **Round 1.**
  - A, hangar door.
  - **B, airlock** (door liked).
  - C, launch tube.

  Each was a door followed by three whooshes, 0.2 s apart to match the Grunt stagger.

- **Round 2, "less of a whoosh than an engine or thruster… one longer sound versus three pops".**
  Kept B's airlock door (latch + pressure "pfft") and replaced the pops with one continuous
  thruster:
  - R1, steady burn.
  - R2, fly-by: pitch peaks, then drops.
  - **R3, spin-up** (picked): a smooth turbine whine climbing 110→230 Hz that fades as the Grunts reach formation.
- **Why it works.** One engine reads as a squadron launching together, not a series of separate
  events. The rising whine says "something is coming" without competing with the Carrier's own
  warnings.

### Grunt rout loop (`starswarm.rout`)

- **Plays** for as long as any Grunt is fleeing after the leaders die, usually 2–3 s. It
  replaced the Kenney `thrusterFire_001` loop.
- **Direction.** A sibling of the reinforcement engine, going the other way: the Grunts losing
  their nerve. It must loop seamlessly, so it is a 2.0 s loop whose modulations all complete
  whole cycles, and the tail is crossfaded into the head.
- **Auditioned** as each loop played three times in a row, to hear the seam:
  - A, retreat thrusters: a dark roar with a slow engine wobble.
  - B, scattering swarm: three drifting engine whines.
  - **C, panic warble** (picked): one engine at ~165 Hz with a fast nervous 6 Hz vibrato and a 3 Hz tremolo over a dark roar.
- **Gameplay audition.** A rout needs every leader dead while Grunts live, which the automated
  pilot never reaches. For the recording only, a local, uncommitted patch made the dev panel's
  Kill escorts kill just the leaders.
- **Why it works.** The warble reads as panic. That separates a fleeing formation from the
  steady, confident engines of the Carrier and its reinforcements.

### Pickup (`starswarm.powerup*`, `salvage`, `hullup`: one shared file)

- **Brief.** The previous pick, Kenney `spaceTrash5` at 1.43 s, was "terrible, too obnoxious". It
  needs to be "a quick recognition of achievement". The owner asked to hear a bright chime, a
  quick rising zap, and something warmer.
- **Constraint.** It is the most frequent sound in the game: every power-up, salvage crate and
  hull plating. Keep it short and soft-edged so it rewards without grating, around 0.3–0.45 s
  versus the old 1.43 s.
- **Auditioned.**
  - A, bright chime: two bell notes, "ding-ding".
  - B, rising zap: a soft two-octave sweep in ~0.1 s.
  - **C, warm mallet** (picked): two soft mallet notes rising a fifth (C5→G5), with a faint shimmer an octave above.
- **Why it works.** A rising fifth is the simplest "success" interval. Mallet tones are round and
  decay fast, so the pickup reads instantly and gets out of the way. That matters when it plays
  on the same tick as the gun-level riff (salvage) or the bomb blast (a Smart Bomb).
- **Audition note.** Dev-injected Shield and Lightning were used to guarantee pickups on camera.
  The clip also showed the Lightning per-shot laser firing ~12 times a second, which is worth
  revisiting when `starswarm.laser` comes up.

### Shield (`starswarm.shieldon`, `shieldloop`, `shieldwarn`, `shieldoff`)

- **Brief.** "It's a shield… not meant to overwhelm." It is a second way, besides the HUD timer,
  to know when the shield is up and when it drops. It should pop on louder, then hold as a
  duller but noticeable sound for its duration. It needs a distinct cue just before it ends,
  and a sound when it's done.
- **Design.** Four parts, with their relative levels baked into the files, so one shared volume keeps the balance:
  - **On:** the loudest part.
  - **Hum:** quiet.
  - **Warning:** about 1 s before the end, tied to the shield's remaining time like the HUD timer.
  - **Off:** a short power-down.

  The off sound also plays when Lightning replaces the shield.

- **Auditioned** as full 5 s sequence previews:
  - **1, force field** (picked): rising shimmer on, soft two-tone hum, a stutter warning like a failing field, falling sweep off.
  - 2, energy bubble: "bwomp" on, wobbling hum, two pips, deflate off.
  - 3, crystal barrier: bell bloom on, airy pad, accelerating ticks, sparkle off.
- **Why it works.** The stutter reads as the field failing before the player looks at the timer, and the falling sweep closes the loop the rising shimmer opened.

### Buddy (`starswarm.buddyin`, `buddyloop`, `buddyout`)

- **Brief.** The old Buddy sound had "gotten too obnoxious". It should be there but "even less
  pronounced than shield": the shield is on the player, while Buddy "is doing its own thing".
  Thrusters bring it in, a little background noise says it's still there, and thrusters again
  on its way out.
- **Design.** In and out thrusters, and a hum during `OnStation` only. The hum is baked about
  7 dB quieter than the shield hum.
- **Auditioned** as lifecycle previews:
  - 1, small jet.
  - **2, hover drone** (picked): a soft whoosh in, a gentle 300 Hz hover warble, and a fly-by that falls in pitch as it leaves.
  - 3, warp.
- **Why it works.** The hover warble sits under the action like a companion's engine. The falling fly-by tells the player Buddy is leaving, not that it was destroyed.

### Buddy down (`starswarm.buddydown`)

- **Finding.** Buddy had no death sound of its own. It played the same generic explosion as
  every enemy, plus a screen-reader announcement. The owner: "it deserves its own sound if it is
  shot down." On that tick the generic explosion is skipped.
- **Auditioned.**
  - 1, a blast with a falling whine.
  - 2, an engine wind-down and crunch.
  - **3, sad blips and pop** (picked): three descending notes (E5 C5 G4) and a soft pop.
- **Why it works.** Losing an ally should register as a loss, not as one more explosion. Three
  falling notes say "we lost something", and the pop stays small, because Buddy isn't the player.

### Smart Bomb (`starswarm.bombblast`)

- **Brief.** "It's just an explosion."
- **Auditioned.**
  - 1, a big boom with a long rumble.
  - **2, shockwave** (picked): a boom plus an expanding "whumm", as a noise band opens and closes.
  - 3, a crackling blast with debris.
- **Why it works.** The expanding sweep matches what the bomb does, clearing the whole screen at
  once, which a plain boom doesn't. It's also 17 KB, down from 79 KB.

### Lightning (`starswarm.lightningloop`)

- **Brief.** Lightning should be "a more smooth tone instead of having individual firing
  mechanisms", lightning-ish. The owner's idea was a Tesla-coil buzz, but they wanted to hear a
  crackling hum and a smooth beam too.
- **Finding.** Lightning played the per-shot laser (#1106) about 12 times a second for the whole
  5 s. The gameplay audition made that chatter obvious. The per-shot sound is retired. One loop
  plays while Lightning is active.
- **Gameplay follow-up.** The owner wants Lightning to become a continuous beam, like the
  Carrier's. That is a gameplay change, filed as #3562. The loop suits both today's shots and the
  future beam.
- **Auditioned** as loops played three times:
  - **1, Tesla-coil buzz** (picked): a buzzing 120 Hz saw arc with a 30 Hz flutter and snapping crackles.
  - 2, crackling electric hum.
  - 3, smooth humming beam.
- **Why it works.** It sounds like electricity rather than gunfire, so it reads as a power state,
  and its texture is distinct from the shield's soft hum.

### Enemy explosion (`starswarm.explosion`)

- **Constraint.** It plays on every kill, dozens of times a wave, so it must be light and short.
  The old file was 0.91 s long and very quiet (about -30 dB mean at volume 0.45, close to
  inaudible).
- **Auditioned** as bursts of five kills, the way it is heard in play:
  - 1, soft pop-boom.
  - 2, crunchy pop.
  - **3, digital puff** (picked): a retro falling blip over a soft filtered puff, 0.30 s.
- **Mix.** The new file is ~13 dB louder than the old one. Its default volume was set to 0.2, so
  kills are audible but sit well under the hits and warnings.
- **Why it works.** The retro blip ties the kills to the arcade feel. At 0.3 s, a burst of kills
  doesn't smear together.

### Hull hit and player hit (`starswarm.hullhit`, `starswarm.playerhit`)

- **Constraint.** The two can happen moments apart, so the difference in severity must be
  obvious. A hull hit means the plating absorbed it and you're fine. A player hit means a life
  was lost.
- **Auditioned** with "contrast" files, a hull hit followed by a player hit:
  - **Hull:** 1, armor clang; 2, deflect ping; **3, dull plate thud** (picked): a low knock with a short metallic rattle, 0.32 s.
  - **Player:** **1, damage alarm** (picked): an impact thump, then a falling two-tone warning, 0.70 s; 2, crash + power drop; 3, glitch hit.
- **Gameplay audition.** The run started with two hull plates (a local, uncommitted patch: the dev
  panel can't inject plating), with infinite lives off, on wave 5. The beams' hits gave two hull
  hits, then two lives lost, then game over.
- **Why it works.** The thud is short and physical: something hit your armor. The alarm adds a
  warning on top of the impact, which says the hit cost you something.
