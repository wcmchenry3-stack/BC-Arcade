"""
pytest suite for draw_starswarm_art.py (#3591).

Renders the real recipes (they are small), but writes only into tmp_path.
"""

import itertools
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")
ImageFilter = pytest.importorskip("PIL.ImageFilter")

import draw_starswarm_art as art

SCRIPT = Path(art.__file__)
SHIP_NAMES = ["p1-arrow", "p2-forward-swept", "p3-twin-boom"]
PLAYER_SIZE = (34 * art.SCALE + 2 * art.PAD,) * 2  # 102 px box + padding
GRUNT_SIZE = (24 * art.SCALE + 2 * art.PAD,) * 2  # 72 px box + padding
BUDDY_SIZE = (34 * art.SCALE + 2 * art.PAD,) * 2  # 102 px box + padding (same box as the player)

# Byte budgets: measured 2026-11-08 at quality 82 / alpha quality 70 (#3592, see the guide).
# They assume the repo's Pillow and libwebp (Pillow is deliberately not pinned) and carry ~25%
# headroom, so a different libwebp build should still pass; if one does not, re-measure and raise
# the budget rather than pin Pillow.
BUDGET_BASE = 4000
BUDGET_LAYER = 2000
BUDGET_GRUNT = 2000  # #3708: 1,560 (the bolder Wasp; was 1,464)
BUDGET_BUDDY = 2800
BUDGET_SHIP = 9000  # all five layers of one ship; the target is about 8 KB (measured 5.9-7.4 KB)
# #3593: the rest of the hive, measured 2026-11-08 (bytes in the comments), ~25% headroom; the
# owner asked for about 2 KB per extra Elite sprite
BUDGET_ENEMY = {
    "elite-mantis": 2600,  # 2,066
    "elite-mantis-attack": 3000,  # 2,374
    "elite-mantis-hurt": 2900,  # 2,270
    "guardian-scarab": 2700,  # 2,092
    "guardian-scarab-plate": 2100,  # 1,664
    "guardian-scarab-cracks": 1100,  # 842
    "guardian-scarab-plate2": 1700,  # 1,322
    "carrier-queen": 5400,  # 4,302
    "carrier-queen-cracks": 2400,  # 1,942
}
ENEMY_NAMES = ["grunt-wasp", *BUDGET_ENEMY]
# #3596: the rocks, measured 2026-11-09 (bytes in the comments), ~20% headroom. Together they
# must stay under the four Kenney meteors they replace (13,206 B).
BUDGET_ROCK = {
    "rock-large-1": 3100,  # 2,550
    "rock-large-1-veins": 2350,  # 1,936
    "rock-large-2": 2950,  # 2,422
    "rock-large-2-veins": 1600,  # 1,282
    "rock-small-1": 1650,  # 1,366
    "rock-small-2": 1700,  # 1,418
}
KENNEY_METEORS_BYTES = 13206
ROCK_NAMES = list(BUDGET_ROCK)
# #3594: the projectiles, measured 2026-11-09 (bytes in the comments), ~25% headroom
BUDGET_SHOT = {
    "shot-player": 650,  # 528
    "shot-buddy": 500,  # 412
    "shot-enemy": 710,  # 568
    "shot-flak": 780,  # 624
    "shot-carrier": 710,  # 566
}
SHOT_NAMES = list(BUDGET_SHOT)
BUDGET_PICKUP = {
    "pickup-shield": 2000,  # 1,602 (30 px token box)
    "pickup-lightning": 1900,  # 1,524
    "pickup-buddy": 1840,  # 1,472
    "pickup-bomb": 2130,  # 1,704
    "pickup-salvage": 940,  # 750
    "pickup-hull": 2010,  # 1,612
}
PICKUP_NAMES = list(BUDGET_PICKUP)
BUDGET_TILE_BADGE = 3400  # #3599: the home tile icon, 2,698 measured 2026-11-11
ROCK_SIZE = {
    "large": (44 * art.SCALE + 2 * art.ROCK_PAD,) * 2,  # 132 px box (2 x r22) + padding
    "small": (24 * art.SCALE + 2 * art.ROCK_PAD,) * 2,  # 72 px box (2 x r12) + padding
}
# The canvas of each tier's box (TIER_SIZE at 3x) plus the padding on every side
ENEMY_SIZE = {
    "grunt": GRUNT_SIZE,
    "elite": (28 * art.SCALE + 2 * art.PAD,) * 2,
    "guardian": (36 * art.SCALE + 2 * art.PAD, 32 * art.SCALE + 2 * art.PAD),
    "carrier": (54 * art.SCALE + 2 * art.PAD, 48 * art.SCALE + 2 * art.PAD),
}
SPACE = (0, 0, 16)  # #000010, the playfield behind every enemy


def _tier(name: str) -> str:
    return name.split("-")[0]


def _budget(name: str) -> int:
    if name == "home-tile-badge":
        return BUDGET_TILE_BADGE
    if name == "grunt-wasp":
        return BUDGET_GRUNT
    if name == "buddy-escort":
        return BUDGET_BUDDY
    if name in BUDGET_ENEMY:
        return BUDGET_ENEMY[name]
    if name in BUDGET_ROCK:
        return BUDGET_ROCK[name]
    if name in BUDGET_SHOT:
        return BUDGET_SHOT[name]
    if name in BUDGET_PICKUP:
        return BUDGET_PICKUP[name]
    return BUDGET_BASE if name.endswith("-base") else BUDGET_LAYER


def _size(name: str) -> tuple[int, int]:
    if name == "home-tile-badge":
        return (art.TILE_ICON_SIZE,) * 2
    if name == "buddy-escort":
        return BUDDY_SIZE
    if name in ENEMY_NAMES:
        return ENEMY_SIZE[_tier(name)]
    if name in ROCK_NAMES:
        return ROCK_SIZE[name.split("-")[1]]
    if name in SHOT_NAMES:
        w, h = art.SHOT_BOXES[name]
        return (w * art.SCALE + 2 * art.SHOT_PAD, h * art.SCALE + 2 * art.SHOT_PAD)
    if name in ("pickup-salvage", "pickup-hull"):
        return (art.PICKUP_BOX * art.SCALE + 2 * art.PICKUP_PAD,) * 2
    if name in PICKUP_NAMES:  # the power-up tokens draw larger than their hitbox
        return (art.PICKUP_TOKEN_BOX * art.SCALE + 2 * art.PICKUP_PAD,) * 2
    return PLAYER_SIZE


def test_registry_has_five_layers_per_ship_the_hive_buddy_the_rocks_shots_and_pickups():
    expected = {f"{s}-{layer}" for s in SHIP_NAMES for layer in art.LAYERS}
    assert set(art.RECIPES) == (
        expected
        | set(ENEMY_NAMES)
        | {"buddy-escort"}
        | set(ROCK_NAMES)
        | set(SHOT_NAMES)
        | set(PICKUP_NAMES)
        | {"home-tile-badge"}
    )


def test_tier_boxes_match_the_game():
    """The enemy art is authored at TIER_SIZE's aspect ratios (frontend engine/tuning.ts)."""
    assert art.ENEMY_BOXES == {
        "grunt": (24, 24),
        "elite": (28, 28),
        "guardian": (36, 32),
        "carrier": (54, 48),
    }


@pytest.mark.parametrize("name", list(art.RECIPES))
def test_recipe_size_alpha_and_content(name):
    im = art.render(name)
    assert im.mode == "RGBA"
    assert im.size == _size(name)
    alpha = np.asarray(im)[..., 3]
    assert alpha.max() == 255  # something opaque is drawn
    assert alpha[0, 0] == 0  # corners stay transparent (padding)
    assert (alpha[1:-1, 1:-1] > 0).sum() > 20


