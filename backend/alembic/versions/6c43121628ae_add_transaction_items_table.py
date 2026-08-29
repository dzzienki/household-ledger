"""add transaction_items table

Revision ID: 6c43121628ae
Revises: d4e5f6a7b8c9
Create Date: 2026-08-29 13:17:15.259553

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel

# revision identifiers, used by Alembic.
revision: str = '6c43121628ae'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'transaction_items',
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('transaction_id', sa.Uuid(), nullable=False),
        sa.Column('ledger_id', sa.Uuid(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
        sa.Column('item_group', sqlmodel.sql.sqltypes.AutoString(length=100), nullable=True),
        sa.Column('quantity', sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column('unit_price', sa.Numeric(precision=15, scale=2), nullable=True),
        sa.Column('total_price', sa.Numeric(precision=15, scale=2), nullable=False),
        sa.Column('memo', sqlmodel.sql.sqltypes.AutoString(length=200), nullable=True),
        sa.ForeignKeyConstraint(['ledger_id'], ['ledgers.id'], ),
        sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_transaction_items_id'), 'transaction_items', ['id'], unique=False)
    op.create_index(op.f('ix_transaction_items_item_group'), 'transaction_items', ['item_group'], unique=False)
    op.create_index(op.f('ix_transaction_items_ledger_id'), 'transaction_items', ['ledger_id'], unique=False)
    op.create_index(op.f('ix_transaction_items_transaction_id'), 'transaction_items', ['transaction_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_transaction_items_transaction_id'), table_name='transaction_items')
    op.drop_index(op.f('ix_transaction_items_ledger_id'), table_name='transaction_items')
    op.drop_index(op.f('ix_transaction_items_item_group'), table_name='transaction_items')
    op.drop_index(op.f('ix_transaction_items_id'), table_name='transaction_items')
    op.drop_table('transaction_items')
    # ### end Alembic commands ###
