"""Server-generated public leaderboard names (#2778).

Launch decision (docs/decisions/0001-generated-leaderboard-identities.md):
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

_rng = secrets.SystemRandom()

_PATTERN = re.compile(r"^(?P<adj>[A-Za-z]+) (?P<animal>[A-Za-z]+) (?P<number>[1-9][0-9]{1,3})$")


def generate_display_name(*, exclude: str | None = None) -> str:
    """A random ``Adjective Animal N`` name, never equal to ``exclude``.

    ``exclude`` is the player's current name, so a reroll always changes it.
    """
    while True:
        name = (
            f"{_rng.choice(ADJECTIVES)} {_rng.choice(ANIMALS)} "
            f"{_rng.randint(NUMBER_MIN, NUMBER_MAX)}"
        )
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
    )
