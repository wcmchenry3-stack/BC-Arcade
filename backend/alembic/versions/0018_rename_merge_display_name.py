"""rename Cascade game display_name from 'Fruit Merge' to 'Cascade'

Revision ID: 0018_rename_merge_display_name
Revises: 0017_add_daily_word_game_type
Create Date: 2026-05-07

The game was always internally named 'cascade' but its display_name was
inadvertently set to 'Fruit Merge' in migration 0002. This corrects it.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "0018_rename_merge_display_name"
down_revision: Union[str, None] = "0017_add_daily_word_game_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE game_types SET display_name = 'Cascade' WHERE name = 'merge' AND display_name = 'Fruit Merge'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE game_types SET display_name = 'Fruit Merge' WHERE name = 'merge' AND display_name = 'Cascade'"
    )
