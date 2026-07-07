"""add tags, transaction_tags and exchange_rates

Revision ID: 2349fa03590f
Revises: c3c90878dac1
Create Date: 2026-07-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '2349fa03590f'
down_revision: Union[str, Sequence[str], None] = 'c3c90878dac1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('tags',
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('ledger_id', sa.Uuid(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(length=30), nullable=False),
    sa.Column('color', sqlmodel.sql.sqltypes.AutoString(length=7), nullable=False),
    sa.ForeignKeyConstraint(['ledger_id'], ['ledgers.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('ledger_id', 'name', name='uq_tag_ledger_name')
    )
    op.create_index(op.f('ix_tags_id'), 'tags', ['id'], unique=False)
    op.create_index(op.f('ix_tags_ledger_id'), 'tags', ['ledger_id'], unique=False)

    op.create_table('transaction_tags',
    sa.Column('transaction_id', sa.Uuid(), nullable=False),
    sa.Column('tag_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('transaction_id', 'tag_id')
    )

    op.create_table('exchange_rates',
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('ledger_id', sa.Uuid(), nullable=False),
    sa.Column('currency', sqlmodel.sql.sqltypes.AutoString(length=3), nullable=False),
    sa.Column('rate_to_base', sa.Numeric(precision=18, scale=8), nullable=False),
    sa.ForeignKeyConstraint(['ledger_id'], ['ledgers.id'], ),
    sa.PrimaryKeyConstraint('ledger_id', 'currency')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('exchange_rates')
    op.drop_table('transaction_tags')
    op.drop_index(op.f('ix_tags_ledger_id'), table_name='tags')
    op.drop_index(op.f('ix_tags_id'), table_name='tags')
    op.drop_table('tags')
