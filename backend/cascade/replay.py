"""A recorded Cascade game, read from its events (#3858, epic #3273).

``scripts/replay_game.py`` prints this section for a Cascade game. It reads the story from what
the app recorded (``cascade/events.py``): the seeds and tuning in ``game_started``, the drops,
merges, chains and danger moments of the ``drop`` / ``merge`` units, and the outcome, end step
and capstone step in ``game_ended`` (beside #3700's result block). Nothing is re-simulated:
Cascade's physics replays bit for bit only on the JS engine that recorded it (a phone's Hermes
or JavaScriptCore, not this server), so the merges and the outcome are what tell the game. The
app's ``rebuild.ts`` re-simulates the drops as a best-effort extra; never verify a score here
by re-simulation.

The one cross-check: a merge into tier ``n`` scores ``2 ** n`` (``tiers.ts``), so the recorded
merges add up to the merge score ``game_ended`` reports, when the whole game was recorded.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from cascade.events import DROP, MERGE, OVERFLOW_TICKS, CascadeDrop, CascadeMerge
from games.engine_version import printable

STEPS_PER_SECOND = 60
"""The engine's fixed step is 1/60 s (``FIXED_STEP_MS``)."""


def merge_points(tier_from: int) -> int:
    """What a merge of two ``tier_from`` pieces scores: ``2 ** (tier_from + 1)`` (``tiers.ts``)."""
    return 2 ** (tier_from + 1)


@dataclass
class CascadeStory:
    """What the events say about one game."""

    started: Mapping[str, Any] | None = None
    ended: Mapping[str, Any] | None = None
    units: list[int] = field(default_factory=list)
    drops: list[tuple[int, int, int]] = field(default_factory=list)
    merges: list[tuple[int, int, int]] = field(default_factory=list)
    danger: list[tuple[int, int]] = field(default_factory=list)
    restored_units: list[int] = field(default_factory=list)
    invalid: int = 0

    @property
    def merge_score(self) -> int:
        return sum(merge_points(t) for _, t, _ in self.merges)


def read(events: Iterable[tuple[str, Any]]) -> CascadeStory:
    """The story of a game from its ``(event_type, data)`` pairs in ``event_index`` order.

    An event that does not fit the schema is counted (``invalid``) and left out, never guessed.
    """
    story = CascadeStory()
    for name, data in events:
        if not isinstance(data, Mapping):
            continue
        if name == "game_started" and story.started is None:
            story.started = data
        elif name == "game_ended" and story.ended is None:
            story.ended = data
        elif name in (DROP, MERGE):
            try:
                if name == DROP:
                    drop = CascadeDrop.model_validate(dict(data))
                    story.drops.extend(drop.d)
                    story.danger.extend(drop.z or [])
                    if drop.rs:
                        story.restored_units.append(drop.unit)
                    unit = drop.unit
                else:
                    merge = CascadeMerge.model_validate(dict(data))
                    story.merges.extend(merge.m)
                    unit = merge.unit
            except ValueError:
                story.invalid += 1
                continue
            if unit not in story.units:
                story.units.append(unit)
    return story


def _seconds(steps: int) -> str:
    return f"{steps / STEPS_PER_SECOND:.1f} s"


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def render(events: Iterable[tuple[str, Any]]) -> list[str]:
    """The game's story as plain text lines. Client strings are printed as truncated JSON."""
    story = read(events)
    lines = ["cascade game, read from its events (not re-simulated):"]
    s = story.started or {}
    if story.started is not None:
        lines.append(
            "  started    "
            f"pieces {printable(s.get('fruit_set'))}, queue seed {printable(s.get('seed'))}, "
            f"engine seed {printable(s.get('engine_seed'))}, tuning {printable(s.get('tuning'))}"
            # builds before #3942 record no app version (the golden fixture has one)
            + (f", app {printable(s['app_version'])}" if "app_version" in s else "")
        )
    else:
        lines.append("  started    no game_started")
    unit_span = f"{min(story.units)}-{max(story.units)}" if story.units else "none"
    lines.append(
        f"  units      {len(story.units)} ({unit_span}): {len(story.drops)} drops, "
        f"{len(story.merges)} merges"
        + (f", {story.invalid} invalid events left out" if story.invalid else "")
    )
    if story.restored_units:
        units = ", ".join(str(u) for u in story.restored_units)
        lines.append(f"  restored   a relaunch restored the board before unit {units}")
    if story.drops:
        tiers = Counter(t for _, _, t in story.drops)
        lines.append(
            "  drops      by tier: " + ", ".join(f"t{t} x{n}" for t, n in sorted(tiers.items()))
        )
    if story.merges:
        made = Counter(t + 1 for _, t, _ in story.merges)
        longest = max(story.merges, key=lambda m: m[2])
        lines.append(
            "  merges     by tier made: "
            + ", ".join(f"t{t} x{n}" for t, n in sorted(made.items()))
            + f"; score from merges {story.merge_score}"
        )
        lines.append(
            f"  chains     longest {longest[2]} (step {longest[0]}, {_seconds(longest[0])}); "
            f"{sum(1 for m in story.merges if m[2] == 3)} chains reached 3"
        )
    if story.danger:
        shown = ", ".join(
            f"step {start} peak {peak}/{OVERFLOW_TICKS}" for start, peak in story.danger[:8]
        )
        more = f" (+{len(story.danger) - 8} more)" if len(story.danger) > 8 else ""
        lines.append(f"  danger     {len(story.danger)} moments: {shown}{more}")
    lines.extend(_outcome_lines(story))
    return lines


def _outcome_lines(story: CascadeStory) -> list[str]:
    e = story.ended
    if e is None:
        return ["  outcome    no game_ended (still on the device, or never finished)"]
    out: list[str] = []
    end_step = _int(e.get("end_step"))
    capstone = _int(e.get("capstone_step"))
    lid = _int(e.get("lid_step"))
    outcome = printable(e.get("outcome"))
    when = f" at step {end_step} ({_seconds(end_step)} of play)" if end_step is not None else ""
    out.append(f"  outcome    {outcome}{when}")
    if story.restored_units:
        out.append(
            f"  note       the board was restored before unit {story.restored_units[-1]}: steps "
            "count from that restore, so the steps here are not the game's from its start"
        )
    if capstone is not None:
        out.append(f"  capstone   made at step {capstone} ({_seconds(capstone)})")
    if lid is not None:
        out.append(f"  lid        the count first ran at step {lid} ({_seconds(lid)})")
    merge_score = _int(e.get("merge_score"))
    bonus = _int(e.get("time_bonus"))
    final = _int(e.get("final_score"))
    duration = _int(e.get("duration_ms"))
    if merge_score is not None:
        out.append(
            f"  score      {printable(final)} = {merge_score} merges + {printable(bonus)} time bonus"
            + (f", {duration / 1000:.1f} s on the play clock" if duration is not None else "")
        )
        if story.merges:
            verdict = (
                "agrees"
                if story.merge_score == merge_score
                else "DISAGREES (a cap, a dropped batch, or events still on the device)"
            )
            out.append(f"  check      the recorded merges add up to {story.merge_score}: {verdict}")
    cut = [f"{k}={printable(e[k])}" for k in ("rec_cut", "z_cut") if k in e]
    if cut:
        out.append("  cut        the app stopped recording past a cap: " + ", ".join(cut))
    return out
