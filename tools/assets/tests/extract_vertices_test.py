"""
pytest suite for extract_vertices.py

Tests the core algorithm on synthetic pixel data without touching real assets.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_vertices import (
    _area_centroid,
    _graham_scan,
    _normalize_hull,
    _opaque_pixels,
    extract_hull,
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


def _circle_pixels(
    width: int,
    height: int,
    radius: float,
    alpha: int = 255,
) -> list[tuple[int, int, int, int]]:
    """Return an RGBA pixel list with an opaque circle centered in a transparent field."""
    cx, cy = width / 2.0, height / 2.0
    result = []
    for idx in range(width * height):
        x = idx % width
        y = idx // width
        dist = math.hypot(x - cx, y - cy)
        a = alpha if dist <= radius else 0
        result.append((200, 100, 50, a))
    return result


# ---------------------------------------------------------------------------
# _opaque_pixels
# ---------------------------------------------------------------------------


class TestOpaquePixels:
    def test_fully_opaque_image_returns_all_pixels(self):
        pixels = _flat_image(4, 4, (255, 255, 255, 255))
        result = _opaque_pixels(pixels, 4, 4)
        assert len(result) == 16

    def test_fully_transparent_returns_empty(self):
        pixels = _flat_image(4, 4, (255, 255, 255, 0))
        result = _opaque_pixels(pixels, 4, 4)
        assert result == []

    def test_alpha_at_threshold_excluded(self):
        """Alpha == 200 is NOT > 200 (the pipeline threshold), so it is excluded."""
        pixels = _flat_image(2, 2, (100, 100, 100, 200))
        result = _opaque_pixels(pixels, 2, 2)
        assert result == []

    def test_alpha_just_above_threshold_included(self):
        """Alpha == 201 is > 200, so it should be included."""
        pixels = _flat_image(2, 2, (100, 100, 100, 201))
        result = _opaque_pixels(pixels, 2, 2)
        assert len(result) == 4

    def test_mixed_alphas_only_opaque_returned(self):
        # 3×1 row: transparent, boundary, opaque
        pixels = [
            (0, 0, 0, 0),  # alpha=0   → excluded
            (0, 0, 0, 200),  # alpha=200 → excluded (not > 200)
            (0, 0, 0, 201),  # alpha=201 → included
        ]
        result = _opaque_pixels(pixels, 3, 1)
        assert result == [(2, 0)]

    def test_coordinates_are_correct(self):
        # 3×2 image, only pixel at (1, 1) is opaque
        pixels = _flat_image(3, 2, (0, 0, 0, 0))
        pixels[1 * 3 + 1] = (255, 255, 255, 255)
        result = _opaque_pixels(pixels, 3, 2)
        assert result == [(1, 1)]

    def test_empty_image_returns_empty(self):
        result = _opaque_pixels([], 0, 0)
        assert result == []


# ---------------------------------------------------------------------------
# _graham_scan
# ---------------------------------------------------------------------------


class TestGrahamScan:
    def test_triangle_returns_three_vertices(self):
        pts = [(0.0, 0.0), (4.0, 0.0), (2.0, 3.0)]
        hull = _graham_scan(pts)
        assert len(hull) == 3

    def test_square_returns_four_vertices(self):
        pts = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        hull = _graham_scan(pts)
        assert len(hull) == 4

    def test_interior_point_excluded(self):
        # Square plus a center point — center should not be in hull
        pts = [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0), (2.0, 2.0)]
        hull = _graham_scan(pts)
        assert len(hull) == 4
        assert (2.0, 2.0) not in hull

    def test_collinear_midpoint_excluded(self):
        # Three collinear points: only the two endpoints should be on the hull
        # (any third collinear point on an edge is excluded by the strict left-turn rule)
        pts = [(0.0, 0.0), (2.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]
        hull = _graham_scan(pts)
        # (2.0, 0.0) is on the edge between (0,0) and (4,0) — should not appear
        assert (2.0, 0.0) not in hull

    def test_fewer_than_three_points_returns_empty(self):
        assert _graham_scan([]) == []
        assert _graham_scan([(0.0, 0.0)]) == []
        assert _graham_scan([(0.0, 0.0), (1.0, 0.0)]) == []

    def test_all_hull_points_from_input(self):
        """Every point in the result must come from the input."""
        pts = [(0.0, 0.0), (3.0, 0.0), (3.0, 3.0), (0.0, 3.0), (1.5, 1.5)]
        hull = _graham_scan(pts)
        for pt in hull:
            assert pt in pts

    def test_duplicate_points_handled(self):
        pts = [(0.0, 0.0)] * 5 + [(1.0, 0.0), (0.5, 1.0)]
        hull = _graham_scan(pts)
        assert len(hull) == 3


# ---------------------------------------------------------------------------
# _area_centroid
# ---------------------------------------------------------------------------


class TestAreaCentroid:
    def test_square_matches_arithmetic_mean(self):
        """For a symmetric square the area centroid equals the arithmetic mean."""
        hull = [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]
        cx, cy = _area_centroid(hull)
        assert abs(cx - 2.0) < 1e-9
        assert abs(cy - 2.0) < 1e-9

    def test_right_triangle_centroid(self):
        """Right triangle with vertices (0,0),(6,0),(0,4) → centroid at (2, 4/3)."""
        hull = [(0.0, 0.0), (6.0, 0.0), (0.0, 4.0)]
        cx, cy = _area_centroid(hull)
        assert abs(cx - 2.0) < 1e-6
        assert abs(cy - 4.0 / 3.0) < 1e-6

    def test_asymmetric_differs_from_arithmetic_mean(self):
        """For a clearly asymmetric polygon, area centroid != arithmetic mean."""
        # L-shaped convex hull approximation — wide base, narrow top-right
        hull = [(0.0, 0.0), (9.0, 0.0), (9.0, 1.0), (1.0, 1.0), (1.0, 5.0), (0.0, 5.0)]
        cx_area, cy_area = _area_centroid(hull)
        cx_arith = sum(p[0] for p in hull) / len(hull)
        cy_arith = sum(p[1] for p in hull) / len(hull)
        # They should differ by more than a rounding error
        assert abs(cx_area - cx_arith) > 0.5 or abs(cy_area - cy_arith) > 0.5

    def test_degenerate_collinear_falls_back_to_arithmetic_mean(self):
        """Three collinear points have zero area — fallback to arithmetic mean."""
        hull = [(0.0, 0.0), (2.0, 0.0), (4.0, 0.0)]
        cx, cy = _area_centroid(hull)
        assert abs(cx - 2.0) < 1e-9
        assert abs(cy - 0.0) < 1e-9


# ---------------------------------------------------------------------------
# _normalize_hull
# ---------------------------------------------------------------------------


class TestNormalizeHull:
    def test_empty_input_returns_empty(self):
        assert _normalize_hull([]) == []

    def test_area_centroid_at_origin_symmetric(self):
        """For a symmetric square, area centroid (= arithmetic mean) should be at origin."""
        hull = [(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]
        normalized = _normalize_hull(hull)
        cx, cy = _area_centroid(normalized)
        assert abs(cx) < 1e-9
        assert abs(cy) < 1e-9

    def test_area_centroid_at_origin_asymmetric(self):
        """For an asymmetric triangle, area centroid of result must be at origin."""
        hull = [(0.0, 0.0), (6.0, 0.0), (0.0, 4.0)]  # right triangle
        normalized = _normalize_hull(hull)
        assert normalized
        cx, cy = _area_centroid(normalized)
        assert abs(cx) < 1e-9
        assert abs(cy) < 1e-9

    def test_max_distance_is_one(self):
        hull = [(0.0, 0.0), (6.0, 0.0), (3.0, 5.0)]
        normalized = _normalize_hull(hull)
        assert normalized  # non-empty
        max_dist = max(math.hypot(p[0], p[1]) for p in normalized)
        assert abs(max_dist - 1.0) < 1e-9

    def test_all_points_within_unit_circle(self):
        hull = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
        normalized = _normalize_hull(hull)
        for p in normalized:
            assert math.hypot(p[0], p[1]) <= 1.0 + 1e-9

    def test_coincident_points_returns_empty(self):
        """If all hull points are the same, max_dist≈0 → return []."""
        hull = [(5.0, 5.0), (5.0, 5.0), (5.0, 5.0)]
        assert _normalize_hull(hull) == []

    def test_output_length_equals_input_length(self):
        hull = [(0.0, 0.0), (2.0, 0.0), (1.0, 2.0)]
        normalized = _normalize_hull(hull)
        assert len(normalized) == 3


# ---------------------------------------------------------------------------
# extract_hull (integration)
# ---------------------------------------------------------------------------


class TestExtractHull:
    def test_all_transparent_returns_empty(self):
        pixels = _flat_image(10, 10, (255, 255, 255, 0))
        result = extract_hull(pixels, 10, 10)
        assert result == {"verts": [], "spriteOffset": [0.0, 0.0]}

    def test_fewer_than_three_opaque_pixels_returns_empty(self):
        pixels = _flat_image(10, 10, (0, 0, 0, 0))
        # Make exactly 2 pixels opaque
        pixels[0] = (255, 0, 0, 255)
        pixels[5] = (255, 0, 0, 255)
        result = extract_hull(pixels, 10, 10)
        assert result == {"verts": [], "spriteOffset": [0.0, 0.0]}

    def test_circle_yields_hull_within_unit_radius(self):
        size = 50
        pixels = _circle_pixels(size, size, radius=20.0)
        hull = extract_hull(pixels, size, size)["verts"]
        assert len(hull) >= 3
        # Hull is normalised to the opaque bbox: every coordinate within [-1, 1]
        for pt in hull:
            assert abs(pt[0]) <= 1.0 + 1e-9
            assert abs(pt[1]) <= 1.0 + 1e-9

    def test_circle_hull_centroid_near_origin(self):
        """Area centroid of a circle hull should be near origin after normalization."""
        size = 50
        pixels = _circle_pixels(size, size, radius=20.0)
        hull = extract_hull(pixels, size, size)["verts"]
        assert hull
        cx, cy = _area_centroid(hull)
        assert abs(cx) < 0.1
        assert abs(cy) < 0.1

    def test_square_opaque_region_returns_four_corners(self):
        """A 10×10 opaque square in a larger transparent field → 4-vertex hull."""
        size = 30
        pixels = _flat_image(size, size, (0, 0, 0, 0))
        # Fill rows 10-19, cols 10-19 with opaque pixels
        for row in range(10, 20):
            for col in range(10, 20):
                pixels[row * size + col] = (200, 200, 200, 255)
        result = extract_hull(pixels, size, size)
        hull = result["verts"]
        assert len(hull) == 4
        assert len(result["spriteOffset"]) == 2
        assert len(result["spriteScale"]) == 2

    def test_output_points_are_float_tuples(self):
        pixels = _circle_pixels(20, 20, radius=8.0)
        hull = extract_hull(pixels, 20, 20)["verts"]
        assert hull
        for pt in hull:
            assert len(pt) == 2
            assert isinstance(pt[0], float)
            assert isinstance(pt[1], float)
