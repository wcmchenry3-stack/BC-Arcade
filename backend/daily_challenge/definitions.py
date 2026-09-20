"""Daily cross-game challenge — deterministic, timezone-aware definitions (#2392).

Same stateless pattern as ``daily_word/puzzle.py``: nothing is stored. The
template list is shuffled once at load time with ``random.Random(SALT)``, then
``index = (local_date.toordinal() + SALT) % len(TEMPLATES)``. The day *ordinal*
rather than Daily Word's ``YYYYMMDD`` number: with only a handful of templates,
the jumps ``YYYYMMDD`` makes at month ends can repeat a template on consecutive
days (2028-02-29 to 03-01 is +72, a multiple of 8); the ordinal always steps by
one, so every template comes up once per cycle.
SALT comes from the DAILY_CHALLENGE_SALT env var (default 0); changing it
shifts the whole future schedule. ``challenge_id`` is the local date,
``"YYYY-MM-DD"``.

Which games can appear
----------------------
A goal is checked against the player's own rows in ``games`` (see
``service.py``), so a game qualifies only if it is **free** (visible in the
store build — never a premium slug) **and records a per-session game** through
``POST /games`` + ``PATCH /games/{id}/complete``. Today that is blackjack,
twenty48, solitaire and mahjong. The other two free games do not qualify yet:

- ``daily_word`` never creates a ``games`` row.
- ``freecell`` only writes leaderboard rows under one shared session id
  (``freecell/router.py``), so a row cannot be tied to a player.

Once their screens record games, adding them here is a template edit — the
service needs no change.

Goal kinds
----------
- ``complete``: a finished, non-abandoned game of that type today. What
  "finished" means is the game's own business — solitaire and mahjong only
  report ``completed`` on a win, twenty48 on game over, blackjack when the
  session is cashed out or busts.
- ``score_at_least``: a game of that type ended today with ``final_score >=
  target``. **Abandoned games count here**: twenty48 only reports ``completed``
  when the board fills, and a player who passed the target and then started a
  new game has still reached it. Only twenty48 has a ``final_score`` that is
  comparable between plays, so only twenty48 gets these.
"""

from __future__ import annotations

import hashlib
import logging
import os
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal

logger = logging.getLogger(__name__)


def parse_salt(raw: str | None) -> int:
    """DAILY_CHALLENGE_SALT as an int. Never raises: main.py imports this module,
    so a secret pasted in the wrong format must not stop the whole API booting.
    A non-integer value is hashed instead — still secret, still stable."""
    value = (raw or "").strip()
    if not value:
        return 0
    try:
        return int(value)
    except ValueError:
        logger.warning("DAILY_CHALLENGE_SALT is not an integer — using a hash of it")
        return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big")


# Must be set in production; the default 0 makes the schedule trivially derivable.
SALT = parse_salt(os.environ.get("DAILY_CHALLENGE_SALT"))

GoalKind = Literal["complete", "score_at_least"]

# Free games that write a per-session ``games`` row — see the module docstring.
CHALLENGE_GAMES: frozenset[str] = frozenset({"blackjack", "twenty48", "solitaire", "mahjong"})

# The only game whose final_score is comparable between plays.
SCORE_GOAL_GAMES: frozenset[str] = frozenset({"twenty48"})


@dataclass(frozen=True)
class Goal:
    game_type: str
    kind: GoalKind
    target: int | None = None

    @property
    def id(self) -> str:
        """Stable within a challenge — the client keys its goal rows on it."""
        if self.kind == "score_at_least":
            return f"{self.game_type}:score_at_least:{self.target}"
        return f"{self.game_type}:complete"


@dataclass(frozen=True)
class Template:
    id: str
    goals: tuple[Goal, ...]


def _complete(game_type: str) -> Goal:
    return Goal(game_type=game_type, kind="complete")


def _score(game_type: str, target: int) -> Goal:
    return Goal(game_type=game_type, kind="score_at_least", target=target)


# Two goals in two different games per day — the point is to move players
# across the arcade (guideline 4.2), not to grind one game. Solitaire appears
# least: a Klondike deal is not always winnable, so it is never the only route
# to variety in a week. tune post-launch
_BASE_TEMPLATES: tuple[Template, ...] = (
    Template("merge_and_match", (_score("twenty48", 1500), _complete("mahjong"))),
    Template("cards_and_tiles", (_complete("blackjack"), _complete("mahjong"))),
    Template("high_merge", (_score("twenty48", 2500), _complete("blackjack"))),
    Template("patience", (_complete("solitaire"), _score("twenty48", 1000))),
    Template("table_and_tiles", (_complete("blackjack"), _score("twenty48", 2000))),
    Template("match_and_merge", (_complete("mahjong"), _score("twenty48", 3000))),
    Template("card_shark", (_complete("solitaire"), _complete("blackjack"))),
    Template("warm_up", (_complete("twenty48"), _complete("mahjong"))),
)


def shuffled_templates(salt: int) -> list[Template]:
    """Salt-seeded order, so consecutive days are not simply list order."""
    templates = list(_BASE_TEMPLATES)
    random.Random(salt).shuffle(templates)
    return templates


def pick_index(day: date, salt: int, count: int) -> int:
    return (day.toordinal() + salt) % count


TEMPLATES: list[Template] = shuffled_templates(SALT)


@dataclass(frozen=True)
class LocalDay:
    """The player's calendar day and the UTC instants that bound it."""

    date: date
    start_utc: datetime
    end_utc: datetime


def local_day(tz_offset_minutes: int, utc_now: datetime | None = None) -> LocalDay:
    """Resolve "today" for a client ``tz_offset_minutes`` east of UTC (as Daily Word does)."""
    if utc_now is None:
        utc_now = datetime.now(timezone.utc)
    offset = timedelta(minutes=tz_offset_minutes)
    local_date = (utc_now + offset).date()
    start_utc = (
        datetime(local_date.year, local_date.month, local_date.day, tzinfo=timezone.utc) - offset
    )
    return LocalDay(date=local_date, start_utc=start_utc, end_utc=start_utc + timedelta(days=1))


def template_for(day: date) -> Template:
    return TEMPLATES[pick_index(day, SALT, len(TEMPLATES))]