def _bbox(im):
    """(x0, y0, x1, y1) of the non-transparent pixels, x1/y1 exclusive."""
    ys, xs = np.nonzero(np.asarray(im)[..., 3])
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


@pytest.mark.parametrize("ship", SHIP_NAMES)
def test_player_layers_share_canvas_and_stay_inside_the_padded_box(ship):
    layers = {layer: art.render(f"{ship}-{layer}") for layer in art.LAYERS}
    assert {im.size for im in layers.values()} == {PLAYER_SIZE}
    for layer, im in layers.items():
        x0, y0, x1, y1 = _bbox(im)
        # content may use the padding (glows, strokes) but never touch the canvas edge
        assert x0 >= 1 and y0 >= 1, layer
        assert x1 <= PLAYER_SIZE[0] - 1 and y1 <= PLAYER_SIZE[1] - 1, layer
    # layers register on one origin: the base hull is centred on the canvas
    bx0, _, bx1, _ = _bbox(layers["base"])
    assert abs((bx0 + bx1) / 2 - PLAYER_SIZE[0] / 2) <= 2


@pytest.mark.parametrize("ship", SHIP_NAMES)
@pytest.mark.parametrize("hull", [1, 2])
@pytest.mark.parametrize("guns", [1, 2, 3])
def test_armour_outline_never_reaches_the_canvas_border(ship, hull, guns):
    cache = {n: art.render(n) for n in art.RECIPES if n.startswith(ship)}
    alpha = np.asarray(art.compose_ship(ship, guns, hull, cache))[..., 3]
    border = np.concatenate([alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]])
    assert border.max() == 0


def test_buddy_escort_is_a_centred_symmetric_drone_inside_its_padding():
    im = art.render("buddy-escort")
    x0, y0, x1, y1 = _bbox(im)
    assert x0 >= 1 and y0 >= 1 and x1 <= BUDDY_SIZE[0] - 1 and y1 <= BUDDY_SIZE[1] - 1
    assert abs((x0 + x1) / 2 - BUDDY_SIZE[0] / 2) <= 1
    # the game mirrors the sprite by its travel direction, so it must read the same both ways
    alpha = np.asarray(im)[..., 3].astype(int)
    assert np.abs(alpha - alpha[:, ::-1]).mean() <= 0.5  # edge pixels differ by sub-pixel rounding
    # the hull is silver and the accents cyan: the drone matches the player's colours
    rgba = np.asarray(im).astype(int)
    solid = rgba[rgba[..., 3] == 255][:, :3]
    assert (solid.sum(1) > 600).any()  # near-white silver highlights
    assert ((solid[:, 1] > 200) & (solid[:, 2] > 190) & (solid[:, 0] < 40)).any()  # cyan


@pytest.mark.parametrize("ship", SHIP_NAMES)
def test_armour_outline_follows_the_hull_not_the_glows(ship):
    cache = {n: art.render(n) for n in art.RECIPES if n.startswith(ship)}
    hull = art.hull_alpha(ship, "base")
    glow_only = (np.asarray(cache[f"{ship}-base"])[..., 3] > 40) & (hull == 0)
    assert glow_only.sum() > 20  # the engine halos do extend beyond the hull
    out = np.asarray(art.compose_ship(ship, 1, 2, cache))[..., 3] > 40
    plain = np.asarray(art.compose_ship(ship, 1, 0, cache))[..., 3] > 40
    mask = np.maximum.reduce(
        [art.hull_alpha(ship, layer) for layer in art.LAYERS[:1] + art.LAYERS[3:]]
    )
    # radius 12 covers the grow (4) plus the blur (~5), with slack; halos would reach ~18
    near = Image.fromarray(((mask > 40) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(25))
    rim = out & ~plain
    assert not (rim & ~(np.asarray(near) > 0)).any()  # rim stays within the hull's dilation


@pytest.mark.parametrize(
    "name",
    [
        "p2-forward-swept-base",
        "grunt-wasp",
        "p3-twin-boom-plating2",
        "elite-mantis-hurt",
        "carrier-queen-cracks",
    ],
)
def test_deterministic_decoded_pixels(name, tmp_path):
    a = np.asarray(art.render(name))
    b = np.asarray(art.render(name))
    assert np.array_equal(a, b)
    (tmp_path / "a").mkdir()
    for d in ("a", "b"):
        (tmp_path / d).mkdir(exist_ok=True)
        art.main(tmp_path / d, [name])
    pa = np.asarray(Image.open(tmp_path / "a" / f"starswarm-{name}.webp").convert("RGBA"))
    pb = np.asarray(Image.open(tmp_path / "b" / f"starswarm-{name}.webp").convert("RGBA"))
    assert np.array_equal(pa, pb)


def test_deterministic_across_processes(tmp_path):
    name = "p2-forward-swept-base"
    here = np.asarray(art.render(name))
    code = (
        "import sys, numpy as np; sys.path.insert(0, sys.argv[1]);"
        "import draw_starswarm_art as a; np.save(sys.argv[2], np.asarray(a.render(sys.argv[3])))"
    )
    out = tmp_path / "other.npy"
    r = subprocess.run(
        [sys.executable, "-c", code, str(SCRIPT.parent), str(out), name],
        check=False,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stderr
    assert np.array_equal(here, np.load(out))


@pytest.mark.parametrize("name", list(art.RECIPES))
def test_webp_stays_under_byte_budget(name):
    data = art.to_webp(art.render(name))
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    assert len(data) <= _budget(name), f"{name}: {len(data)} B"


@pytest.mark.parametrize("ship", SHIP_NAMES)
def test_one_ships_layers_fit_in_about_eight_kilobytes(ship):
    total = sum(len(art.to_webp(art.render(f"{ship}-{layer}"))) for layer in art.LAYERS)
    assert total <= BUDGET_SHIP, f"{ship}: {total} B"


@pytest.mark.parametrize("name", ["p1-arrow-base", "p2-forward-swept-plating2", "buddy-escort"])
def test_lossy_webp_stays_close_to_the_render(name):
    """Lowering the quality to hit the size budget must not visibly change the sprite."""
    src = np.asarray(art.render(name)).astype(float)
    out = np.asarray(art.decode_webp(art.to_webp(art.render(name)))).astype(float)
    alpha_err = np.abs(src[..., 3] - out[..., 3])
    assert alpha_err.mean() <= 1 and alpha_err.max() <= 24  # the silhouette edge holds
    solid = src[..., 3] > 250
    assert np.abs(src[..., :3] - out[..., :3])[solid].mean() <= 16  # colours hold


def test_hull_layers_stack_and_armour_outline_grows_the_silhouette():
    cache = {n: art.render(n) for n in art.RECIPES if n.startswith("p1-arrow")}
    plain = art.compose_ship("p1-arrow", 3, 0, cache)
    thin = art.compose_ship("p1-arrow", 3, 1, cache)
    bold = art.compose_ship("p1-arrow", 3, 2, cache)
    area = [int((np.asarray(i)[..., 3] > 10).sum()) for i in (plain, thin, bold)]
    assert area[0] < area[1] < area[2]


def test_main_writes_only_the_requested_names(tmp_path, capsys):
    art.main(tmp_path, ["grunt-wasp"])
    assert [p.name for p in tmp_path.iterdir()] == ["starswarm-grunt-wasp.webp"]
    assert "grunt-wasp" in capsys.readouterr().out


def _cli(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, args)],
        check=False,
        capture_output=True,
        text=True,
    )


