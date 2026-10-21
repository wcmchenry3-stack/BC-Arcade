"""Read a Star Swarm run's ``wave_timeline`` rows next to its ``wave_completed`` rows (#3395).

Offline and read-only: it takes the ``(event_type, data)`` pairs of one game and
returns text. ``scripts/replay_game.py <game_id>`` prints it for a Star Swarm
game. The contract is ``docs/games/starswarm-diagnostics.md``, section "Reader
and reconciliation (#3395)".

This is a diagnostic reader, not a replay. A timeline is a short, sampled list
of a wave's major transitions (damage, hull and lives, Carrier stages, power-up
pickups); it has no per-frame positions, no projectiles and no input stream, and
nothing here reconstructs them. ``wave_completed`` is the authoritative summary;
the timeline is cross-checked against it wherever their meanings align, and a
check weakens to "at most" when the timeline's ``ovf`` says entries of that
class were refused.

The code table and registries come from ``starswarm.timeline`` and
``starswarm.models``; nothing is duplicated here.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, NamedTuple

from starswarm import models, timeline
from starswarm.timeline import (
    CODES,
    MAX_TIME,
    MAX_X,
    TIMELINE_PHASES,
    WAVE_TIMELINE,
)

DISCLAIMER = (
    "NOTE: a sampled diagnostic of major transitions only; it is not a frame-by-frame "
    "or projectile replay and cannot rebuild the wave."
)
SUMMARY_TITLE = "SUMMARY (wave_completed, authoritative)"
TIMELINE_TITLE = "TIMELINE (sampled diagnostic, not a replay)"

_HIT_TYPES = ("lightning", "shield", "buddy", "bomb")  # the PICKUP-recorded power-ups
_BUFF_TYPES = ("lightning", "shield")  # the BUFF_END-recorded timed buffs
_DAMAGE, _TRANSITION, _POWERUP = 0, 1, 2  # indexes into ``ovf``
HULL_MAX = CODES[4].params[0].hi  # PLATING_UP.hullAfter's top: the hull cap
_OVF_NAMES = ("damage", "transition", "powerUp")


class Entry(NamedTuple):
    """One decoded timeline entry. ``params`` maps the code table's parameter names to ints."""

    t: int
    code: int
    name: str
    params: dict[str, int]
    raw: tuple[int, ...]

    @property
    def known(self) -> bool:
        return self.code in CODES


class Check(NamedTuple):
    name: str
    ok: bool
    detail: str


@dataclass
class Wave:
    """One wave close: its summary, its timeline, or both (``None`` when absent)."""

    wave: int
    outcome: str
    summary: dict[str, Any] | None
    timeline: dict[str, Any] | None
    note: str = ""
    problem: str | None = None  # path of the first schema fault in the timeline
    checks: list[Check] = field(default_factory=list)

    @property
    def dev(self) -> bool:
        return bool((self.summary or {}).get("dev")) or bool((self.timeline or {}).get("dev"))


# --------------------------------------------------------------------------- decoding


SAFE_MAX_CHARS = 40


def _safe(value: Any) -> str:
    """A client-supplied value, safe for a terminal: JSON-escaped (a control character
    prints as ``\\u001b``), ASCII only, truncated. The approach of ``replay_game._field``."""
    text = json.dumps(value if isinstance(value, str) else str(value), ensure_ascii=True)[1:-1]
    return text if len(text) <= SAFE_MAX_CHARS else text[:SAFE_MAX_CHARS] + "..."


def _is_int(value: Any) -> bool:
    return type(value) is int


def _registry(reg: tuple[str, ...], index: int) -> str:
    return reg[index] if 0 <= index < len(reg) else f"?{index}"


def decode_entry(raw: Any) -> Entry | None:
    """The entry, or ``None`` when it is not a well-formed ``[t, code, ...]`` (or breaks its code's arity/ranges).

    An unknown code (an app newer than this reader) is decoded as ``UNKNOWN_<code>``.
    """
    problem, _unknown = timeline.entry_problem(0, raw)
    if problem is not None:
        return None
    spec = CODES.get(raw[1])
    if spec is None:
        return Entry(raw[0], raw[1], f"UNKNOWN_{raw[1]}", {}, tuple(raw))
    params = {p.name: raw[2 + i] for i, p in enumerate(spec.params)}
    return Entry(raw[0], raw[1], spec.name, params, tuple(raw))


