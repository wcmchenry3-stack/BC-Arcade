#!/usr/bin/env python3
"""
Validate the Sort Puzzle per-theme color palettes.

Each theme is tested independently against its own background:
  • dark  palette → contrast ≥ 3:1 vs #0e0e13
  • light palette → contrast ≥ 3:1 vs #f5ecd7

Both palettes must satisfy:
  • ΔE₂₀₀₀ ≥ 20 for all 91 pairwise combinations
  • The same 14 color keys (sync check)

Usage:
  python3 tools/check_palette.py

To add a new theme, add an entry to PALETTES below and add its
background hex to BG_PER_THEME.  No other changes needed.
"""

import sys
import warnings
import numpy as np
import colour

DELTA_E_MIN = 20.0
CONTRAST_MIN = 3.0

# ---------------------------------------------------------------------------
# Background per theme — extend here when adding new themes
# ---------------------------------------------------------------------------
BG_PER_THEME: dict[str, str] = {
    "dark":  "#0e0e13",   # ThemeContext.tsx TOKENS.darkBg
    "light": "#f5ecd7",   # ThemeContext.tsx TOKENS.lightBg
}

# ---------------------------------------------------------------------------
# Current palettes (for reference / regression)
# Keep these in sync with theme.bottle.ts whenever palettes are updated.
# ---------------------------------------------------------------------------
CURRENT: dict[str, dict[str, str]] = {
    "dark": {
        # Mirrors frontend/src/theme/theme.bottle.ts BOTTLE_LIQUID_COLORS
        "red":    "#ff716c",
        "blue":   "#5b8cff",
        "green":  "#4ade80",
        "yellow": "#ffae3b",
        "orange": "#ff9f3b",
        "purple": "#d674ff",
        "pink":   "#ff5fa8",
        "teal":   "#8ff5ff",
        "brown":  "#b45309",
        "lime":   "#a3e635",
        "navy":   "#3b5bdb",
        "maroon": "#c2255c",
        "gold":   "#f59e0b",
        "indigo": "#818cf8",
    },
    "light": {
        # Pre-PR state: light palette did not exist; dark palette was used as a placeholder.
        # This section documents what was failing — not a valid light-mode palette.
        "red":    "#ff716c",
        "blue":   "#5b8cff",
        "green":  "#4ade80",
        "yellow": "#ffae3b",
        "orange": "#ff9f3b",
        "purple": "#d674ff",
        "pink":   "#ff5fa8",
        "teal":   "#8ff5ff",
        "brown":  "#b45309",
        "lime":   "#a3e635",
        "navy":   "#3b5bdb",
        "maroon": "#c2255c",
        "gold":   "#f59e0b",
        "indigo": "#818cf8",
    },
}

# ---------------------------------------------------------------------------
# Proposed palettes
# ---------------------------------------------------------------------------
PROPOSED: dict[str, dict[str, str]] = {
    # ── DARK theme ─────────────────────────────────────────────────────
    # Alternating BRIGHT/DARK tiers along each hue chain so every adjacent
    # pair has ΔL*≥25.  ΔE₂₀₀₀ ≥ 20 for all 91 pairs, contrast ≥ 3:1 on #0e0e13.
    "dark": {
        "red":    "#ff7777",  # BRIGHT H= 26°  L*=66
        "orange": "#ff8800",  # BRIGHT H= 63°  L*=69
        "brown":  "#aa5533",  # DARK   H= 48°  L*=46
        "gold":   "#886600",  # DARK   H= 84°  L*=45
        "yellow": "#ffee00",  # BRIGHT H= 98°  L*=93
        "lime":   "#66ff00",  # BRIGHT H=131°  L*=89
        "green":  "#008844",  # DARK   H=150°  L*=50
        "teal":   "#00ddcc",  # BRIGHT H=185°  L*=80
        "navy":   "#22aadd",  # BRIGHT H=244°  L*=65
        "blue":   "#3366dd",  # DARK   H=291°  L*=46
        "indigo": "#cc99ff",  # BRIGHT H=311°  L*=71
        "purple": "#aa00dd",  # DARK   H=320°  L*=44
        "pink":   "#ff33bb",  # BRIGHT H=344°  L*=59
        "maroon": "#cc0055",  # DARK   H= 10°  L*=44
    },
    # ── LIGHT theme ────────────────────────────────────────────────────
    # For cream bg (#f5ecd7) max fg luminance ≈ 0.266 (3:1 contrast).
    # ΔE₂₀₀₀ ≥ 20 for all 91 pairs, contrast ≥ 3:1 on #f5ecd7.
    # Minimum ΔE: 20.34 (navy/blue).
    "light": {
        # Warm chain: maroon·red·brown·orange·gold·yellow
        "maroon": "#770033",  # H=  7°  L*=24  C*=48
        "red":    "#dd0033",  # H= 28°  L*=46  C*=82
        "brown":  "#662200",  # H= 50°  L*=24  C*=45
        "orange": "#bb5500",  # H= 57°  L*=48  C*=69
        "gold":   "#554400",  # H= 89°  L*=30  C*=39
        "yellow": "#998800",  # H= 95°  L*=56  C*=61
        # Green chain: lime·green·teal
        "lime":   "#336600",  # H=127°  L*=38  C*=55
        "green":  "#009977",  # H=169°  L*=56  C*=44
        "teal":   "#004444",  # H=196°  L*=25  C*=19
        # Blue chain: navy·blue·indigo·purple·pink
        "navy":   "#228899",  # H=218°  L*=52  C*=28
        "blue":   "#1166aa",  # H=273°  L*=42  C*=43
        "indigo": "#8866ee",  # H=305°  L*=53  C*=78
        "purple": "#6611aa",  # H=314°  L*=30  C*=87
        "pink":   "#cc0088",  # H=348°  L*=45  C*=76
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def hex_to_srgb(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i+2], 16) / 255.0 for i in (0, 2, 4)])


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(hex_color: str) -> float:
    r, g, b = (srgb_to_linear(c) for c in hex_to_srgb(hex_color))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def wcag_contrast(hex_fg: str, hex_bg: str) -> float:
    lf = relative_luminance(hex_fg)
    lb = relative_luminance(hex_bg)
    lighter, darker = max(lf, lb), min(lf, lb)
    return (lighter + 0.05) / (darker + 0.05)


