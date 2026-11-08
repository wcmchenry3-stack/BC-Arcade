# Star Swarm art design log (#3590, #3591)

Why Star Swarm looks the way it does: the owner's brief, the styles tried, what was picked and
why. The **recipes** live in `tools/assets/draw_starswarm_art.py`. This log keeps the
**reasoning**, as [`starswarm-sound-design.md`](starswarm-sound-design.md) does for sound. Add an
entry for every sprite family you change.

## The brief

Star Swarm's images were third-party Kenney sprites (CC0), stretched into boxes of a different
aspect ratio, plus a lot of shapes drawn in code with no shared look. The ship was orange although
the theme says the player is cyan. The epic (#3590) gives the whole game one original look:
every sprite **and** every code-drawn visual (shots, telegraphs, auras, the starfield, the HUD).

## The three-style test

The same test set was drawn three ways over the starfield: the player ship, a Grunt, a large
asteroid, a player shot and an enemy shot.

| Style                               | Idea                                     |
| ----------------------------------- | ---------------------------------------- |
| A, neon vector                      | Glowing outlines on black.               |
| **B, clean modern sci-fi** (picked) | Shaded hulls, panel lines, engine glows. |
| C, retro pixel                      | A low-res pixel grid scaled up crisply.  |

The owner picked **B**. Keep today's modern sci-fi feel, but reimagine each thing from its
**role** in the game, not from what the Kenney packs happened to offer.

## Art-direction decisions (from #3590)

- **Enemies are an insectoid hive.** A bio-mechanical swarm: organic curves, stingers, glowing
  cores. The family gets more armoured and ornate by tier: Grunt (cheap drone), Elite (hunter with
  visible stingers), Guardian (shield-bearer), Carrier (hive mothership with a real hangar bay
  where the #3561 bay opens, with armoured, exposed and final-stand looks).
- **The art shows game state.**
  - Gun level on the ship: L1 nose cannon, L2 adds wing guns, L3 adds spread pods.
  - Hull plating on the ship: visible armour while held.
  - Enemy damage: Elites, Guardians and the Carrier show cracks and sparks as HP drops. This
    replaces the web-only HP pips, so both platforms match.
  - Guardian-to-Carrier shield link: energy lines from each living Guardian to the armoured
    Carrier, so the rule for dropping its armour is visible.
- **The player is white or silver with cyan accents**, matching the theme's cyan-for-player rule.
  Buddy becomes its own small wingman drone in the same colours, not a recoloured ship.
- **A subtle nebula** sits behind the three star layers, drawn once and cheap on phones.

### Colour roles

| Role                     | Colours               |
| ------------------------ | --------------------- |
| Friendly                 | White or silver, cyan |
| Enemy hulls              | Violet and purple     |
| Enemy weapons and danger | Hot red or orange     |
| Telegraphs               | Amber                 |
| Rewards                  | Gold or green         |
| Neutral hazards          | Brown or grey         |

Danger (enemy shots, telegraphs) must stay instantly distinguishable from rewards (pickups) and
from the player's own fire. Check any new sprite against that before anything else.

### Shape language

- **Shots.** Friendly bolts are elongated; enemy shots are round plasma orbs. The Lightning beam
  is electric blue-white with an edge crackle.
- **Pickups.** One shared "supply pod" shape with a type icon and a colour per power-up. The
  salvage crate is gold; the hull plate is shaped like an armour plate.
- **Asteroids.** Large rocks carry glowing ore veins, which signal salvage (#3568). Small rocks
  don't.
- **Explosions.** Scaled by what died, from a small pop for a Grunt to a blast with debris for the
  Carrier. Drawn in code, not as 20 PNGs.
- **Motion.** A two-frame engine flicker, and glow pulses on telegraphs.

## Silhouette and shading rules

- **Silhouette first.** It must read at **24 to 54 px** (Grunt 24, Elite 28, Guardian 36x32,
  Carrier 54x48, player 34). Check every sprite at game size, not just at 3x.
- **Light from the top-left.** Highlights top-left, shadow bottom-right. Where a gradient is
  horizontal (hulls), it is light-to-dark across the part.
- **2 to 3 tones plus one accent.** A base tone, a shade, an optional highlight, and one glowing
  accent (cyan for friends, red or orange for enemy weapons and cores).
- **Minimum strokes.** Edge lines are at least **0.35 game px** (about 1 px in the 3x sprite) and
  usually 0.4 to 0.75; thinner lines vanish after the downscale to game size. Panel lines and
  rivets must be at least 3 px at 3x, or leave them out (the generator's rivets are 3 px across).
- **Thresholds.** The numbers in the silhouette and stroke rules above (24 to 54 px, 0.35 game
  px, 3 px rivets, 4 px padding) are generator conventions, not owner rules. The owner decisions
  are in the decisions log.
- **Glows** are radial gradients fading to alpha 0 and stay inside the padding (4 game px =
  12 px at 3x). Anything that needs a wider halo is drawn in code.
- **Padding.** Every sprite has the same transparent margin (`PAD`, 12 px at 3x), so glows and the
  armour outline are never clipped. A test checks that the outline is zero on the outermost pixel
  of the canvas for every ship, gun level and hull level.

## Player ship layers and the armour outline

Each ship ships as **five layers** drawn on top of each other at runtime. All layers of a ship
share one canvas size and origin (126x126 px for the 34 px box: 102 px plus 12 px padding each
side), so they stack with no offsets.

| Layer      | Contents                                                            |
| ---------- | ------------------------------------------------------------------- |
| `base`     | The hull and the L1 nose cannon                                     |
| `guns2`    | L2 wing pods                                                        |
| `guns3`    | L3 angled spread pods                                               |
| `plating1` | Hull level 1: bolted plates on the wing roots                       |
| `plating2` | Hull level 2: nose cowl and wing-edge armour (drawn over plating 1) |

The game draws `base`, then `guns2` if the gun level is 2 or more, `guns3` at 3, then the plating
layers up to the held hull level (`HULL_MAX = 2`).

**The armour outline is not an image.** It is a blue rim drawn in code around the _composed_
ship: the runtime dilates the stacked layers, tints the result `#1fb6ff` and blurs it, then draws
the ship over it. Because it dilates the composed layers, the engine and muzzle glows are dilated
too and pick up a faint blue haze. It is thin and 75% strong at hull 1, bold and full strength at
hull 2. Both renderers build the glow once per ship, gun level and hull level and cache it, so a
frame is one image draw under the layers: native renders the layers through a Skia image filter
(dilate, tint, blur) onto an offscreen surface the first time a combination is on screen and keeps
the snapshot (`drawFrame.ts`); web builds the same glow into an offscreen canvas when the images
load (`render/outlineGlow.ts`). The two are very close, not identical: Skia's dilate kernel is
square, the web's is a circle of offsets. It costs no image bytes. The runtime numbers
(`ARMOUR_OUTLINE` in `render/ship.ts`) are in game px.

The generator's `armour_outline()` simulates the rim for the contact sheet with a hull-only
silhouette (no engine or muzzle glows), so the sheet shows the rim hugging the hull with no haze.
It is an approximation of the runtime look, not an exact match; judge the haze in the game.

The three hulls are **P1 Arrow** (slim delta-wing interceptor), **P2 Forward-swept** (canards,
forward-swept wings, one big engine) and **P3 Twin-boom** (a cockpit pod between two engine
booms).

## The generator

`tools/assets/draw_starswarm_art.py` uses only Pillow and numpy (no cairo: pycairo has no Linux
wheel, so it can't be installed in CI without system libraries). It is deterministic: the same
code gives identical decoded pixels.

```bash
python tools/assets/draw_starswarm_art.py                                # all recipes, new temp dir
python tools/assets/draw_starswarm_art.py --out /tmp/art grunt-wasp      # one recipe
python tools/assets/draw_starswarm_art.py --out /tmp/art --sheet         # plus contact-sheet.png
```

- Output is `starswarm-<name>.webp` (quality 82, alpha quality 70, method 6) and each file's byte size is printed.
  Unknown names exit non-zero listing the valid ones, before anything is written, whatever the
  argument order.
- The generator writes into `--out`, never into `frontend/assets` by itself. Each story copies
  what it ships: #3592 copied `starswarm-p1-arrow-<layer>.webp` to
  `frontend/assets/starswarm/player/p1-<layer>.webp` and `starswarm-buddy-escort.webp` to
  `frontend/assets/starswarm/buddy-escort.webp`. Re-run the generator and copy again whenever a
  recipe changes (the credits rows name the recipe).
- `--sheet` renders every recipe at 3x and at game size shown 2x, and every gun level and hull
  level composite of each ship with the outline simulated, built from the decoded shipped WebPs so
  it shows the shipped look. Use it for owner reviews.

**How it draws.** Shapes are rasterized at 8x with `ImageDraw` (only inside each shape's bounding box) and downscaled with LANCZOS for
anti-aliasing, then filled with a solid colour or a numpy linear or radial gradient through the
mask, and composited over a premultiplied float canvas. Helpers: `Canvas.polygon`, `ellipse`,
`stroke`, `fill_stroke`, `glow`, and `armour_outline`. Coordinates are in box pixels.

**Adding a recipe.**

1. Write a function that creates a `Canvas(box_w, box_h)` at 3x the game box, draws, and returns
   `canvas.image()`.
2. Register it in `RECIPES` under a short kebab-case name.
3. Run it with `--sheet`, look at it at game size on the dark background, and check the colour
   roles above.
4. Add the name to the tests' expectations and set its byte budget from what you measured, with
   about 25% headroom.

**Palette.** The generator keeps its own palette constants (top of the file). The runtime palette
(`frontend/src/game/starswarm/render/palette.ts`, `theme.starswarm.ts`) mirrors them for the
code-drawn parts that have been restyled: from #3592, the armour blue (`#1fb6ff`, also the
outline), the shield bubble (canopy cyan and its pale rim), the Lightning aura, and Buddy's HP
bar (cyan, amber, red) and hit ring. When a later story restyles another code-drawn part (shots,
telegraphs), add the colour there and keep it equal to the generator's, so a sprite and a
code-drawn effect that touch each other match.

## Size baseline and budget

**After #3592** (player ship and Buddy): **41 images, 66,010 B (64.5 KB)**. The player is now P1's
five layers, 7,070 B (base 2,850, guns2 850, guns3 1,056, plating1 986, plating2 1,328), and Buddy
is 2,244 B, together 9,314 B against 3,856 B before (+5,458 B). Lowering the WebP quality from 90
to 82 (alpha quality 70) cut each ship from about 10.7 KB to 7.1 KB (P2 7.4 KB, P3 5.9 KB) with
no visible change at game size. Only P1 ships; P2 and P3 add 13.3 KB if #3600 ships them.

Before (`dev` at 491dbb1): **37 images, 60,552 B (59.1 KB)** under `frontend/assets/starswarm/`:
Player and Buddy 3,856 B, Enemies 13,082, Projectiles 2,028, Pickups 2,755, Asteroids 13,206,
Explosion (20 PNGs) 25,625. The target is to stay near or below that total. Code-drawn visuals
cost no asset bytes but add to the JS bundle (5.68 MB today, against a 6.0 MiB warning and 8.0 MiB
hard limit), so each story reports both. The extra variant files are offset by drawing explosions
in code (-25 KB), dropping the unused `bullet-enemy`, and authoring at a uniform 3x.

Each story reports its "after" against this table, and the epic closes with a final table. The
generator's tests hold a **byte budget per recipe**, so a recipe can't grow unnoticed.

## Decisions log

- **2026-11-08, style B picked.** See above.
- **Player hulls approved.** P1, P2 and P3 all kept, with L1/L2/L3 gun hardware and two hull
  plating levels. The owner approved the hull images.
- **Layers over baked combinations.** Nine baked gun and hull combinations per ship were about
  43 KB per ship (about 130 KB for three). Five layers were about 8 KB per ship (about 23 KB for
  three) in the cairo prototype. The Pillow generator, with 12 px padding and its own anti-aliasing,
  measures:

  | Ship             |  base | guns2 | guns3 | plating1 | plating2 |  Total |
  | ---------------- | ----: | ----: | ----: | -------: | -------: | -----: |
  | P1 Arrow         | 4,134 | 1,238 | 1,632 |    1,484 |    2,168 | 10,656 |
  | P2 Forward-swept | 4,714 | 1,246 | 1,588 |    1,286 |    2,444 | 11,278 |
  | P3 Twin-boom     | 3,912 | 1,114 | 1,556 |      844 |    1,460 |  8,886 |

  That is 30.8 KB for all three (still far below the baked approach). Shipping all three ships
  will take up about half of the old image budget, so #3592 should decide whether to ship one
  ship first, and the picker story whether to ship the others. (Superseded by the #3592 entry
  below: quality 82 made it about 7 KB per ship, and P1 ships first.)

- **2026-11-08 (#3592), Buddy = B1 Escort.** A small silver delta drone with a cyan canopy and wing
  stripes, one engine glow; it reads as a mini P1, in the player's colours, as the brief asks
  (the alternatives were B2 Orb and B3 Twin-pod). Same 34 px box, hitbox and mirroring by travel
  direction as before.
- **2026-11-08 (#3592), player art ships as P1 layers only.** The default ship P1 Arrow ships as
  five layers in `frontend/assets/starswarm/player/`; the ship id is a parameter (default `p1`)
  for #3600. WebP quality is 82 with alpha quality 70 (was 90), so a ship is about 7 KB (target
  about 8 KB). Padding stays 12 px at 3x: it costs almost no bytes (transparent) and the bold
  outline needs 9 px of it. The Kenney `player-ship` and `buddy-ship` are gone. Byte budgets in
  the tests: `base` at most 4,000, other player layers 2,000, a ship's five layers 9,000, Buddy
  2,800, Grunt 2,000.
- **2026-11-08 (#3592), code-drawn player effects restyled.** Shield aura: a soft cyan-blue energy
  bubble with a brighter rim and a faint hexagon (there was no clearer brief). Plating flash:
  armour-blue ring with a pale core. Lightning: an electric-blue halo and sparks instead of a
  yellow box tint. Buddy HP bar: cyan, amber, red. All timings unchanged.
- **Grunt = G2 Wasp.** A light insectoid drone: twin membrane wings, a segmented body, a stinger
  and a glowing red core (2,748 B at 72 px plus padding, 96x96). The alternatives, Beetle and Manta,
  were shown in the owner's design sheet and not picked. No gameplay change: same size, hitbox and behaviour.
- **Ship picker.** Choosing one of the three ships is its own story, #3600 (three free cosmetic
  ships, P1 default).
