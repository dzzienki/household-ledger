"""add dismissed_transactions

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-11-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'dismissed_transactions',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('ledger_id', sa.Uuid(), nullable=False),
        # Shared enum already exists (see c3c90878dac1).
        sa.Column(
            'type',
            postgresql.ENUM('INCOME', 'EXPENSE', name='transactiontype', create_type=False),
            nullable=False,
        ),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('transaction_date', sa.Date(), nullable=False),
        sa.Column('balance', sa.Numeric(15, 2), nullable=True),
        sa.Column('payee', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column('reason', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
        sa.ForeignKeyConstraint(['ledger_id'], ['ledgers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_dismissed_transactions_id'), 'dismissed_transactions', ['id'], unique=False)
    op.create_index(op.f('ix_dismissed_transactions_ledger_id'), 'dismissed_transactions', ['ledger_id'], unique=False)
    op.create_index(
        op.f('ix_dismissed_transactions_transaction_date'), 'dismissed_transactions', ['transaction_date'], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_dismissed_transactions_transaction_date'), table_name='dismissed_transactions')
    op.drop_index(op.f('ix_dismissed_transactions_ledger_id'), table_name='dismissed_transactions')
    op.drop_index(op.f('ix_dismissed_transactions_id'), table_name='dismissed_transactions')
    op.drop_table('dismissed_transactions')