def _param_text(entry: Entry) -> str:
    """The human-readable remainder of an entry's line."""
    p = entry.params
    name = entry.name
    cause = _registry(models.HIT_CAUSES, p["cause"]) if "cause" in p else ""
    if name == "HULL_HIT":
        return f"{cause}  x={p['x']}/{MAX_X}  hull {p['hullAfter'] + 1} -> {p['hullAfter']}"
    if name == "LIFE_LOST":
        lethal = "  (lethal blow)" if p["livesAfter"] == 0 else ""
        return (
            f"{cause}  x={p['x']}/{MAX_X}  lives {p['livesAfter'] + 1} -> {p['livesAfter']}{lethal}"
        )
    if name == "BONUS_LIFE":
        return f"+{p['awarded']} life  lives after {p['livesAfter']}"
    if name == "PLATING_UP":
        return f"hull after {p['hullAfter']}"
    if name == "RUN_LOST":
        return f"cause {cause}"
    if name == "PHASE":
        return f"-> {_registry(TIMELINE_PHASES, p['phase'])}"
    if name == "CARRIER_STAGE":
        return f"-> {_registry(models.CARRIER_STAGES, p['stage'])}"
    if name == "CARRIER_DOWN":
        return f"by {_registry(models.KILL_METHODS, p['method'])}"
    if name == "PICKUP":
        return _registry(models.POWERUP_TYPES, p["type"])
    if name == "BUFF_END":
        return f"{_registry(models.POWERUP_TYPES, p['type'])} ran out"
    if not entry.known:
        return f"raw {list(entry.raw)}"
    return ""


def entry_line(entry: Entry) -> str:
    """``  30.1s  LIFE_LOST      ram  x=29/63  lives 1 -> 0  (lethal blow)``"""
    return f"  {entry.t / 10:>6.1f}s  {entry.name:<14} {_param_text(entry)}".rstrip()


# --------------------------------------------------------------------------- joining


def _dig(data: Any, *path: str) -> Any:
    for key in path:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return data


def _num(data: Any, *path: str) -> int:
    value = _dig(data, *path)
    return value if _is_int(value) else 0