def hex_to_lab(h: str) -> np.ndarray:
    srgb = hex_to_srgb(h)
    xyz  = colour.sRGB_to_XYZ(srgb)
    return colour.XYZ_to_Lab(xyz)


def delta_e(h1: str, h2: str) -> float:
    return colour.delta_E(hex_to_lab(h1), hex_to_lab(h2), method="CIE 2000")


# ---------------------------------------------------------------------------
# Check
# ---------------------------------------------------------------------------

def check_theme_palette(palette: dict[str, str], bg: str, label: str) -> bool:
    names  = list(palette.keys())
    colors = list(palette.values())
    n = len(names)

    print(f"\n{'='*64}")
    print(f"  {label}")
    print(f"  {n} colors | ΔE₂₀₀₀ ≥ {DELTA_E_MIN} | contrast ≥ {CONTRAST_MIN}:1 vs {bg}")
    print(f"{'='*64}")

    de_failures = []
    for i in range(n):
        for j in range(i + 1, n):
            de = delta_e(colors[i], colors[j])
            if de < DELTA_E_MIN:
                de_failures.append((names[i], names[j], de))
    de_failures.sort(key=lambda x: x[2])

    print(f"\n[ΔE₂₀₀₀] {'PASS ✓' if not de_failures else 'FAIL ✗'} — {len(de_failures)} pair(s) below {DELTA_E_MIN}")
    if de_failures:
        print(f"  {'Pair':<24} {'ΔE':>6}")
        print(f"  {'-'*32}")
        for n1, n2, de in de_failures:
            marker = " !!!" if de < 10 else ""
            print(f"  {n1+' / '+n2:<24} {de:>6.1f}{marker}")

    contrast_failures = []
    for name, hex_c in palette.items():
        cr = wcag_contrast(hex_c, bg)
        if cr < CONTRAST_MIN:
            contrast_failures.append((name, hex_c, cr))
    contrast_failures.sort(key=lambda x: x[2])

    print(f"\n[Contrast vs {bg}] {'PASS ✓' if not contrast_failures else 'FAIL ✗'} — {len(contrast_failures)} color(s) below {CONTRAST_MIN}:1")
    if contrast_failures:
        print(f"  {'Color':<10} {'Hex':<10} {'Contrast':>8}")
        print(f"  {'-'*30}")
        for name, hex_c, cr in contrast_failures:
            print(f"  {name:<10} {hex_c:<10} {cr:>8.2f}:1")

    total = len(de_failures) + len(contrast_failures)
    print(f"\n  Result: {'ALL PASS ✓' if total == 0 else f'{total} issue(s) ✗'}")
    return total == 0


def check_sync(palettes: dict[str, dict[str, str]]) -> bool:
    themes = list(palettes.keys())
    ref_keys = set(palettes[themes[0]].keys())
    ok = True
    for t in themes[1:]:
        missing = ref_keys - set(palettes[t].keys())
        extra   = set(palettes[t].keys()) - ref_keys
        if missing or extra:
            print(f"\n[SYNC] FAIL ✗ — theme '{t}' vs '{themes[0]}': "
                  f"missing={missing}, extra={extra}")
            ok = False
    if ok:
        print(f"\n[SYNC] PASS ✓ — all themes have the same {len(ref_keys)} color keys")
    return ok


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("BC Arcade — Sort Puzzle per-theme palette validator")

    print("\n─── CURRENT ───────────────────────────────────────────────────")
    for theme, bg in BG_PER_THEME.items():
        check_theme_palette(CURRENT[theme], bg, f"CURRENT  {theme} theme")
    check_sync(CURRENT)

    print("\n─── PROPOSED ──────────────────────────────────────────────────")
    results = []
    for theme, bg in BG_PER_THEME.items():
        results.append(check_theme_palette(PROPOSED[theme], bg, f"PROPOSED {theme} theme"))
    results.append(check_sync(PROPOSED))

    sys.exit(0 if all(results) else 1)
