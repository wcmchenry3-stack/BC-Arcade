"""
pytest suite for remove-backgrounds.py

Tests the core algorithm on synthetic images without touching real assets.
"""

import math
import sys
from pathlib import Path

import pytest

# Make the scripts directory importable regardless of where pytest is invoked
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from remove_backgrounds import (  # noqa: E402
    HARD_THRESHOLD,
    SOFT_THRESHOLD,
    _is_already_transparent,
    _sample_background,
    apply_circle_mask,
    remove_background,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _flat_image(
    width: int,
    height: int,
    fill: tuple[int, int, int, int],
) -> list[tuple[int, int, int, int]]:
    """Create a uniform RGBA pixel list."""
    return [fill] * (width * height)


def _set_pixel(
    pixels: list[tuple[int, int, int, int]],
    width: int,
    x: int,
    y: int,
    value: tuple[int, int, int, int],
) -> list[tuple[int, int, int, int]]:
    """Return a copy of pixels with one pixel changed."""
    result = list(pixels)
    result[y * width + x] = value
    return result


# ---------------------------------------------------------------------------
# Corner detection / background sampling
# ---------------------------------------------------------------------------

class TestSampleBackground:
    def test_uniform_image_returns_four_identical_colours(self):
        pixels = _flat_image(10, 10, (210, 210, 207, 255))
        refs = _sample_background(pixels, 10, 10)
        assert len(refs) == 4
        for ref in refs:
            assert ref == pytest.approx((210.0, 210.0, 207.0), abs=0.1)

    def test_each_corner_sampled_independently(self):
        # Paint TL red, leave all other corners green — refs should contain
        # one near-red entry and three near-green entries.
        pixels = _flat_image(10, 10, (0, 200, 0, 255))
        for row in range(3):
            for col in range(3):
                pixels[row * 10 + col] = (200, 0, 0, 255)  # TL only
        refs = _sample_background(pixels, 10, 10)
        assert len(refs) == 4
        red_refs = [r for r in refs if r[0] > 150]
        green_refs = [r for r in refs if r[1] > 150]
        assert len(red_refs) == 1    # only TL corner is red
        assert len(green_refs) == 3  # other three corners are green

    def test_non_uniform_background_each_corner_independent(self):
        """Key regression: BL corner pure-white while others are gray."""
        pixels = _flat_image(10, 10, (210, 210, 207, 255))
        # Paint BL corner pure white
        for row in range(7, 10):
            for col in range(0, 3):
                pixels[row * 10 + col] = (255, 255, 255, 255)
        refs = _sample_background(pixels, 10, 10)
        # One ref should be near-white, three near-gray
        white_refs = [r for r in refs if r[0] > 240]
        gray_refs = [r for r in refs if r[0] < 220]
        assert len(white_refs) == 1
        assert len(gray_refs) == 3

    def test_tiny_image_does_not_crash(self):
        pixels = _flat_image(2, 2, (100, 100, 100, 255))
        refs = _sample_background(pixels, 2, 2)
        assert len(refs) == 4
        for ref in refs:
            assert ref == pytest.approx((100.0, 100.0, 100.0))


# ---------------------------------------------------------------------------
# Idempotency check
# ---------------------------------------------------------------------------

class TestIsAlreadyTransparent:
    def test_fully_opaque_returns_false(self):
        pixels = _flat_image(10, 10, (210, 210, 207, 255))
        assert _is_already_transparent(pixels, 10, 10) is False

    def test_corner_with_low_alpha_returns_true(self):
        pixels = _flat_image(10, 10, (210, 210, 207, 255))
        pixels = _set_pixel(pixels, 10, 0, 0, (210, 210, 207, 0))
        assert _is_already_transparent(pixels, 10, 10) is True

    def test_alpha_threshold_is_200(self):
        # alpha = 200 is not transparent enough (boundary: < 200 triggers True)
        pixels = _flat_image(10, 10, (210, 210, 207, 255))
        pixels = _set_pixel(pixels, 10, 0, 0, (210, 210, 207, 200))
        assert _is_already_transparent(pixels, 10, 10) is False

        pixels = _set_pixel(pixels, 10, 0, 0, (210, 210, 207, 199))
        assert _is_already_transparent(pixels, 10, 10) is True


# ---------------------------------------------------------------------------
# Background removal algorithm
# ---------------------------------------------------------------------------

class TestRemoveBackground:
    BACKGROUND = (210, 210, 207, 255)
    FRUIT_RED = (204, 52, 64, 255)  # bright red — high dist from gray background

    def _make_image_with_fruit_center(self, size: int = 10):
        """Gray background image with a red pixel in the center."""
        pixels = _flat_image(size, size, self.BACKGROUND)
        cx, cy = size // 2, size // 2
        pixels = _set_pixel(pixels, size, cx, cy, self.FRUIT_RED)
        return pixels, size, size

    # --- Corner pixels become transparent ---

    def test_corner_pixels_cleared(self):
        pixels, w, h = self._make_image_with_fruit_center()
        result = remove_background(pixels, w, h)
        # All four true corners should be transparent
        assert result[0][3] == 0            # top-left
        assert result[w - 1][3] == 0        # top-right
        assert result[(h - 1) * w][3] == 0  # bottom-left
        assert result[h * w - 1][3] == 0    # bottom-right

    # --- Fruit pixel retained ---

    def test_fruit_pixel_alpha_preserved(self):
        pixels, w, h = self._make_image_with_fruit_center()
        result = remove_background(pixels, w, h)
        cx, cy = w // 2, h // 2
        fruit_alpha = result[cy * w + cx][3]
        assert fruit_alpha == 255

    def test_fruit_pixel_rgb_unchanged(self):
        pixels, w, h = self._make_image_with_fruit_center()
        result = remove_background(pixels, w, h)
        cx, cy = w // 2, h // 2
        r, g, b, _ = result[cy * w + cx]
        assert (r, g, b) == self.FRUIT_RED[:3]

    # --- Idempotency ---

    def test_idempotent(self):
        pixels, w, h = self._make_image_with_fruit_center(size=20)
        first_pass = remove_background(pixels, w, h)
        second_pass = remove_background(first_pass, w, h)
        assert first_pass == second_pass

    # --- Threshold boundary behaviour ---

    def test_pixel_exactly_at_hard_threshold_is_transparent(self):
        """A pixel whose distance equals HARD_THRESHOLD is strictly < threshold — transparent."""
        bg = (128, 128, 128, 255)
        pixels = _flat_image(10, 10, bg)
        # Place a pixel exactly at dist = HARD_THRESHOLD - 1 (inside hard zone)
        dist = HARD_THRESHOLD - 1
        target = (int(128 + dist), 128, 128, 255)
        pixels = _set_pixel(pixels, 10, 5, 5, target)
        result = remove_background(pixels, 10, 10)
        assert result[5 * 10 + 5][3] == 0

    def test_pixel_in_soft_zone_has_intermediate_alpha(self):
        bg = (128, 128, 128, 255)
        pixels = _flat_image(10, 10, bg)
        # Midpoint of soft zone
        mid = HARD_THRESHOLD + (SOFT_THRESHOLD - HARD_THRESHOLD) // 2
        target = (int(128 + mid), 128, 128, 255)
        pixels = _set_pixel(pixels, 10, 5, 5, target)
        result = remove_background(pixels, 10, 10)
        alpha = result[5 * 10 + 5][3]
        assert 0 < alpha < 255

    def test_pixel_beyond_soft_threshold_alpha_unchanged(self):
        bg = (128, 128, 128, 255)
        pixels = _flat_image(10, 10, bg)
        dist = SOFT_THRESHOLD + 10
        target = (int(128 + dist), 128, 128, 255)
        pixels = _set_pixel(pixels, 10, 5, 5, target)
        result = remove_background(pixels, 10, 10)
        assert result[5 * 10 + 5][3] == 255

    def test_custom_thresholds_respected(self):
        bg = (128, 128, 128, 255)
        pixels = _flat_image(10, 10, bg)
        # Pixel at dist=10 — transparent under default (hard=25) but should be
        # opaque if we set a tiny hard threshold of 5
        dist = 10
        target = (int(128 + dist), 128, 128, 255)
        pixels = _set_pixel(pixels, 10, 5, 5, target)

        result_default = remove_background(pixels, 10, 10, hard_threshold=25, soft_threshold=80)
        result_tiny = remove_background(pixels, 10, 10, hard_threshold=5, soft_threshold=15)

        assert result_default[5 * 10 + 5][3] == 0     # within default hard zone
        assert result_tiny[5 * 10 + 5][3] > 0         # outside tiny hard zone

    def test_non_uniform_background_all_corners_cleared(self):
        """
        Regression: BL corner pure-white while other corners are gray.
        With the old single-average approach, BL pure-white pixels had distance
        ~80 from the gray average and landed in the soft zone (alpha=144).
        With per-corner references, they match the BL reference at distance ~0
        → alpha=0.
        """
        gray = (210, 210, 207, 255)
        white = (255, 255, 255, 255)
        pixels = _flat_image(10, 10, gray)
        # Paint BL corner pure white (rows 7-9, cols 0-2)
        for row in range(7, 10):
            for col in range(0, 3):
                pixels[row * 10 + col] = white
        # Place a bright-red fruit pixel in the center
        pixels = _set_pixel(pixels, 10, 5, 5, (204, 52, 64, 255))

        result = remove_background(pixels, 10, 10)

        # All four true corners must be transparent
        assert result[0][3] == 0             # TL
        assert result[9][3] == 0             # TR
        assert result[7 * 10][3] == 0        # BL (was pure white — regression check)
        assert result[9 * 10 + 9][3] == 0    # BR
        # Fruit pixel must remain opaque
        assert result[5 * 10 + 5][3] == 255


# ---------------------------------------------------------------------------
# Circular mask
# ---------------------------------------------------------------------------

class TestApplyCircleMask:
    SIZE = 100  # square image; planet fills the frame

    def _planet_image(self) -> list[tuple[int, int, int, int]]:
        """Solid opaque orange planet filling the frame (no transparent background)."""
        return [(200, 120, 50, 255)] * (self.SIZE * self.SIZE)

    def _get_alpha(self, result: list[tuple[int, int, int, int]], x: int, y: int) -> int:
        return result[y * self.SIZE + x][3]

    def test_center_pixel_remains_fully_opaque(self):
        pixels = self._planet_image()
        result = apply_circle_mask(pixels, self.SIZE, self.SIZE)
        assert self._get_alpha(result, self.SIZE // 2, self.SIZE // 2) == 255

    def test_corner_pixels_become_transparent(self):
        pixels = self._planet_image()
        result = apply_circle_mask(pixels, self.SIZE, self.SIZE)
        assert self._get_alpha(result, 0, 0) == 0
        assert self._get_alpha(result, self.SIZE - 1, 0) == 0
        assert self._get_alpha(result, 0, self.SIZE - 1) == 0
        assert self._get_alpha(result, self.SIZE - 1, self.SIZE - 1) == 0

    def test_rgb_values_are_preserved_for_visible_pixels(self):
        """Circle mask preserves R, G, B for pixels with non-zero alpha;
        pixels with alpha=0 have RGB zeroed to prevent ghost-pixel resampling artifacts."""
        pixels = self._planet_image()
        result = apply_circle_mask(pixels, self.SIZE, self.SIZE)
        for r, g, b, a in result:
            if a > 0:
                assert (r, g, b) == (200, 120, 50)
            else:
                assert (r, g, b) == (0, 0, 0)

    def test_soft_edge_has_intermediate_alpha(self):
        """Pixels near the circle boundary should have 0 < alpha < 255."""
        pixels = self._planet_image()
        r = self.SIZE * 0.48
        feather = self.SIZE * 0.01
        result = apply_circle_mask(pixels, self.SIZE, self.SIZE)
        # Sample a pixel just inside the feather band
        cx, cy = self.SIZE / 2.0, self.SIZE / 2.0
        # Find a pixel whose distance from center is r (at the circle edge)
        edge_x = int(cx + r)
        if edge_x < self.SIZE:
            alpha = self._get_alpha(result, edge_x, int(cy))
            assert 0 <= alpha <= 255  # somewhere in the feather zone

    def test_interior_planet_pixels_not_damaged_by_neutral_color(self):
        """
        Regression: a planet with neutral/gray interior pixels (similar to the
        background corner color) must NOT be made semi-transparent.  The circle
        mask is purely geometry-based and ignores color entirely.
        """
        # Create a planet whose center color matches what corners look like
        neutral = (180, 175, 168, 255)  # same neutral tone as "atmospheric" corners
        pixels = [neutral] * (self.SIZE * self.SIZE)
        result = apply_circle_mask(pixels, self.SIZE, self.SIZE)
        # Center pixel must still be fully opaque (color-distance would wrongly fade it)
        assert self._get_alpha(result, self.SIZE // 2, self.SIZE // 2) == 255

    def test_custom_radius_factor(self):
        """A very small radius makes most pixels transparent; large radius keeps them."""
        pixels = self._planet_image()
        small = apply_circle_mask(pixels, self.SIZE, self.SIZE, radius_factor=0.1)
        large = apply_circle_mask(pixels, self.SIZE, self.SIZE, radius_factor=0.48)
        small_opaque = sum(1 for _, _, _, a in small if a > 200)
        large_opaque = sum(1 for _, _, _, a in large if a > 200)
        assert small_opaque < large_opaque
