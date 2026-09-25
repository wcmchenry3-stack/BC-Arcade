"""make sudoku free (owner decision 2026-09-25)

Revision ID: 0023_sudoku_free
Revises: 0022_swap_mahjong_sort
Create Date: 2026-09-25

Sudoku moves to the free tier — no compensating premium swap this time. The
6/6 premium/free split was an artifact of the initial store-review pass, not a
design target: this lands at 7 free / 5 premium (blackjack, cascade, hearts,
starswarm, mahjong stay premium). Entitlement checks and the daily challenge's
slate logic read ``is_premium`` live, so this row flip is the whole backend
switch. Sudoku is not added to the daily-challenge free goal pool here — it
never had goals defined while premium (post-launch per #2458, same as
blackjack/mahjong), and adding a 7th free game would push the pool's rotating
game count to 6 (even), breaking the odd-rotation-length invariant
(``test_every_neighbouring_pair_occurs_so_the_rotation_length_stays_odd``).
That is a separate follow-up, not a side effect of this tier change.
"""

from collections.abc import Sequence

from sqlalchemy import text

from alembic import op

revision: str = "0023_sudoku_free"
down_revision: str | None = "0022_swap_mahjong_sort"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(text("UPDATE game_types SET is_premium = false WHERE name = 'sudoku'"))


def downgrade() -> None:
    op.execute(text("UPDATE game_types SET is_premium = true WHERE name = 'sudoku'"))