@pytest.mark.parametrize(
    "argv",
    [
        ("nope",),  # a single typo is never taken as an output directory
        ("grunt-wasp", "nope"),
        ("nope", "grunt-wasp"),
        ("--sheet", "nope"),
        ("nope", "--sheet"),
    ],
)
def test_cli_rejects_unknown_names_before_writing(tmp_path, argv):
    out = tmp_path / "out"
    r = _cli("--out", out, *argv)
    assert r.returncode != 0
    assert "nope" in r.stderr and "p1-arrow-base" in r.stderr  # lists the valid names
    assert not out.exists()


def test_cli_single_typo_creates_nothing_in_the_working_directory(tmp_path):
    r = subprocess.run(
        [sys.executable, str(SCRIPT), "grunt-wasq"],
        check=False,
        capture_output=True,
        text=True,
        cwd=tmp_path,
    )
    assert r.returncode != 0
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("order", ["sheet-first", "sheet-middle", "sheet-last"])
def test_cli_sheet_works_in_any_position(tmp_path, order):
    names = ["grunt-wasp", "p1-arrow-base"]
    args = {
        "sheet-first": ["--sheet", *names],
        "sheet-middle": [names[0], "--sheet", names[1]],
        "sheet-last": [*names, "--sheet"],
    }[order]
    r = _cli("--out", tmp_path, *args)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "contact-sheet.png").stat().st_size > 10_000
    assert (tmp_path / "starswarm-grunt-wasp.webp").exists()
    assert (tmp_path / "starswarm-p1-arrow-base.webp").exists()


def test_cli_out_flag_is_used_and_default_is_a_temp_dir(tmp_path):
    out = tmp_path / "nested" / "dir"
    r = _cli("--out", out, "grunt-wasp")
    assert r.returncode == 0, r.stderr
    assert [p.name for p in out.iterdir()] == ["starswarm-grunt-wasp.webp"]
    r = _cli("grunt-wasp")  # no --out: a fresh temp dir, reported on stdout
    assert r.returncode == 0, r.stderr
    default = Path(r.stdout.strip().splitlines()[-1].removeprefix("output: "))
    try:
        assert (default / "starswarm-grunt-wasp.webp").exists()
        assert default.parent == Path(tempfile.gettempdir())
    finally:
        shutil.rmtree(default, ignore_errors=True)


# --------------------------------------------------------------------------------------------
# The hive (#3593)


def _decoded(names):
    return {n: art.decode_webp(art.to_webp(art.render(n))) for n in names}


def _luminance(rgb):
    c = np.asarray(rgb, float) / 255
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return c @ np.array([0.2126, 0.7152, 0.0722])


def median_contrast(im) -> float:
    """WCAG contrast of the sprite's solid pixels against #000010, at game size (the shipped
    WebP, downscaled by SCALE as the game draws it); the median over the pixels at least half
    opaque."""
    g = np.asarray(art._game_size(im)).astype(float)
    a = g[..., 3:4] / 255
    over = g[..., :3] * a + np.array(SPACE, float) * (1 - a)
    lum = _luminance(over[g[..., 3] >= 128])
    bg = _luminance(np.array(SPACE, float))
    return float(np.median((np.maximum(lum, bg) + 0.05) / (np.minimum(lum, bg) + 0.05)))


def test_every_enemy_look_is_listed():
    """Every enemy recipe is used by at least one look, and every look stacks known recipes."""
    used = {n for _, layers in art.ENEMY_LOOKS.values() for n in layers}
    assert used == set(ENEMY_NAMES)
    assert {art.ENEMY_LOOKS[k][0] for k in art.ENEMY_LOOKS} == set(ENEMY_SIZE)


@pytest.mark.parametrize("look", list(art.ENEMY_LOOKS))
def test_every_enemy_look_keeps_three_to_one_contrast_on_space(look):
    """Owner rule (#3593): every enemy sprite, in every damage look, keeps a median contrast of
    at least 3:1 at game size against #000010."""
    cache = _decoded(art.ENEMY_LOOKS[look][1])
    assert median_contrast(art.compose_enemy(look, cache)) >= 3.0


def test_the_old_dark_shell_would_fail_the_contrast_guard(monkeypatch):
    """The guard bites: the pre-#3593 shell stops make the Grunt too dark to pass. Measured on
    the pre-#3708 Grunt, whose thin rims and faint wings left the shell to carry the contrast
    (the bolder Wasp's rims and wings lift even the old shell to 3.66:1)."""
    old = [(0, art.hexrgb("#7a4aa0")), (0.5, art.hexrgb("#4b2470")), (1, art.hexrgb("#1f0d33"))]
    monkeypatch.setattr(art, "CARAPACE", old)
    for k, v in OLD_GRUNT.items():
        monkeypatch.setattr(art, k, v)
    assert median_contrast(art.decode_webp(art.to_webp(art.render("grunt-wasp")))) < 3.0


def test_the_shell_is_the_lifted_palette():
    assert [art.hexrgb(h) for h in ("#b07ae0", "#7d48b4", "#4a2378")] == [
        c for _, c in art.CARAPACE
    ]


@pytest.mark.parametrize("name", ENEMY_NAMES)
def test_enemy_sprites_stay_inside_the_padded_canvas_and_are_centred(name):
    im = art.render(name)
    w, h = im.size
    x0, y0, x1, y1 = _bbox(im)
    assert x0 >= 1 and y0 >= 1 and x1 <= w - 1 and y1 <= h - 1
    if name in ("grunt-wasp", "elite-mantis", "elite-mantis-attack", "guardian-scarab"):
        # symmetric designs: the runtime rotates them about the canvas centre when banking
        alpha = np.asarray(im)[..., 3].astype(int)
        assert np.abs(alpha - alpha[:, ::-1]).mean() <= 1.0  # edge pixels differ by rounding


def _visible(im):
    return np.asarray(im)[..., 3] > 40


def test_elite_attack_pose_spreads_the_scythes_wider():
    def span(name):
        x0, _, x1, _ = _bbox(art.render(name))
        return x1 - x0

    assert span("elite-mantis-attack") > span("elite-mantis") + 6


def test_elite_hurt_has_lost_its_right_scythe():
    """At 1 HP the right scythe is a stump: its lower right quarter is empty."""
    ok, hurt = (np.asarray(art.render(n)) for n in ("elite-mantis", "elite-mantis-hurt"))
    h, w = ok.shape[:2]
    pad = art.PAD
    box = w - 2 * pad
    lower_right = (slice(pad + int(0.7 * box), h - pad), slice(pad + int(0.6 * box), w - pad))
    red = lambda a: (a[..., 3] > 128) & (a[..., 0] > 200) & (a[..., 1] < 140)
    assert red(ok)[lower_right].sum() > 30
    assert red(hurt)[lower_right].sum() < 5
    # the core is a dull ember (the runtime flickers the bright core over it)
    cx, cy = (pad + round(c * box) for c in art.MANTIS_CORE)
    assert hurt[cy, cx, :3].max() < 160 < ok[cy, cx, :3].max()


@pytest.mark.parametrize(
    "layer", ["guardian-scarab-plate", "guardian-scarab-cracks", "guardian-scarab-plate2"]
)
def test_guardian_damage_layers_sit_on_the_shell(layer):
    """A damage layer only paints where the base shell is."""
    base = _visible(art.render("guardian-scarab"))
    lay = np.asarray(art.render(layer))[..., 3] > 40
    assert lay.sum() > 100
    assert (lay & ~base).sum() <= 0.02 * lay.sum()


def test_guardian_looks_get_darker_at_the_emitter_as_hp_drops():
    """The emitter is bright at 4 HP, dims at 3 and 2, and is dark at 1."""
    cache = _decoded(ENEMY_NAMES)
    im = art.compose_enemy("guardian-4hp", cache)
    w, h = im.size
    pad = art.PAD
    ex = pad + round(0.5 * (w - 2 * pad))
    ey = pad + round(0.42 * (h - 2 * pad))

    def glow(look):
        a = np.asarray(art.compose_enemy(look, cache)).astype(int)
        return a[ey - 3 : ey + 4, ex - 3 : ex + 4, :3].sum(-1).mean()

    g4, g3, g2, g1 = (glow(f"guardian-{n}hp") for n in (4, 3, 2, 1))
    assert g4 > g3 + 60
    assert abs(g3 - g2) < 10
    assert g2 > g1 + 100


