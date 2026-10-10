"""
pytest suite for make_icon_thumbnails.py (#2833).

Runs on synthetic temporary directories without touching real assets.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from make_icon_thumbnails import make_directory, make_thumbnail

Image = pytest.importorskip("PIL.Image")


def _make_icon(path: Path, size: tuple[int, int]) -> None:
    """Opaque red disc on a transparent background."""
    from PIL import ImageDraw

    img = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((0, 0, size[0] - 1, size[1] - 1), fill=(255, 0, 0, 255))
    img.save(path)


def test_downscales_to_max_size_and_keeps_alpha(tmp_path):
    src = tmp_path / "big.png"
    _make_icon(src, (1024, 1024))
    dst = tmp_path / "out" / "big.webp"
    assert make_thumbnail(src, dst, max_size=256) == (256, 256)
    with Image.open(dst) as out:
        assert out.format == "WEBP"
        assert out.mode == "RGBA"
        assert out.size == (256, 256)
        assert out.getpixel((0, 0))[3] < 200  # transparent corner survives
        assert out.getpixel((128, 128))[3] > 250  # opaque centre survives


def test_keeps_aspect_ratio(tmp_path):
    src = tmp_path / "wide.png"
    _make_icon(src, (2816, 1536))
    assert make_thumbnail(src, tmp_path / "wide.webp", max_size=256) == (256, 140)


def test_never_upscales(tmp_path):
    src = tmp_path / "small.png"
    _make_icon(src, (100, 80))
    assert make_thumbnail(src, tmp_path / "small.webp", max_size=256) == (100, 80)


def test_directory_writes_webp_per_source(tmp_path):
    src_dir = tmp_path / "masters"
    src_dir.mkdir()
    _make_icon(src_dir / "a.png", (512, 512))
    _make_icon(src_dir / "b.webp", (512, 512))
    (src_dir / "notes.txt").write_text("ignored")
    dst_dir = tmp_path / "fruit-icons"
    assert make_directory(src_dir, dst_dir, max_size=64) == 2
    assert sorted(p.name for p in dst_dir.iterdir()) == ["a.webp", "b.webp"]


def test_png_master_wins_over_webp_with_same_stem(tmp_path):
    src_dir = tmp_path / "masters"
    src_dir.mkdir()
    _make_icon(src_dir / "apple.png", (512, 256))  # fresh remove_backgrounds.py output
    _make_icon(src_dir / "apple.webp", (256, 256))  # stale conversion
    dst_dir = tmp_path / "fruit-icons"
    assert make_directory(src_dir, dst_dir, max_size=64) == 1
    with Image.open(dst_dir / "apple.webp") as out:
        assert out.size == (64, 32)


def test_refuses_baked_output_dir(tmp_path):
    src_dir = tmp_path / "masters"
    src_dir.mkdir()
    with pytest.raises(SystemExit):
        make_directory(src_dir, tmp_path / "fruits-baked")
