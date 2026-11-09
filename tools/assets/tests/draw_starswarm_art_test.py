"""
pytest suite for draw_starswarm_art.py (#3591).

Renders the real recipes (they are small), but writes only into tmp_path.
"""

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
BUDGET_GRUNT = 2000
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
    if name == "grunt-wasp":
        return BUDGET_GRUNT
    if name == "buddy-escort":
        return BUDGET_BUDDY
    if name in BUDGET_ENEMY:
        return BUDGET_ENEMY[name]
    if name in BUDGET_ROCK:
        return BUDGET_ROCK[name]
    return BUDGET_BASE if name.endswith("-base") else BUDGET_LAYER


def _size(name: str) -> tuple[int, int]:
    if name == "buddy-escort":
        return BUDDY_SIZE
    if name in ENEMY_NAMES:
        return ENEMY_SIZE[_tier(name)]
    if name in ROCK_NAMES:
        return ROCK_SIZE[name.split("-")[1]]
    return PLAYER_SIZE


def test_registry_has_five_layers_per_ship_the_hive_buddy_and_the_rocks():
    expected = {f"{s}-{layer}" for s in SHIP_NAMES for layer in art.LAYERS}
    assert set(art.RECIPES) == expected | set(ENEMY_NAMES) | {"buddy-escort"} | set(ROCK_NAMES)


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
    """The guard bites: the pre-#3593 shell stops make the Grunt too dark to pass."""
    old = [(0, art.hexrgb("#7a4aa0")), (0.5, art.hexrgb("#4b2470")), (1, art.hexrgb("#1f0d33"))]
    monkeypatch.setattr(art, "CARAPACE", old)
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
    rows_before = 2 * -(-len(art.RECIPES) // 9) + 2 * len(SHIP_NAMES)
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
    L = ROCK_L_DARK the approved dark stop within a few levels."""
    light, edge = art.ROCK_PALETTES[palette]
    ramp = np.array([[[255, 255, 255, 255], [0, 0, 0, 255]]], np.uint8)
    lum = round(art.ROCK_L_DARK * 255)
    ramp = np.concatenate([ramp, np.array([[[lum, lum, lum, 255]]], np.uint8)], 1)
    out = np.asarray(art.tint_rock(Image.fromarray(ramp, "RGBA"), palette)).astype(int)[0]
    rgb = lambda h: np.rint(np.array(art.hexrgb(h)[:3]) * 255).astype(int)
    assert np.array_equal(out[0, :3], rgb(light))
    assert np.array_equal(out[1, :3], rgb(edge))
    assert np.abs(out[2, :3] - rgb(art.ROCK_DARK_STOPS[palette])).max() <= 12


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