def test_guardian_first_hit_is_obvious():
    """3 HP differs from 4 HP over a large area (the blown plate), not just a few pixels."""
    cache = _decoded(ENEMY_NAMES)
    g4, g3 = (
        np.asarray(art.compose_enemy(look, cache)).astype(int)
        for look in ("guardian-4hp", "guardian-3hp")
    )
    changed = (np.abs(g4 - g3)[..., :3].sum(-1) > 90).sum()
    assert changed > 0.08 * (g4[..., 3] > 128).sum()


def test_carrier_cracks_stay_on_the_hull():
    hull = art._queen_canvas(glows=False).px[..., 3] > 60 / 255
    cracks = np.asarray(art.render("carrier-queen-cracks"))[..., 3] > 0
    assert cracks.sum() > 100
    assert not (cracks & ~hull).any()


def test_carrier_has_its_hangar_bay_under_the_abdomen():
    """The bay (#3561 opens there) is a dark band low on the centre line, rimmed in red."""
    a = np.asarray(art.render("carrier-queen")).astype(int)
    w = a.shape[1]
    pad = art.PAD
    by = pad + round(0.86 * 48 * art.SCALE)
    cx = w // 2
    band = a[by - 2 : by + 3, cx - 10 : cx + 10]
    assert (band[..., 3] > 200).all()
    assert band[..., :3].sum(-1).mean() < 200  # dark bay doors