def terminal_t(summary: dict[str, Any]) -> int:
    """``min(65535, floor(pacing.durationMs / 100))``: a wave's terminal ``t``."""
    return min(MAX_TIME, _num(summary, "pacing", "durationMs") // 100)


def _tl_terminal_t(tl: dict[str, Any]) -> int | None:
    entries = tl.get("e")
    if isinstance(entries, list) and entries and isinstance(entries[-1], list) and entries[-1]:
        t = entries[-1][0]
        return t if _is_int(t) else None
    return None


def _wave_key(data: Any) -> tuple[int, str] | None:
    if not isinstance(data, dict):
        return None
    wave, outcome = data.get("wave"), data.get("outcome")
    if _is_int(wave) and outcome in ("cleared", "died"):
        return wave, outcome
    return None


def pair_waves(events: Iterable[tuple[str, Any]]) -> tuple[list[Wave], list[Any]]:
    """Join each ``wave_timeline`` to its ``wave_completed`` by ``(wave, outcome)``.

    A ``died`` wave that a dev action touched can have several ``wave_completed``
    rows (one per reverted lethal hit), and the device keeps only the latest
    timeline, so for it the join also needs the timeline's terminal ``t`` to equal
    ``min(65535, floor(pacing.durationMs / 100))`` of the summary. A timeline with
    no summary is an orphan (still decoded). Returns ``(waves, unreadable)``;
    ``unreadable`` holds the timeline rows too broken to even name a wave.
    """
    summaries: dict[tuple[int, str], list[dict[str, Any]]] = {}
    timelines: list[dict[str, Any]] = []
    unreadable: list[Any] = []
    for name, data in events:
        if name == models.WAVE_COMPLETED and (key := _wave_key(data)):
            summaries.setdefault(key, []).append(data)
        elif name == WAVE_TIMELINE:
            if _wave_key(data) and timeline.header_problem(data) is None:
                timelines.append(data)
            else:
                unreadable.append(data)

    claimed: set[int] = set()
    waves: list[Wave] = []
    for tl in timelines:
        key = _wave_key(tl)
        assert key is not None
        candidates = [s for s in summaries.get(key, []) if id(s) not in claimed]
        dev_died = key[1] == "died" and (
            bool(tl.get("dev")) or any(s.get("dev") for s in summaries.get(key, []))
        )
        if len(summaries.get(key, [])) > 1 or dev_died:
            t = _tl_terminal_t(tl)
            candidates = [s for s in candidates if terminal_t(s) == t]
        match = candidates[0] if candidates else None
        if match is not None:
            claimed.add(id(match))
        wave = Wave(key[0], key[1], match, tl)
        if match is None:
            wave.note = "orphan timeline: no matching wave_completed, decoded but not reconciled"
        waves.append(wave)
    for key, rows in summaries.items():
        for s in rows:
            if id(s) not in claimed:
                waves.append(Wave(key[0], key[1], s, None))
    waves.sort(key=lambda w: (w.wave, w.outcome == "died", terminal_t(w.summary or {})))
    return waves, unreadable


# ------------------------------------------------------------------------ reconciling


def _damaged(summary: dict[str, Any]) -> bool:
    hits = _dig(summary, "damage", "hits")
    if not isinstance(hits, dict):
        return False
    return any(
        isinstance(row, dict) and (_num(row, "life") or _num(row, "plating"))
        for row in hits.values()
    )


def _count(entries: list[Entry], name: str, **match: int) -> int:
    return sum(
        1 for e in entries if e.name == name and all(e.params.get(k) == v for k, v in match.items())
    )


def _compare(name: str, got: int, want: int, weak: str | None, unit: str) -> Check:
    """Exact match, or ``got <= want`` when ``weak`` names the overflowing class."""
    if weak is None:
        ok = got == want
        return Check(
            name, ok, "" if ok else f"timeline has {got} but wave_completed says {want} ({unit})"
        )
    ok = got <= want
    return Check(
        f"{name} (at most, {weak})",
        ok,
        "" if ok else f"timeline has {got}, more than wave_completed's {want} ({unit}); {weak}",
    )


def _weak(ovf: list[int], cls: int) -> str | None:
    return f"ovf[{cls}] {_OVF_NAMES[cls]}={ovf[cls]}" if ovf[cls] > 0 else None


def reconcile(summary: dict[str, Any], tl: dict[str, Any]) -> list[Check]:
    """Every check of the contract's list for one paired wave, passes and failures."""
    entries = [e for raw in tl["e"] if (e := decode_entry(raw)) is not None]
    ovf = list(tl["ovf"])
    w_dmg, w_pu = _weak(ovf, _DAMAGE), _weak(ovf, _POWERUP)
    w_tr = _weak(ovf, _TRANSITION)
    checks: list[Check] = []
    checks += _hit_checks(summary, entries, w_dmg)
    checks += _death_checks(summary, tl, entries, w_dmg)
    checks += _lives_hull_checks(summary, entries, w_dmg)
    checks += _timing_checks(summary, entries, w_tr)
    checks += _powerup_checks(summary, entries, w_dmg, w_pu)
    return checks


def _hit_checks(summary: dict[str, Any], entries: list[Entry], weak: str | None) -> list[Check]:
    out: list[Check] = []
    for code_name, result in (("HULL_HIT", "plating"), ("LIFE_LOST", "life")):
        total_got = _count(entries, code_name)
        total_want = 0
        for ci, cause in enumerate(models.HIT_CAUSES):
            want = _num(summary, "damage", "hits", cause, result)
            total_want += want
            out.append(
                _compare(
                    f"{code_name} {cause}",
                    _count(entries, code_name, cause=ci),
                    want,
                    weak,
                    f"damage.hits.{cause}.{result}",
                )
            )
        out.append(
            _compare(f"{code_name} total", total_got, total_want, weak, f"sum of hits.*.{result}")
        )
    return out


def _death_checks(
    summary: dict[str, Any], tl: dict[str, Any], entries: list[Entry], weak: str | None
) -> list[Check]:
    if tl["outcome"] != "died":
        return []
    out: list[Check] = []
    run_lost = [e for e in entries if e.name == "RUN_LOST"]
    want = _dig(summary, "damage", "deathCause")
    got = _registry(models.HIT_CAUSES, run_lost[0].params["cause"]) if run_lost else None
    out.append(
        Check(
            "RUN_LOST cause = deathCause",
            got == want,
            "" if got == want else f"timeline says {got!r}, wave_completed deathCause is {want!r}",
        )
    )
    hits = [e for e in entries if e.name in ("HULL_HIT", "LIFE_LOST")]
    lethal = bool(hits) and hits[-1].name == "LIFE_LOST" and hits[-1].params["livesAfter"] == 0
    if weak is None:
        out.append(
            Check(
                "last hit is the lethal LIFE_LOST",
                lethal,
                "" if lethal else "a died wave's last hit entry should be LIFE_LOST with lives 0",
            )
        )
    else:
        out.append(Check(f"last hit is the lethal LIFE_LOST (not required, {weak})", True, ""))
    return out


def _lives_hull_checks(
    summary: dict[str, Any], entries: list[Entry], weak: str | None
) -> list[Check]:
    out: list[Check] = []
    awarded = sum(e.params["awarded"] for e in entries if e.name == "BONUS_LIFE")
    out.append(
        _compare(
            "BONUS_LIFE awarded",
            awarded,
            _num(summary, "pacing", "bonusLives"),
            weak,
            "pacing.bonusLives",
        )
    )
    if weak is not None:
        out.append(Check(f"lives and hull arithmetic (not checkable, {weak})", True, ""))
        return out
    lives = _num(summary, "pacing", "start", "lives")
    hull = _num(summary, "pacing", "start", "hull")
    problems: list[str] = []
    for e in entries:
        lives, hull, problem = _step(e, lives, hull)
        if problem:
            problems.append(f"{e.t / 10:.1f}s {e.name} {problem}")
    end_lives = _num(summary, "pacing", "end", "lives")
    end_hull = _num(summary, "pacing", "end", "hull")
    if lives != end_lives:
        problems.append(f"lives path ends at {lives}, pacing.end.lives is {end_lives}")
    if hull != end_hull:
        problems.append(f"hull path ends at {hull}, pacing.end.hull is {end_hull}")
    out.append(Check("lives and hull arithmetic", not problems, "; ".join(problems)))
    return out


def _step(e: Entry, lives: int, hull: int) -> tuple[int, int, str]:
    """Apply one entry to the running ``(lives, hull)``; the third value says what disagrees."""
    p = e.params
    if e.name == "LIFE_LOST":
        problem = f"with hull {hull} (expected 0)" if hull != 0 else ""
        if p["livesAfter"] != lives - 1:
            problem = f"says lives {p['livesAfter']}, running value {lives - 1}"
        return lives - 1, hull, problem
    if e.name == "BONUS_LIFE":
        lives += p["awarded"]
        problem = f"says lives {p['livesAfter']}, running value {lives}"
        return lives, hull, "" if p["livesAfter"] == lives else problem
    if e.name == "HULL_HIT":
        problem = f"says hull {p['hullAfter']}, running value {hull - 1}"
        return lives, p["hullAfter"], "" if p["hullAfter"] == hull - 1 else problem
    if e.name == "PLATING_UP":
        # at the hull cap a pickup is still collected, so hullAfter may equal the level before
        ok = p["hullAfter"] == hull + 1 or (hull == HULL_MAX and p["hullAfter"] == hull)
        problem = f"says hull {p['hullAfter']}, running value {hull}"
        return lives, p["hullAfter"], "" if ok else problem
    return lives, hull, ""


def _timing_checks(summary: dict[str, Any], entries: list[Entry], weak: str | None) -> list[Check]:
    out: list[Check] = []
    stages = _dig(summary, "carrier", "stageReachedMs")
    stages = stages if isinstance(stages, dict) else {}
    for si in (1, 2):
        stage = models.CARRIER_STAGES[si]
        got = [e for e in entries if e.name == "CARRIER_STAGE" and e.params["stage"] == si]
        ms = stages.get(stage)
        out.append(
            _time_check(
                f"CARRIER_STAGE {stage} t", got, ms, weak, f"carrier.stageReachedMs.{stage}"
            )
        )
    rout = _dig(summary, "rout")
    triggered = isinstance(rout, dict) and rout.get("triggered") is True
    at_ms = rout.get("atMs") if isinstance(rout, dict) and triggered else None
    out.append(
        _time_check("ROUT t", [e for e in entries if e.name == "ROUT"], at_ms, weak, "rout.atMs")
    )
    terminal = [e for e in entries if e.name in ("WAVE_CLEARED", "RUN_LOST")]
    want_t = terminal_t(summary)
    ok = len(terminal) == 1 and terminal[0].t == want_t
    got_t = terminal[0].t if terminal else None
    out.append(
        Check(
            "terminal t = pacing.durationMs",
            ok,
            "" if ok else f"terminal t is {got_t} ds but pacing.durationMs gives {want_t} ds",
        )
    )
    kills = _dig(summary, "combat", "kills", "Carrier")
    kills_n = sum(v for v in kills.values() if _is_int(v)) if isinstance(kills, dict) else 0
    downs = _count(entries, "CARRIER_DOWN")
    ok = downs <= 1 and (downs == 0 or kills_n > 0)
    out.append(
        Check(
            "CARRIER_DOWN at most once, only after a Carrier kill",
            ok,
            "" if ok else f"{downs} CARRIER_DOWN entries, combat.kills.Carrier total is {kills_n}",
        )
    )
    return out


def _time_check(name: str, got: list[Entry], ms: Any, weak: str | None, source: str) -> Check:
    """An entry's ``t`` against a ``wave_completed`` time in ms (``None``/absent: the event did not happen)."""
    want = min(MAX_TIME, ms // 100) if _is_int(ms) else None
    if len(got) > 1:
        return Check(name, False, f"{len(got)} entries, at most one is possible")
    if got and want is None:
        return Check(name, False, f"timeline has it at {got[0].t} ds but {source} is absent")
    if got and got[0].t != want:
        return Check(name, False, f"timeline t is {got[0].t} ds but {source} gives {want} ds")
    if not got and want is not None and weak is None:
        return Check(name, False, f"{source} is {ms} ms but the timeline has no entry")
    return Check(name if weak is None else f"{name} (absent entry allowed, {weak})", True, "")


def _powerup_checks(
    summary: dict[str, Any], entries: list[Entry], w_dmg: str | None, w_pu: str | None
) -> list[Check]:
    out: list[Check] = []
    for i, kind in enumerate(_HIT_TYPES):
        out.append(
            _compare(
                f"PICKUP {kind}",
                _count(entries, "PICKUP", type=i),
                _num(summary, "powerUps", "collected", kind),
                w_pu,
                f"powerUps.collected.{kind}",
            )
        )
    for i, kind in enumerate(_BUFF_TYPES):
        out.append(
            _compare(
                f"BUFF_END {kind}",
                _count(entries, "BUFF_END", type=i),
                _num(summary, "powerUps", "expired", kind),
                w_pu,
                f"powerUps.expired.{kind}",
            )
        )
    out.append(
        _compare(
            "PLATING_UP",
            _count(entries, "PLATING_UP"),
            _num(summary, "powerUps", "collected", "hull"),
            w_dmg,
            "powerUps.collected.hull",
        )
    )
    return out


# ------------------------------------------------------------------------- rendering


def _summary_lines(s: dict[str, Any]) -> list[str]:
    p = _dig(s, "pacing")
    p = p if isinstance(p, dict) else {}
    start = p.get("start") if isinstance(p.get("start"), dict) else {}
    end = p.get("end") if isinstance(p.get("end"), dict) else {}
    lines = [
        (
            f"    {_safe(_dig(s, 'difficulty'))}  "
            f"duration {_num(s, 'pacing', 'durationMs') / 1000:.1f}s  "
            f"score {_num(s, 'score', 'total')}"
            + (f"  [{_flags_text(s['_flags'])}]" if s.get("_flags") else "")
        ),
        (
            f"    lives {_safe(start.get('lives', '?'))} -> {_safe(end.get('lives', '?'))}  "
            f"hull {_safe(start.get('hull', 0))} -> {_safe(end.get('hull', 0))}  "
            f"bonus lives {_safe(p.get('bonusLives', 0))}"
        ),
    ]
    hits = _dig(s, "damage", "hits")
    parts = []
    if isinstance(hits, dict):
        for cause in models.HIT_CAUSES:
            row = hits.get(cause)
            if isinstance(row, dict) and row:
                parts.append(
                    f"{cause} " + "/".join(f"{_safe(k)} {_safe(v)}" for k, v in sorted(row.items()))
                )
    lines.append(
        "    hits: "
        + (", ".join(parts) if parts else "none")
        + f"  deathCause: {_safe(_dig(s, 'damage', 'deathCause'))}"
    )
    return lines


def _timeline_lines(wave: Wave) -> list[str]:
    tl = wave.timeline
    assert tl is not None
    ovf = tl["ovf"]
    head = f"    ev {tl['ev']}  entries {len(tl['e'])}  ovf damage={ovf[0]} transition={ovf[1]} powerUp={ovf[2]}"
    if any(ovf):
        head += "  (entries were refused: counts below may be low)"
    lines = [head]
    for raw in tl["e"]:
        entry = decode_entry(raw)
        lines.append(
            "  " + entry_line(entry) if entry else f"      INVALID entry {_safe(repr(raw))}"
        )
    return lines


def _flags_text(flags: Any) -> str:
    items = flags if isinstance(flags, list) else [flags]
    return ", ".join(_safe(f) for f in items)


def _flag_notes(wave: Wave) -> list[str]:
    notes = []
    for label, row in (("wave_timeline", wave.timeline), ("wave_completed", wave.summary)):
        flags = (row or {}).get("_flags")
        if flags:
            notes.append(f"  FLAGGED {label} row: {_flags_text(flags)}")
    tl_flags = (wave.timeline or {}).get("_flags")
    if isinstance(tl_flags, list) and "unknown_code" in tl_flags:
        notes.append("  note: unknown codes are shown raw (this reader is older than the app)")
    return notes


def render_wave(wave: Wave) -> list[str]:
    title = f"wave {wave.wave} {wave.outcome}" + (
        "  [dev wave: decoded, not checked]" if wave.dev else ""
    )
    lines = [title]
    if wave.summary is not None:
        lines += ["  " + SUMMARY_TITLE, *_summary_lines(wave.summary)]
    else:
        lines.append("  " + SUMMARY_TITLE + ": none for this wave")
    if wave.timeline is not None:
        lines.append("  " + TIMELINE_TITLE)
        if wave.problem:
            lines.append(
                f"    INVALID timeline row (first fault at {wave.problem}); not reconciled"
            )
        lines += _timeline_lines(wave)
    lines += _flag_notes(wave)
    if wave.note:
        lines.append(
            f"  ORPHAN: {wave.note}" if wave.note.startswith("orphan") else f"  {wave.note}"
        )
    if wave.checks:
        failed = [c for c in wave.checks if not c.ok]
        lines.append(
            f"  RECONCILIATION: {len(wave.checks) - len(failed)}/{len(wave.checks)} checks hold"
        )
        lines += [f"    FAIL {c.name}: {c.detail}" for c in failed]
    return lines


def analyze(events: Iterable[tuple[str, Any]]) -> tuple[list[Wave], list[Any]]:
    """Pair, then reconcile every paired, valid, non-dev wave."""
    waves, unreadable = pair_waves(events)
    for wave in waves:
        tl = wave.timeline
        if tl is not None:
            wave.problem = timeline.entries_problem(tl)[0]
        if wave.timeline is None:
            if (
                wave.summary is not None
                and not wave.dev
                and (wave.outcome == "died" or _damaged(wave.summary))
            ):
                wave.note = (
                    "no timeline (advisory: a died or damaged cleared wave normally has one, but "
                    "the device-side reasons it may be missing are not stored)"
                )
        elif wave.summary is not None and wave.problem is None and not wave.dev:
            wave.checks = reconcile(wave.summary, tl)
    return waves, unreadable


def render(events: Iterable[tuple[str, Any]]) -> list[str]:
    """The Star Swarm section of ``replay_game.py``'s report."""
    waves, unreadable = analyze(events)
    lines = ["starswarm waves: summaries and sampled timelines (#3395)", f"  {DISCLAIMER}"]
    if not waves and not unreadable:
        return [*lines, "  no wave_completed or wave_timeline events"]
    for wave in waves:
        lines += ["", *render_wave(wave)]
    for data in unreadable:
        lines += ["", f"INVALID wave_timeline row, not decoded ({_unreadable_reason(data)})"]
    failed = sum(1 for w in waves for c in w.checks if not c.ok)
    orphans = sum(1 for w in waves if w.note.startswith("orphan"))
    missing = sum(1 for w in waves if w.note.startswith("no timeline"))
    lines += [
        "",
        (
            f"reconciliation summary: {len(waves)} waves, {failed} failed checks, {orphans} orphan "
            f"timelines, {missing} without a timeline (advisory), "
            f"{len(unreadable)} invalid timeline rows"
        ),
    ]
    return lines


def _unreadable_reason(data: Any) -> str:
    if not isinstance(data, dict):
        return "payload is not an object"
    return f"first fault at {timeline.header_problem(data) or 'wave/outcome'}"
