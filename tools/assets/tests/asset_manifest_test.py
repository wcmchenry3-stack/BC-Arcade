"""Every shipped asset has a provenance entry and a recipe or a stated reason it has none.

Reads tools/assets/asset_manifest.json. Fails when a file under frontend/assets/ matches no rule
or more than one, when a rule names a recipe script or credits file that does not exist, when a
third-party rule is not in the allow-list (so a new third-party file cannot arrive unnoticed), or
when an allow-listed file is gone.
"""

import json
import re
import sys
from pathlib import Path

import pytest

TOOLS_ASSETS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_ASSETS))
REPO = TOOLS_ASSETS.parents[1]
MANIFEST = json.loads((TOOLS_ASSETS / "asset_manifest.json").read_text())
RULES = MANIFEST["rules"]
ALLOW = set(MANIFEST["third_party_allowlist"])


def _shipped() -> list[str]:
    return sorted(
        p.relative_to(REPO).as_posix() for p in (REPO / "frontend/assets").rglob("*") if p.is_file()
    )


def _matches(rule: dict, path: str) -> bool:
    # "**" spans folders, "*" stays inside one.
    rx = re.escape(rule["glob"]).replace(r"\*\*/", "(?:.*/)?").replace(r"\*", "[^/]*")
    return re.fullmatch(rx, path) is not None


def _recipe_scripts(recipe: str) -> list[str]:
    """Script file names in a recipe string; expands `synth_{a,b}_sfx.py` style braces."""
    names = []
    for pre, alts, post in re.findall(r"tools/assets/(\w*)\{([^}]*)\}(\w*\.py)", recipe):
        names += [f"{pre}{a}{post}" for a in alts.split(",")]
    return names + re.findall(r"tools/assets/(\w+\.py)", recipe)


def test_every_asset_matches_exactly_one_rule():
    bad = {}
    for path in _shipped():
        hits = [r["glob"] for r in RULES if _matches(r, path)]
        if len(hits) != 1:
            bad[path] = hits
    assert not bad, f"assets without exactly one manifest rule: {bad}"


def test_rules_point_at_real_files():
    for rule in RULES:
        if "credits" in rule:
            assert (REPO / rule["credits"]).is_file(), rule
        for script in _recipe_scripts(rule.get("recipe", "")):
            assert (TOOLS_ASSETS / script).is_file(), (rule["glob"], script)
        if rule["kind"] in ("attested", "third-party"):
            assert rule.get("why"), f"{rule['glob']} needs a why"
        if rule["kind"] == "generated":
            assert rule.get("recipe"), f"{rule['glob']} needs a recipe"


def test_every_rule_matches_at_least_one_file():
    shipped = _shipped()
    stale = [r["glob"] for r in RULES if not any(_matches(r, p) for p in shipped)]
    assert not stale, f"rules that match no file: {stale}"


def test_third_party_files_are_exactly_the_allowlist():
    third = {p for p in _shipped() for r in RULES if r["kind"] == "third-party" and _matches(r, p)}
    assert third == ALLOW, f"unlisted: {sorted(third - ALLOW)}; missing: {sorted(ALLOW - third)}"


@pytest.mark.parametrize("path", sorted(ALLOW))
def test_allowlisted_files_are_credited(path):
    credits = (REPO / "frontend/assets/sounds/SOUND_CREDITS.md").read_text()
    fonts = (REPO / "frontend/assets/fonts/CREDITS.md").read_text()
    assert Path(path).name in credits + fonts


def test_every_shipped_ogg_is_made_by_a_recipe_and_vice_versa():
    import synth_arcade_sfx
    import synth_cascade_sfx
    import synth_puzzle_sfx
    import synth_starswarm_sfx

    made = {
        f"{n}.ogg"
        for m in (synth_arcade_sfx, synth_cascade_sfx, synth_puzzle_sfx)
        for n in m.SOUNDS
    }
    made |= {f"starswarm-{n}.ogg" for n in synth_starswarm_sfx.SOUNDS}
    shipped = {p.name for p in (REPO / "frontend/assets/sounds").glob("*.ogg")}
    assert (
        shipped == made
    ), f"no recipe: {sorted(shipped - made)}; not shipped: {sorted(made - shipped)}"