def test_contact_sheet_shows_every_enemy_look(tmp_path):
    art.main(tmp_path, [], sheet=True)
    sheet = Image.open(tmp_path / "contact-sheet.png")
    sprites = [n for n in art.RECIPES if n not in art.ICON_RECIPES]  # icons are not on the sheet
    rows_before = 2 * -(-len(sprites) // 9) + 2 * len(SHIP_NAMES)
    rows_looks = 2 * -(-len(art.ENEMY_LOOKS) // 9)
    rows_rocks = 2 * len(art.ROCK_PALETTES)  # #3596: every rock in each palette, then game 2x
    assert sheet.height == (rows_before + rows_looks + rows_rocks) * (art.CELL + 16)


# --------------------------------------------------------------------------------------------
# The rocks (#3596)

LARGE = [n for n in art.ROCK_VARIANTS if art.ROCK_VARIANTS[n][0] == "large"]
SMALL = [n for n in art.ROCK_VARIANTS if art.ROCK_VARIANTS[n][0] == "small"]
PALETTE_TS = Path(__file__).resolve().parents[3] / "frontend/src/game/starswarm/render/palette.ts"
SHIPPED_ROCKS = Path(__file__).resolve().parents[3] / "frontend/assets/starswarm/rock"


def _rock_cache():
    return _decoded(ROCK_NAMES)


def test_two_variants_of_each_size_and_veins_on_large_only():
    assert len(LARGE) == 2 and len(SMALL) == 2
    assert all(f"{n}-veins" in art.RECIPES for n in LARGE)
    assert not any(f"{n}-veins" in art.RECIPES for n in SMALL)


def test_rock_boxes_match_the_hitbox_diameters():
    """The art is drawn at 2 x the hitbox radius (ASTEROID_STATS: large r22, small r12)."""
    assert art.ROCK_BOXES == {"large": 44, "small": 24}


def test_the_rock_set_comes_in_under_the_kenney_meteors():
    total = sum(len(art.to_webp(art.render(n))) for n in ROCK_NAMES)
    assert total < KENNEY_METEORS_BYTES, total


def test_shipped_rock_files_are_the_generator_output():
    """The committed WebPs decode to exactly what the generator draws (no stale or hand-edited
    file): `rock-large-1-veins` ships as `rock/large-1-veins.webp`."""
    shipped = sorted(p.name for p in SHIPPED_ROCKS.glob("*.webp"))
    assert shipped == sorted(f"{n[5:]}.webp" for n in ROCK_NAMES)
    for n in ROCK_NAMES:
        want = np.asarray(art.decode_webp(art.to_webp(art.render(n))))
        got = np.asarray(Image.open(SHIPPED_ROCKS / f"{n[5:]}.webp").convert("RGBA"))
        assert np.array_equal(want, got), n


@pytest.mark.parametrize("name", ["rock-large-2", "rock-large-1-veins", "rock-small-2"])
def test_rocks_are_deterministic(name, tmp_path):
    assert np.array_equal(np.asarray(art.render(name)), np.asarray(art.render(name)))
    for d in ("a", "b"):
        art.main(tmp_path / d, [name])
    pa = np.asarray(Image.open(tmp_path / "a" / f"starswarm-{name}.webp").convert("RGBA"))
    pb = np.asarray(Image.open(tmp_path / "b" / f"starswarm-{name}.webp").convert("RGBA"))
    assert np.array_equal(pa, pb)


@pytest.mark.parametrize("name", [*LARGE, *SMALL])
def test_rock_bodies_are_neutral_grey_so_the_game_can_tint_them(name):
    a = np.asarray(art.render(name)).astype(int)
    solid = a[..., 3] > 0
    assert (a[..., 0] == a[..., 1])[solid].all() and (a[..., 1] == a[..., 2])[solid].all()
    # the full range the tint maps: a light highlight and the dark edge
    assert a[..., 0][a[..., 3] == 255].max() >= 230
    assert a[..., 0][a[..., 3] == 255].min() <= 20


@pytest.mark.parametrize("name", LARGE)
def test_veins_are_gold_and_stay_on_the_rock(name):
    v = np.asarray(art.render(f"{name}-veins")).astype(int)
    body = np.asarray(art.render(name))[..., 3]
    lines = v[..., 3] > 200
    assert lines.sum() > 100  # the veins are there
    assert (body[lines] > 60).all()  # the solid vein lines sit on the body
    ore = np.array([255, 192, 74])
    assert np.abs(v[lines][:, :3] - ore).max() <= 20  # #ffc04a, not tinted grey


@pytest.mark.parametrize("palette", list(art.ROCK_PALETTES))
def test_the_tint_lands_on_the_approved_dark_stop(palette):
    """colour = edge + L * (light - edge): L = 1 gives the light stop, L = 0 the edge, and
    L = ROCK_L_DARK the approved dark stop within 7 levels (measured: R1 1, R2 7, R3 3)."""
    light, edge = art.ROCK_PALETTES[palette]
    ramp = np.array([[[255, 255, 255, 255], [0, 0, 0, 255]]], np.uint8)
    lum = round(art.ROCK_L_DARK * 255)
    ramp = np.concatenate([ramp, np.array([[[lum, lum, lum, 255]]], np.uint8)], 1)
    out = np.asarray(art.tint_rock(Image.fromarray(ramp, "RGBA"), palette)).astype(int)[0]
    rgb = lambda h: np.rint(np.array(art.hexrgb(h)[:3]) * 255).astype(int)
    assert np.array_equal(out[0, :3], rgb(light))
    assert np.array_equal(out[1, :3], rgb(edge))
    assert np.abs(out[2, :3] - rgb(art.ROCK_DARK_STOPS[palette])).max() <= 7


def test_rock_palettes_mirror_the_runtime_palette():
    """The runtime (frontend render/palette.ts) tints with the same light and edge colours."""
    src = PALETTE_TS.read_text()
    for i, (light, edge) in enumerate(art.ROCK_PALETTES.values(), 1):
        assert f"ROCK_R{i}_LIGHT_RGB = 0x{light[1:]};" in src
        assert f"ROCK_R{i}_EDGE_RGB = 0x{edge[1:]};" in src


# The N2 nebula (frontend render/nebula.ts): blobs as (cx, cy, r) canvas fractions, colour, alpha
NEBULA_BLOBS = [
    (0.78, 0.28, 0.62, (122, 60, 200), 0.22),
    (0.86, 0.2, 0.32, (122, 60, 200), 0.2),
    (0.62, 0.36, 0.26, (122, 60, 200), 0.14),
    (0.22, 0.78, 0.55, (26, 122, 154), 0.26),
    (0.12, 0.72, 0.28, (26, 122, 154), 0.22),
    (0.34, 0.88, 0.24, (26, 122, 154), 0.16),
]


def nebula_peak(w: int = 390, h: int = 844) -> tuple[float, float, float]:
    """The nebula's brightest background colour on a phone-sized canvas (4 px grid)."""
    yy, xx = np.mgrid[0:h:4, 0:w:4].astype(float)
    out = np.zeros((*xx.shape, 3)) + np.array(SPACE, float)
    for cx, cy, r, rgb, alpha in NEBULA_BLOBS:
        d = np.hypot(xx - cx * w, yy - cy * h) / (r * w)
        a = (alpha * np.clip(1 - d, 0, 1))[..., None]
        out = np.array(rgb, float) * a + out * (1 - a)
    lum = _luminance(out.reshape(-1, 3))
    return tuple(out.reshape(-1, 3)[int(np.argmax(lum))])


def rock_contrast(im, bg) -> float:
    """Median WCAG contrast of the rock's solid pixels over `bg`, at game size."""
    g = np.asarray(art._game_size(im)).astype(float)
    a = g[..., 3:4] / 255
    over = g[..., :3] * a + np.array(bg, float) * (1 - a)
    lum = _luminance(over[g[..., 3] >= 128])
    b = _luminance(np.array(bg, float))
    return float(np.median((np.maximum(lum, b) + 0.05) / (np.minimum(lum, b) + 0.05)))


@pytest.mark.parametrize("palette", list(art.ROCK_PALETTES))
def test_every_rock_reads_on_space_and_on_the_nebula(palette):
    """Measured 2026-11-09: 2.7-3.5:1 on #000010 and 1.6-2.1:1 on the nebula's brightest point
    (the teal cloud). Rocks are deliberately duller than the 3:1 hive (a neutral hazard, not a
    target); the floors keep a later palette or crater change from sinking them into the black."""
    cache = _rock_cache()
    peak = nebula_peak()
    for n in art.ROCK_VARIANTS:
        im = art.compose_rock(n, palette, cache)
        assert rock_contrast(im, SPACE) >= 2.5, n
        assert rock_contrast(im, peak) >= 1.4, n


def test_the_rock_contrast_floor_bites(monkeypatch):
    """A rock tinted toward the edge colour would fail the space floor."""
    monkeypatch.setitem(art.ROCK_PALETTES, "R1 basalt", ("#3a322c", "#1e1915"))
    im = art.compose_rock("rock-small-1", "R1 basalt", _rock_cache())
    assert rock_contrast(im, SPACE) < 2.5


# --------------------------------------------------------------------------------------------
# The projectiles (#3594)

SHIPPED_SHOTS = Path(__file__).resolve().parents[3] / "frontend/assets/starswarm/shot"
FRIENDLY = ["shot-player", "shot-buddy"]
DANGER = ["shot-enemy", "shot-flak", "shot-carrier"]
KENNEY_BULLETS_BYTES = 2028  # bullet-player 408 + bullet-enemy 412 + bullet-charge 1,208


def test_shot_boxes_are_the_approved_sizes():
    """Player bolt 5x14 (its hitbox), Buddy 4x10, enemy orb 7, flak 5x8, Carrier orb 8."""
    assert art.SHOT_BOXES == {
        "shot-player": (5, 14),
        "shot-buddy": (4, 10),
        "shot-enemy": (7, 7),
        "shot-flak": (5, 8),
        "shot-carrier": (8, 8),
    }


def test_shipped_shot_files_are_the_generator_output():
    """`shot-player` ships as `shot/player.webp`, decoded pixel for pixel."""
    shipped = sorted(p.name for p in SHIPPED_SHOTS.glob("*.webp"))
    assert shipped == sorted(f"{n[5:]}.webp" for n in SHOT_NAMES)
    for n in SHOT_NAMES:
        want = np.asarray(art.decode_webp(art.to_webp(art.render(n))))
        got = np.asarray(Image.open(SHIPPED_SHOTS / f"{n[5:]}.webp").convert("RGBA"))
        assert np.array_equal(want, got), n


def test_the_shot_set_is_about_the_size_of_the_kenney_bullets():
    """Five sprites for three: within 1 KB of the Kenney bullets they replace."""
    total = sum(len(art.to_webp(art.render(n))) for n in SHOT_NAMES)
    assert total <= KENNEY_BULLETS_BYTES + 1024, total


@pytest.mark.parametrize("name", SHOT_NAMES)
def test_shots_are_deterministic_centred_and_glow_inside_the_padding(name, tmp_path):
    a = art.render(name)
    assert np.array_equal(np.asarray(a), np.asarray(art.render(name)))
    for d in ("a", "b"):
        art.main(tmp_path / d, [name])
    pa = np.asarray(Image.open(tmp_path / "a" / f"starswarm-{name}.webp").convert("RGBA"))
    pb = np.asarray(Image.open(tmp_path / "b" / f"starswarm-{name}.webp").convert("RGBA"))
    assert np.array_equal(pa, pb)
    w, h = a.size
    x0, y0, x1, y1 = _bbox(a)
    assert x0 >= 1 and y0 >= 1 and x1 <= w - 1 and y1 <= h - 1
    assert abs((x0 + x1) / 2 - w / 2) <= 1  # the game centres the sprite on the shot
    alpha = np.asarray(a)[..., 3].astype(int)
    # symmetric (it turns about its centre); odd boxes differ by sub-pixel rounding
    assert np.abs(alpha - alpha[:, ::-1]).mean() <= 2.0
    # the glow reaches past the box into the padding (a halo, not a hard edge)
    p = art.SHOT_PAD
    assert alpha[: p - 1].max() > 0 or alpha[:, : p - 1].max() > 0


def _hue(name) -> float:
    """The hue (degrees) of the shot's bright solid pixels, at game size."""
    g = np.asarray(art._game_size(art.decode_webp(art.to_webp(art.render(name))))).astype(float)
    rgb = g[g[..., 3] >= 128][:, :3] / 255
    mx, mn = rgb.max(1), rgb.min(1)
    sat = mx - mn > 0.25  # skip the white-hot cores
    r, gg, b = rgb[sat].T
    hue = np.degrees(np.arctan2(np.sqrt(3) * (gg - b), 2 * r - gg - b)) % 360
    return float(np.degrees(np.angle(np.exp(1j * np.radians(hue)).mean())) % 360)


def _hue_gap(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


@pytest.mark.parametrize("name", SHOT_NAMES)
def test_every_shot_reads_on_space(name):
    """Projectiles are the most important thing to see: at least 3:1 at game size on #000010."""
    assert median_contrast(art.decode_webp(art.to_webp(art.render(name)))) >= 3.0


@pytest.mark.parametrize("danger", DANGER)
@pytest.mark.parametrize("friendly", FRIENDLY)
def test_danger_and_friendly_fire_have_distinct_hues(danger, friendly):
    """Danger is warm (red, orange, amber, pink) and friendly fire cool (cyan, mint): at least
    90 degrees of hue apart at game size."""
    assert _hue_gap(_hue(danger), _hue(friendly)) >= 90


def test_danger_is_warm_and_friendly_is_cool():
    for n in DANGER:
        assert _hue_gap(_hue(n), 20) <= 45, n  # around red-orange
    for n in FRIENDLY:
        assert 120 <= _hue(n) <= 200, n  # green to cyan


def test_buddy_and_player_bolts_differ_in_hue_and_size():
    """Buddy's bolt is clearly friendly yet not the player's: mint vs cyan, and shorter."""
    assert _hue_gap(_hue("shot-buddy"), _hue("shot-player")) >= 15
    assert art.SHOT_BOXES["shot-buddy"][1] < art.SHOT_BOXES["shot-player"][1]


def test_the_carrier_orb_is_pinker_than_the_enemy_orb():
    assert _hue_gap(_hue("shot-carrier"), _hue("shot-enemy")) >= 15


def test_the_hue_guard_bites(monkeypatch):
    """A danger orb drawn in the player's cyan would fail the hue gap."""
    monkeypatch.setitem(
        art.SHOT_RECIPES,
        "shot-enemy",
        lambda: art.shot_orb("shot-enemy", art.CYAN, art.CYAN),
    )
    monkeypatch.setitem(art.RECIPES, "shot-enemy", art.SHOT_RECIPES["shot-enemy"])
    assert _hue_gap(_hue("shot-enemy"), _hue("shot-player")) < 90


def test_premultiplied_blur_keeps_the_halo_colour():
    """A blurred red dot's halo stays red (no dark fringe from clear pixels' black)."""
    px = np.zeros((21, 21, 4), np.float32)
    px[10, 10] = (1, 0, 0, 1)
    out = art.blur_premul(px, 2.0)
    halo = out[10, 14]
    assert halo[3] > 0 and np.isclose(halo[0], halo[3]) and halo[1] == 0 == halo[2]
    assert np.isclose(out[..., 3].sum(), 1.0, atol=1e-3)


SHOT_PALETTE = {
    "SHOT_PLAYER_RGB": "#00e8d0",
    "SHOT_BUDDY_RGB": "#5dffa8",
    "SHOT_ENEMY_RGB": "#ff3a1a",
    "SHOT_FLAK_RGB": "#ffc04a",
    "SHOT_CARRIER_RGB": "#e0204a",
}


def test_shot_fallback_colours_mirror_the_runtime_palette():
    """The loading fallbacks (frontend render/palette.ts) use each sprite's body colour."""
    src = PALETTE_TS.read_text()
    gen = {
        "SHOT_PLAYER_RGB": art.CYAN,
        "SHOT_BUDDY_RGB": art.BUDDY_MINT,
        "SHOT_ENEMY_RGB": art.ORB_OUTER,
        "SHOT_FLAK_RGB": art.FLAK,
        "SHOT_CARRIER_RGB": art.CARRIER_OUTER,
    }
    for name, hexv in SHOT_PALETTE.items():
        assert art.hexrgb(hexv) == gen[name], name
        assert f"export const {name} = 0x{hexv[1:]};" in src, name


# --------------------------------------------------------------------------------------------
# The pickups (#3595, owner pick "C-hex")

SHIPPED_PICKUPS = Path(__file__).resolve().parents[3] / "frontend/assets/starswarm/pickup"
TUNING_TS = Path(__file__).resolve().parents[3] / "frontend/src/game/starswarm/engine/tuning.ts"
POWERUPS = ["pickup-shield", "pickup-lightning", "pickup-buddy", "pickup-bomb"]
KENNEY_POWERUPS_BYTES = 2755  # shield_gold 795 + bolt_gold 559 + player-life 771 + missiles 630
PICKUP_SET_BUDGET = 10800  # all six (measured 8,664 B); the overrun is owner-accepted


PICKUPS_TS = Path(__file__).resolve().parents[3] / "frontend/src/game/starswarm/render/pickups.ts"


def test_the_pickup_boxes_match_the_game():
    """The crate and plate are drawn in the 24 px POWERUP_W x POWERUP_H box (frontend
    engine/tuning.ts, the hitbox); the tokens in the renderer's larger PICKUP_TOKEN_SIZE (30 px,
    draw size only, owner audition)."""
    src = TUNING_TS.read_text()
    assert f"export const POWERUP_W = {art.PICKUP_BOX};" in src
    assert f"export const POWERUP_H = {art.PICKUP_BOX};" in src
    assert f"export const PICKUP_TOKEN_SIZE = {art.PICKUP_TOKEN_BOX};" in PICKUPS_TS.read_text()
    assert art.PICKUP_TOKEN_BOX == 30 and art.PICKUP_TOKEN_BOX / art.PICKUP_BOX == 1.25
    assert art.PICKUP_PAD == 2 * art.SCALE  # the renderer's PICKUP_PAD (2 game px)


def test_shipped_pickup_files_are_the_generator_output():
    """`pickup-shield` ships as `pickup/shield.webp`, decoded pixel for pixel."""
    shipped = sorted(p.name for p in SHIPPED_PICKUPS.glob("*"))
    assert shipped == sorted(f"{n[7:]}.webp" for n in PICKUP_NAMES)
    for n in PICKUP_NAMES:
        want = np.asarray(art.decode_webp(art.to_webp(art.render(n))))
        got = np.asarray(Image.open(SHIPPED_PICKUPS / f"{n[7:]}.webp").convert("RGBA"))
        assert np.array_equal(want, got), n


def test_the_pickup_set_stays_within_its_budget():
    """Six sprites (two of them new: the crate and plate were code-drawn) for four Kenney PNGs."""
    total = sum(len(art.to_webp(art.render(n))) for n in PICKUP_NAMES)
    assert total <= PICKUP_SET_BUDGET, total
    assert total > KENNEY_POWERUPS_BYTES  # documented: the set costs more than the Kenney PNGs


@pytest.mark.parametrize("name", PICKUP_NAMES)
def test_pickups_are_deterministic_centred_and_glow_inside_the_padding(name, tmp_path):
    a = art.render(name)
    assert np.array_equal(np.asarray(a), np.asarray(art.render(name)))
    for d in ("a", "b"):
        art.main(tmp_path / d, [name])
    pa = np.asarray(Image.open(tmp_path / "a" / f"starswarm-{name}.webp").convert("RGBA"))
    pb = np.asarray(Image.open(tmp_path / "b" / f"starswarm-{name}.webp").convert("RGBA"))
    assert np.array_equal(pa, pb)
    w, h = a.size
    x0, y0, x1, y1 = _bbox(a)
    assert x0 >= 1 and y0 >= 1 and x1 <= w - 1 and y1 <= h - 1
    assert abs((x0 + x1) / 2 - w / 2) <= 1  # the game centres the sprite on the pickup
    assert abs((y0 + y1) / 2 - h / 2) <= 2
    alpha = np.asarray(a)[..., 3].astype(int)
    # the baked glow: a soft fringe round the solid art, not a hard edge
    assert ((alpha > 0) & (alpha < 64)).sum() >= 100


@pytest.mark.parametrize("name", PICKUP_NAMES)
def test_every_pickup_reads_on_space(name):
    """At least 3:1 at game size on #000010, the same floor as the shots and the hive."""
    assert median_contrast(art.decode_webp(art.to_webp(art.render(name)))) >= 3.0


def _silhouette(name) -> np.ndarray:
    im = art.decode_webp(art.to_webp(art.render(name)))
    return np.asarray(art._game_size(im))[..., 3] >= 128


def _centred(m: np.ndarray, h: int, w: int) -> np.ndarray:
    """`m` centred on an h x w canvas, as the game centres every pickup on its position."""
    out = np.zeros((h, w), bool)
    y, x = (h - m.shape[0]) // 2, (w - m.shape[1]) // 2
    out[y : y + m.shape[0], x : x + m.shape[1]] = m
    return out


def _iou(a: str, b: str) -> float:
    """Silhouette overlap as drawn: both centred on one spot (the tokens' box is larger)."""
    ma, mb = _silhouette(a), _silhouette(b)
    h, w = max(ma.shape[0], mb.shape[0]), max(ma.shape[1], mb.shape[1])
    ma, mb = _centred(ma, h, w), _centred(mb, h, w)
    return float((ma & mb).sum() / (ma | mb).sum())


@pytest.mark.parametrize("a", PICKUP_NAMES)
@pytest.mark.parametrize("b", PICKUP_NAMES)
def test_every_two_pickups_differ_in_hue_or_shape(a, b):
    """Told apart at a glance: at least 30 degrees of hue apart at game size, or a clearly
    different silhouette (intersection over union at most 0.9)."""
    if a >= b:
        return
    assert _hue_gap(_hue(a), _hue(b)) >= 30 or _iou(a, b) <= 0.9, (a, b)


@pytest.mark.parametrize("a", POWERUPS)
@pytest.mark.parametrize("b", POWERUPS)
def test_the_four_power_up_tokens_share_a_shape_and_differ_in_hue(a, b):
    """The hex tokens are one family (same silhouette), so their faces carry the difference."""
    if a >= b:
        return
    assert _iou(a, b) >= 0.95
    assert _hue_gap(_hue(a), _hue(b)) >= 30, (a, b)


def _rim_saturation(name) -> float:
    """Median saturation (max - min channel) of the sprite's outer edge pixels, at 3x."""
    a = np.asarray(art.decode_webp(art.to_webp(art.render(name)))).astype(float)
    solid = a[..., 3] >= 128
    inner = solid.copy()
    for shift in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        inner &= np.roll(solid, shift, (0, 1))
    rgb = a[solid & ~inner][:, :3] / 255
    return float(np.median(rgb.max(1) - rgb.min(1)))


def test_the_bomb_cannot_be_mistaken_for_an_enemy_orb():
    """The Bomb token is orange like enemy fire, so shape and size carry the difference: a
    silver-rimmed hexagon (a near-neutral edge) several times the orb's area, against a small
    round orb with a hot, saturated rim."""
    assert _hue_gap(_hue("pickup-bomb"), _hue("shot-enemy")) < 30  # why this test exists
    assert _rim_saturation("pickup-bomb") <= 0.2
    assert _rim_saturation("shot-enemy") >= 0.6
    assert _silhouette("pickup-bomb").sum() >= 4 * _silhouette("shot-enemy").sum()
    # a hexagon with points left and right is wider than tall; an orb is round
    ys, xs = np.nonzero(_silhouette("pickup-bomb"))
    assert (ys.max() + 1 - ys.min()) <= 0.92 * (xs.max() + 1 - xs.min())


def test_the_bomb_rim_guard_bites(monkeypatch):
    """A Bomb token with its silver bevel in the face colour would fail the rim test."""
    face = art.PICKUP_FACE["bomb"]
    monkeypatch.setattr(art, "SILVER", [(0, face), (1, face)])
    assert _rim_saturation("pickup-bomb") > 0.2


def test_pickups_read_as_rewards_not_danger():
    """Every reward but the Bomb sits away from the danger red-orange; the Bomb is kept apart
    by its shape (above)."""
    for n in PICKUP_NAMES:
        if n != "pickup-bomb":
            assert _hue_gap(_hue(n), _hue("shot-enemy")) >= 20, n


PICKUP_PALETTE = {
    "PICKUP_SHIELD_RGB": "#29c6ff",
    "PICKUP_LIGHTNING_RGB": "#ffe23a",
    "PICKUP_BUDDY_RGB": "#5dffa8",
    "PICKUP_BOMB_RGB": "#ff6a2a",
}


def test_pickup_fallback_colours_mirror_the_runtime_palette():
    """The loading fallbacks (frontend render/palette.ts) use each sprite's colours."""
    src = PALETTE_TS.read_text()
    for name, hexv in PICKUP_PALETTE.items():
        kind = name.split("_")[1].lower()
        assert art.hexrgb(hexv) == art.PICKUP_FACE[kind], name
        assert f"export const {name} = 0x{hexv[1:]};" in src, name

    def packed(rgba) -> str:
        return "0xff" + "".join(f"{round(c * 255):02x}" for c in rgba[:3])

    assert f"PICKUP_BEVEL: PackedColor = {packed(art.SILVER[2][1])};" in src
    assert f"SALVAGE_BAND: PackedColor = {packed(art.CRATE_BAND)};" in src
    assert f"SALVAGE_EDGE: PackedColor = {packed(art.CRATE_EDGE)};" in src
    assert f"HULL_PLATE: PackedColor = {packed(art.ARMOR[1][1])};" in src


# --------------------------------------------------------------------------------------------
# #3708: the bolder Wasp Grunt (owner decision, option A) and the hive's wings

REPO = Path(__file__).resolve().parents[3]
SHIPPED_ENEMIES = REPO / "frontend/assets/starswarm/enemy"
SHIPPED_ENEMY_FILES = {  # recipe -> shipped file
    "grunt-wasp": "grunt.webp",
    "elite-mantis": "elite.webp",
    "elite-mantis-attack": "elite-attack.webp",
    "elite-mantis-hurt": "elite-hurt.webp",
    "guardian-scarab": "guardian.webp",
    "guardian-scarab-plate": "guardian-plate.webp",
    "guardian-scarab-cracks": "guardian-cracks.webp",
    "guardian-scarab-plate2": "guardian-plate2.webp",
    "carrier-queen": "carrier.webp",
    "carrier-queen-cracks": "carrier-cracks.webp",
}
# The pre-#3708 Grunt, to measure the change against
OLD_GRUNT = {
    "GRUNT_WING_RIM": 0.4,
    "GRUNT_SEGMENT_RIM": 0.45,
    "GRUNT_WING_ALPHA": 0.35,
    "GRUNT_WING": [(0.08, 0.3), (0.46, 0.14), (0.42, 0.34), (0.1, 0.44)],
    "GRUNT_SEGMENTS": ((0.26, 0.13), (0.48, 0.15), (0.68, 0.11)),
    "GRUNT_SEGMENT_SQUASH": 0.85,
    "GRUNT_STINGER": [(0.45, 0.76), (0.55, 0.76), (0.5, 0.98)],
}


def test_the_bolder_wasp_parameters_are_the_approved_ones():
    assert art.GRUNT_WING_RIM == 0.8
    assert art.GRUNT_SEGMENT_RIM == 0.7
    assert art.GRUNT_WING_ALPHA == 0.6
    assert art.HIVE_WING_RIM == 0.6
    assert art.HIVE_WING_ALPHA == 0.45
    # the segments touch: each one reaches the next one's top edge
    sq = art.GRUNT_SEGMENT_SQUASH
    for (y0, r0), (y1, r1) in itertools.pairwise(art.GRUNT_SEGMENTS):
        assert y0 + r0 * sq >= y1 - r1 * sq

    def width(tri):
        return max(x for x, _ in tri) - min(x for x, _ in tri)

    assert width(art.GRUNT_STINGER) > width(OLD_GRUNT["GRUNT_STINGER"])


def _violet_peak(w: int = 390, h: int = 844) -> np.ndarray:
    """The violet cloud's brightest colour (the nebula's violet blobs only), where grunts blurred."""
    yy, xx = np.mgrid[0:h:4, 0:w:4].astype(float)
    out = np.zeros((*xx.shape, 3)) + np.array(SPACE, float)
    for cx, cy, r, rgb, alpha in NEBULA_BLOBS[:3]:
        d = np.hypot(xx - cx * w, yy - cy * h) / (r * w)
        a = (alpha * np.clip(1 - d, 0, 1))[..., None]
        out = np.array(rgb, float) * a + out * (1 - a)
    flat = out.reshape(-1, 3)
    return flat[int(np.argmax(_luminance(flat)))]


def _light_mass_and_area(im) -> tuple[float, float]:
    """(luminance added over the violet peak, opaque area), both in game px^2 (3x / 9)."""
    s = np.asarray(im).astype(float)
    a = s[..., 3:4] / 255
    bg = _violet_peak()
    over = s[..., :3] * a + bg * (1 - a)
    light = np.clip(_luminance(over.reshape(-1, 3)) - _luminance(bg), 0, None).sum() / 9
    return float(light), float((s[..., 3] >= 128).sum() / 9)


def test_the_bolder_wasp_carries_more_light_and_more_body_than_before(monkeypatch):
    """Design pass (#3708): light mass on the violet cloud 25 -> 38.8 and opaque area 116 -> 198
    gpx^2. The floors keep a later tweak from thinning the Grunt back into the cloud."""
    new_light, new_area = _light_mass_and_area(art.decode_webp(art.to_webp(art.grunt_wasp())))
    for k, v in OLD_GRUNT.items():
        monkeypatch.setattr(art, k, v)
    old_light, old_area = _light_mass_and_area(art.decode_webp(art.to_webp(art.grunt_wasp())))
    assert new_light >= 1.4 * old_light, (old_light, new_light)
    assert new_area >= 1.5 * old_area, (old_area, new_area)


def test_the_hive_wings_are_more_solid_on_the_elite_and_the_carrier(monkeypatch):
    new = {n: art.render(n) for n in ("elite-mantis", "carrier-queen")}
    monkeypatch.setattr(art, "HIVE_WING_RIM", 0.4)
    monkeypatch.setattr(art, "HIVE_WING_ALPHA", 0.3)
    for n, im in new.items():
        old_light, old_area = _light_mass_and_area(art.render(n))
        new_light, new_area = _light_mass_and_area(im)
        assert new_light > old_light and new_area > old_area, n


def test_the_guardian_has_no_wings_so_it_does_not_change(monkeypatch):
    before = np.asarray(art.render("guardian-scarab"))
    monkeypatch.setattr(art, "HIVE_WING_RIM", 0.4)
    monkeypatch.setattr(art, "HIVE_WING_ALPHA", 0.3)
    assert np.array_equal(before, np.asarray(art.render("guardian-scarab")))


def test_shipped_enemy_files_are_the_generator_output():
    """`grunt-wasp` ships as `enemy/grunt.webp`, decoded pixel for pixel (Pillow 13, as in CI)."""
    assert sorted(p.name for p in SHIPPED_ENEMIES.glob("*.webp")) == sorted(
        SHIPPED_ENEMY_FILES.values()
    )
    assert set(SHIPPED_ENEMY_FILES) == set(ENEMY_NAMES)
    for n, f in SHIPPED_ENEMY_FILES.items():
        want = np.asarray(art.decode_webp(art.to_webp(art.render(n))))
        got = np.asarray(Image.open(SHIPPED_ENEMIES / f).convert("RGBA"))
        assert np.array_equal(want, got), n


def test_the_enemy_set_shrinks_with_the_bolder_wasp():
    """#3708 measured -136 B net under Pillow 13 (grunt +96, Elite -20/-64/-76, Carrier -82,
    Carrier cracks +10), then +8 B re-encoding the Guardian under Pillow 13: 20,338 -> 20,210 B.
    The cap keeps the set under its pre-#3708 size."""
    total = sum((SHIPPED_ENEMIES / f).stat().st_size for f in SHIPPED_ENEMY_FILES.values())
    assert total < 20_338, total


# --------------------------------------------------------------------------------------------
# #3599: the home tile icon (owner pick I3, the Wasp Grunt in a hex badge)

SHIPPED_TILE = REPO / "frontend/assets/home/starswarm-tile.webp"


def test_the_badge_geometry_is_the_approved_one():
    assert art.TILE_ICON_SIZE == 168
    assert (art.TILE_BEVEL_R, art.TILE_FACE_R, art.TILE_GRUNT) == (80, 66, 104)
    assert [c for _, c in art.TILE_FACE] == [art.hexrgb("#3a1f5c"), art.hexrgb("#120826")]
    im = np.asarray(art.render("home-tile-badge")).astype(int)
    mid = art.TILE_ICON_SIZE // 2
    # hex vertices at k x 60 degrees: points left and right, flat top and bottom
    assert im[mid, mid + 74, 3] == 255 and im[mid, mid + 83, 3] == 0  # vertex at r 80
    assert im[mid - 67, mid, 3] == 255 and im[mid - 73, mid, 3] == 0  # flat top at 80 sin 60
    for corner in (im[0, 0], im[0, -1], im[-1, 0], im[-1, -1]):
        assert corner[3] == 0
    bevel = im[mid, mid + 72]  # between the face (r 66) and the bevel's edge (r 80): silver
    face = im[mid, 34]  # inside the face, left of the Grunt's canvas
    assert bevel[:3].min() >= 110 and abs(int(bevel[0]) - int(bevel[2])) <= 30  # light grey
    t = (mid + 0.5) / art.TILE_ICON_SIZE  # the face's vertical gradient at mid height
    top, bottom = np.array([0x3A, 0x1F, 0x5C]), np.array([0x12, 0x08, 0x26])
    assert np.abs(face[:3] - (top + (bottom - top) * t)).max() <= 2
    assert face[3] == 255


def test_the_badge_is_deterministic(tmp_path):
    assert np.array_equal(
        np.asarray(art.render("home-tile-badge")), np.asarray(art.render("home-tile-badge"))
    )
    for d in ("a", "b"):
        art.main(tmp_path / d, ["home-tile-badge"])
    a, b = ((tmp_path / d / "starswarm-home-tile-badge.webp").read_bytes() for d in ("a", "b"))
    assert a == b


def test_the_badge_embeds_the_grunt_recipe(monkeypatch):
    """The badge is built from `grunt_wasp`, so a Grunt change re-renders the tile with it."""
    mid = art.TILE_ICON_SIZE // 2
    real = np.asarray(art.render("home-tile-badge")).astype(int)
    grunt = np.asarray(
        art.grunt_wasp().resize((art.TILE_GRUNT,) * 2, Image.LANCZOS)
    )  # the Grunt as placed
    off = (art.TILE_ICON_SIZE - art.TILE_GRUNT) // 2
    solid = grunt[..., 3] == 255
    region = real[off : off + art.TILE_GRUNT, off : off + art.TILE_GRUNT]
    assert solid.sum() > 500
    assert np.array_equal(region[solid], grunt[solid].astype(int))
    red = art.Image.new("RGBA", art.grunt_wasp().size, (255, 0, 0, 255))
    monkeypatch.setattr(art, "grunt_wasp", lambda: red)
    swapped = np.asarray(art.render("home-tile-badge"))
    assert tuple(swapped[mid, mid]) == (255, 0, 0, 255)


def test_the_shipped_tile_icon_is_the_generator_output():
    want = np.asarray(art.decode_webp(art.to_webp(art.render("home-tile-badge"))))
    got = np.asarray(Image.open(SHIPPED_TILE).convert("RGBA"))
    assert np.array_equal(want, got)
    assert SHIPPED_TILE.stat().st_size <= BUDGET_TILE_BADGE


def test_the_badge_is_left_off_the_sprite_contact_sheet():
    assert "home-tile-badge" in art.RECIPES
    assert set(art.ICON_RECIPES) == {"home-tile-badge"}
