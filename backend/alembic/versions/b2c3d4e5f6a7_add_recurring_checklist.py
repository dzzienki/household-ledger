"""add autopay checklist columns to recurring_transactions

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-07-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'recurring_transactions',
        sa.Column('checked_funded', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'recurring_transactions',
        sa.Column('checked_paid', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'recurring_transactions',
        sa.Column('checked_amount', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        'recurring_transactions',
        sa.Column('checklist_period', sqlmodel.sql.sqltypes.AutoString(length=10), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('recurring_transactions', 'checklist_period')
    op.drop_column('recurring_transactions', 'checked_amount')
    op.drop_column('recurring_transactions', 'checked_paid')
    op.drop_column('recurring_transactions', 'checked_funded')
