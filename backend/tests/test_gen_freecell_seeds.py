"""Tests for gen_freecell_seeds.py (#2038).

Locks the invariants that make the generator safe to run repeatedly:

1. LCG output is deterministic and matches the TS engine line-for-line.
2. Fisher-Yates produces the identical permutation for a given seed.
3. Deal layout matches the FreeCell contract (8 columns, 7/7/7/7/6/6/6/6,
   all 52 cards present, no face-down concept).
4. Safe auto-move detection is correct.
5. The DFS solver correctly classifies a trivial pre-won state and a
   known-solvable seed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND / "scripts"))

from gen_freecell_seeds import (  # noqa: E402
    DECK_SIZE,
    EMPTY,
    TABLEAU_COLUMNS,
    apply_safe_automoves,
    canonical_key,
    deal,
    fisher_yates,
    fresh_deck,
    is_solvable,
    lcg,
    solve,
    _card_rank,
    _card_suit,
    _is_safe_to_foundation,
    _is_win,
)

# ---------------------------------------------------------------------------
# LCG parity with TS engine
# ---------------------------------------------------------------------------


def _ts_lcg(seed: int, n: int) -> list[float]:
    """Reference port of createSeededRng from frontend/src/game/freecell/engine.ts."""
    state = seed & 0xFFFFFFFF
    out = []
    for _ in range(n):
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        out.append(state / 4294967296)
    return out


def test_lcg_matches_ts_engine() -> None:
    rng = lcg(42)
    got = [next(rng) for _ in range(10)]
    assert got == _ts_lcg(42, 10)


def test_lcg_seed_0() -> None:
    rng = lcg(0)
    assert [next(rng) for _ in range(5)] == _ts_lcg(0, 5)


def test_lcg_large_seed() -> None:
    big = 0xDEADBEEF
    rng = lcg(big)
    assert [next(rng) for _ in range(8)] == _ts_lcg(big, 8)


# ---------------------------------------------------------------------------
# Fisher-Yates parity
# ---------------------------------------------------------------------------


def test_fresh_deck_is_52_unique() -> None:
    deck = fresh_deck()
    assert len(deck) == DECK_SIZE
    assert len(set(deck)) == DECK_SIZE


def test_fresh_deck_suit_rank_order() -> None:
    """Canonical order: spades 1-13, hearts 1-13, diamonds 1-13, clubs 1-13."""
    deck = fresh_deck()
    expected = [si * 13 + (r - 1) for si in range(4) for r in range(1, 14)]
    assert deck == expected


def test_fisher_yates_deterministic() -> None:
    d1 = fisher_yates(fresh_deck(), lcg(123))
    d2 = fisher_yates(fresh_deck(), lcg(123))
    assert d1 == d2


def test_fisher_yates_different_seeds_differ() -> None:
    d1 = fisher_yates(fresh_deck(), lcg(1))
    d2 = fisher_yates(fresh_deck(), lcg(2))
    assert d1 != d2


# ---------------------------------------------------------------------------
# Deal layout (mirrors FreeCell engine.ts contract)
# ---------------------------------------------------------------------------


def test_deal_tableau_column_count() -> None:
    foundations, tableau, freecells = deal(7)
    assert len(tableau) == TABLEAU_COLUMNS


def test_deal_column_sizes() -> None:
    """Cols 0-3 get 7 cards; cols 4-7 get 6 cards."""
    foundations, tableau, freecells = deal(7)
    for col in range(4):
        assert len(tableau[col]) == 7, f"col {col} size"
    for col in range(4, 8):
        assert len(tableau[col]) == 6, f"col {col} size"


def test_deal_all_52_cards_present() -> None:
    foundations, tableau, freecells = deal(17)
    all_cards = [cid for col in tableau for cid in col]
    assert len(all_cards) == DECK_SIZE
    assert len(set(all_cards)) == DECK_SIZE


def test_deal_freecells_empty() -> None:
    foundations, tableau, freecells = deal(7)
    assert freecells == (EMPTY, EMPTY, EMPTY, EMPTY)


def test_deal_foundations_empty() -> None:
    foundations, tableau, freecells = deal(7)
    assert foundations == (0, 0, 0, 0)


def test_deal_different_seeds_produce_different_layouts() -> None:
    _, t1, _ = deal(1)
    _, t2, _ = deal(2)
    assert t1 != t2


# ---------------------------------------------------------------------------
# Card encoding helpers
# ---------------------------------------------------------------------------


def test_card_rank_and_suit() -> None:
    # spades ace: suit_idx=0, rank=1 → card_id=0
    assert _card_suit(0) == 0
    assert _card_rank(0) == 1
    # clubs king: suit_idx=3, rank=13 → card_id=3*13+12=51
    assert _card_suit(51) == 3
    assert _card_rank(51) == 13


# ---------------------------------------------------------------------------
# Safe auto-move detection
# ---------------------------------------------------------------------------


def test_safe_for_ace() -> None:
    """Aces are always safe (rank ≤ 2)."""
    ace_spades = 0  # suit=0, rank=1
    assert _is_safe_to_foundation(ace_spades, (0, 0, 0, 0))


def test_safe_for_two_when_ace_on_foundation() -> None:
    two_spades = 1  # suit=0, rank=2
    # Foundation has ace of spades already
    assert _is_safe_to_foundation(two_spades, (1, 0, 0, 0))


def test_not_safe_when_foundation_not_ready() -> None:
    two_spades = 1
    # Foundation is empty — can't play 2 yet
    assert not _is_safe_to_foundation(two_spades, (0, 0, 0, 0))


def test_safe_three_when_both_twos_present() -> None:
    """3-of-spades (black) is safe when both red 2s (hearts, diamonds) are on foundation."""
    three_spades = 2  # suit=0, rank=3
    # foundations: spades=2, hearts=2, diamonds=2, clubs=0
    assert _is_safe_to_foundation(three_spades, (2, 2, 2, 0))


def test_not_safe_three_when_red_two_missing() -> None:
    three_spades = 2
    # hearts 2 missing
    assert not _is_safe_to_foundation(three_spades, (2, 1, 2, 0))


# ---------------------------------------------------------------------------
# apply_safe_automoves
# ---------------------------------------------------------------------------


def _make_state(
    tableau_tops: list[int | None],
    freecells: tuple[int, int, int, int] = (EMPTY, EMPTY, EMPTY, EMPTY),
    foundations: tuple[int, int, int, int] = (0, 0, 0, 0),
) -> tuple:
    """Build a minimal state with single-card columns for testing auto-moves."""
    tableau = []
    for cid in tableau_tops:
        tableau.append((cid,) if cid is not None else ())
    # Pad to 8 columns
    while len(tableau) < TABLEAU_COLUMNS:
        tableau.append(())
    return (foundations, tuple(tableau), freecells)


def test_automove_sends_ace_to_foundation() -> None:
    ace_spades = 0  # suit=0, rank=1
    state = _make_state([ace_spades])
    result = apply_safe_automoves(state)
    foundations, tableau, freecells = result
    assert foundations[0] == 1
    assert tableau[0] == ()


def test_automove_leaves_unsafe_card() -> None:
    """A 3 should NOT auto-move when not all lower opposites are on the foundation."""
    three_spades = 2  # suit=0, rank=3
    # foundations: spades=2, hearts=1 (diamonds 2 missing)
    state = _make_state([three_spades], foundations=(2, 1, 2, 0))
    result = apply_safe_automoves(state)
    # 3 of spades is not safe (hearts foundation is only at 1, not 2)
    assert result[0][0] == 2  # spades foundation unchanged


# ---------------------------------------------------------------------------
# Canonical key
# ---------------------------------------------------------------------------


def test_canonical_key_normalises_freecell_order() -> None:
    """Two states that differ only in freecell slot order share a key."""
    card_a, card_b = 10, 20
    foundations = (0, 0, 0, 0)
    tableau = tuple(() for _ in range(TABLEAU_COLUMNS))
    s1 = (foundations, tableau, (card_a, card_b, EMPTY, EMPTY))
    s2 = (foundations, tableau, (EMPTY, card_a, card_b, EMPTY))
    assert canonical_key(s1) == canonical_key(s2)


def test_canonical_key_normalises_column_order() -> None:
    """Two states that differ only in which column holds which pile share a key."""
    foundations = (0, 0, 0, 0)
    col_a = (1, 2, 3)
    col_b = (4, 5)
    empties = tuple(() for _ in range(6))
    freecells = (EMPTY, EMPTY, EMPTY, EMPTY)
    s1 = (foundations, (col_a, col_b) + empties, freecells)
    s2 = (foundations, (col_b, col_a) + empties, freecells)
    assert canonical_key(s1) == canonical_key(s2)


# ---------------------------------------------------------------------------
# Solver correctness
# ---------------------------------------------------------------------------


def _won_state() -> tuple:
    """All 52 cards on foundations."""
    foundations = (13, 13, 13, 13)
    tableau = tuple(() for _ in range(TABLEAU_COLUMNS))
    freecells = (EMPTY, EMPTY, EMPTY, EMPTY)
    return (foundations, tableau, freecells)


def test_is_win_true_for_completed_foundations() -> None:
    assert _is_win(_won_state()[0])


def test_is_win_false_at_deal() -> None:
    foundations, _, _ = deal(1)
    assert not _is_win(foundations)


def test_solver_trivially_accepts_won_state() -> None:
    assert solve(_won_state()) is True


@pytest.mark.parametrize("seed", [2, 3, 5, 8, 9])
def test_solver_finds_known_solvable_seeds(seed: int) -> None:
    """Regression: these seeds must remain solvable after any solver change.

    Seeds chosen from the generated bank that solve within the default budget
    (200k states, 0.3s wall-clock). Seed 1 requires >200k states and is
    intentionally excluded — the generator skips it and uses the next seed.
    """
    assert is_solvable(seed, state_budget=200_000, limit_seconds=30.0)
