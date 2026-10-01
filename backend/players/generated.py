"""Server-generated public leaderboard names (#2778).

Launch decision (docs/LEADERBOARD-IDENTITIES.md):
a player never types public text. Joining the leaderboards gives them a name
made here from two curated word lists and a number, e.g. ``Brave Otter 4821``,
and "get a new name" picks another one. Nothing a client sends is ever stored
as a public name.

The lists are deliberately short, plain and positive: every adjective and
every animal is safe on its own and in any pairing, and none has a common
slang or double meaning. Review any addition with that in mind; a word that
could combine into something offensive does not belong here. Names are not
unique: the board identifies a player by their id, so two players who happen
to draw the same name are still two entries.

Names are English on every locale: they are identifiers, like a gamer tag,
and the same name must read the same on every device that shows a board.
"""

from __future__ import annotations

import re
import secrets

ADJECTIVES: tuple[str, ...] = (
    "Breezy",
    "Bright",
    "Brave",
    "Calm",
    "Cheery",
    "Chipper",
    "Clever",
    "Cosmic",
    "Cozy",
    "Crisp",
    "Daring",
    "Dapper",
    "Dazzling",
    "Eager",
    "Fearless",
    "Friendly",
    "Gentle",
    "Gleaming",
    "Golden",
    "Happy",
    "Hardy",
    "Honest",
    "Jolly",
    "Kind",
    "Lively",
    "Lucky",
    "Mellow",
    "Merry",
    "Mighty",
    "Nimble",
    "Noble",
    "Patient",
    "Peppy",
    "Plucky",
    "Polite",
    "Proud",
    "Quick",
    "Quiet",
    "Radiant",
    "Rapid",
    "Shiny",
    "Silver",
    "Sleek",
    "Smart",
    "Snappy",
    "Speedy",
    "Spry",
    "Steady",
    "Stellar",
    "Sunny",
    "Swift",
    "Tidy",
    "Trusty",
    "Upbeat",
    "Valiant",
    "Vivid",
    "Warm",
    "Wise",
    "Witty",
    "Zesty",
)

ANIMALS: tuple[str, ...] = (
    "Alpaca",
    "Badger",
    "Bison",
    "Bluejay",
    "Condor",
    "Crane",
    "Dolphin",
    "Eagle",
    "Falcon",
    "Ferret",
    "Finch",
    "Fox",
    "Gazelle",
    "Gecko",
    "Hedgehog",
    "Heron",
    "Ibis",
    "Jaguar",
    "Kestrel",
    "Koala",
    "Koi",
    "Lemur",
    "Lion",
    "Llama",
    "Lynx",
    "Marmot",
    "Meerkat",
    "Moose",
    "Narwhal",
    "Newt",
    "Ocelot",
    "Otter",
    "Owl",
    "Panda",
    "Panther",
    "Parrot",
    "Pelican",
    "Penguin",
    "Puffin",
    "Quail",
    "Rabbit",
    "Raccoon",
    "Raven",
    "Robin",
    "Salmon",
    "Seal",
    "Sparrow",
    "Squirrel",
    "Stork",
    "Swan",
    "Tiger",
    "Toucan",
    "Turtle",
    "Walrus",
    "Wombat",
    "Wren",
    "Yak",
    "Zebra",
)

NUMBER_MIN = 10
NUMBER_MAX = 9999

# Numbers with a well-known hateful, sexual, violent or drug meaning are never
# part of a name. A number is blocked when it is one of ``_BLOCKED_VALUES``,
# contains one of ``_BLOCKED_DIGITS`` anywhere, or ends in one of
# ``_BLOCKED_SUFFIXES`` (``88`` as a trailing tag). Migration
# ``0030_generated_player_names`` keeps a literal copy of these rules;
# ``tests/test_generated_names.py`` checks the two copies match.
_BLOCKED_VALUES: frozenset[int] = frozenset({14, 18, 69, 88, 187, 311, 420, 666, 911, 1312, 1488})
_BLOCKED_DIGITS: tuple[str, ...] = ("1488", "1312", "69", "420", "666")
_BLOCKED_SUFFIXES: tuple[str, ...] = ("88",)


def _is_blocked_number(number: int) -> bool:
    digits = str(number)
    return (
        number in _BLOCKED_VALUES
        or any(bad in digits for bad in _BLOCKED_DIGITS)
        or digits.endswith(_BLOCKED_SUFFIXES)
    )


_BLOCKED_NUMBERS: frozenset[int] = frozenset(
    n for n in range(NUMBER_MIN, NUMBER_MAX + 1) if _is_blocked_number(n)
)

_rng = secrets.SystemRandom()

_PATTERN = re.compile(r"^(?P<adj>[A-Za-z]+) (?P<animal>[A-Za-z]+) (?P<number>[1-9][0-9]{1,3})$")


def generate_display_name(*, exclude: str | None = None) -> str:
    """A random ``Adjective Animal N`` name, never equal to ``exclude``.

    ``exclude`` is the player's current name, so a reroll always changes it.
    A number in ``_BLOCKED_NUMBERS`` is drawn again.
    """
    while True:
        adjective, animal = _rng.choice(ADJECTIVES), _rng.choice(ANIMALS)
        number = _rng.randint(NUMBER_MIN, NUMBER_MAX)
        while number in _BLOCKED_NUMBERS:
            number = _rng.randint(NUMBER_MIN, NUMBER_MAX)
        name = f"{adjective} {animal} {number}"
        if name != exclude:
            return name


def is_generated_display_name(name: str) -> bool:
    """Whether ``name`` is one ``generate_display_name`` can produce."""
    match = _PATTERN.match(name)
    if match is None:
        return False
    return (
        match["adj"] in ADJECTIVES
        and match["animal"] in ANIMALS
        and NUMBER_MIN <= int(match["number"]) <= NUMBER_MAX
        and int(match["number"]) not in _BLOCKED_NUMBERS
    )
