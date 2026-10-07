"""
pytest suite for convert_icons_to_webp.py

Tests conversion logic on synthetic temporary directories without touching
real assets. Follows the same pattern as remove_backgrounds_test.py.
"""

import sys
from io import BytesIO
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from convert_icons_to_webp import convert_directory  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_png(path: Path, size: tuple[int, int] = (4, 4)) -> None:
    """Write a minimal valid RGBA PNG to path."""
    try:
        from PIL import Image
    except ImportError:
        pytest.skip("Pillow not installed")
    img = Image.new("RGBA", size, (255, 0, 0, 255))
    img.save(path, "PNG")


# ---------------------------------------------------------------------------
# Baked-directory guard
# ---------------------------------------------------------------------------


class TestBakedGuard:
    def test_refuses_baked_suffix(self, tmp_path):
        baked_dir = tmp_path / "fruits-baked"
        baked_dir.mkdir()
        with pytest.raises(SystemExit) as exc_info:
            convert_directory(baked_dir)
        assert exc_info.value.code != 0

    def test_refuses_any_baked_suffix(self, tmp_path):
        cosmos_baked = tmp_path / "cosmos-baked"
        cosmos_baked.mkdir()
        with pytest.raises(SystemExit):
            convert_directory(cosmos_baked)

    def test_non_baked_dir_is_accepted(self, tmp_path):
        fruit_dir = tmp_path / "fruit-icons"
        fruit_dir.mkdir()
        # No PNGs — should just print "No *.png files found" and return.
        convert_directory(fruit_dir)  # must not raise


# ---------------------------------------------------------------------------
# Missing / non-directory path
# ---------------------------------------------------------------------------


class TestInvalidPath:
    def test_exits_if_not_a_directory(self, tmp_path):
        fake = tmp_path / "not-a-dir"
        with pytest.raises(SystemExit) as exc_info:
            convert_directory(fake)
        assert exc_info.value.code != 0


# ---------------------------------------------------------------------------
# Conversion
# ---------------------------------------------------------------------------


class TestConversion:
    def test_converts_png_to_webp(self, tmp_path):
        _make_png(tmp_path / "apple.png")
        assert (tmp_path / "apple.png").exists()

        convert_directory(tmp_path)

        assert (tmp_path / "apple.webp").exists()
        assert not (tmp_path / "apple.png").exists()

    def test_converts_multiple_pngs(self, tmp_path):
        for name in ("a.png", "b.png", "c.png"):
            _make_png(tmp_path / name)

        convert_directory(tmp_path)

        for name in ("a.webp", "b.webp", "c.webp"):
            assert (tmp_path / name).exists()
        assert not any(tmp_path.glob("*.png"))

    def test_output_is_valid_webp(self, tmp_path):
        try:
            from PIL import Image
        except ImportError:
            pytest.skip("Pillow not installed")

        _make_png(tmp_path / "icon.png")
        convert_directory(tmp_path)

        webp = tmp_path / "icon.webp"
        with Image.open(webp) as img:
            assert img.format == "WEBP"

    def test_no_pngs_is_a_noop(self, tmp_path):
        convert_directory(tmp_path)
        assert not any(tmp_path.glob("*.webp"))

    def test_ignores_non_png_files(self, tmp_path):
        (tmp_path / "readme.txt").write_text("hello")
        convert_directory(tmp_path)
        assert (tmp_path / "readme.txt").exists()
        assert not any(tmp_path.glob("*.webp"))
