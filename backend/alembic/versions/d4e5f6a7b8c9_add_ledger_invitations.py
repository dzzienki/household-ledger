"""add ledger_invitations table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    role_enum = postgresql.ENUM('owner', 'editor', 'viewer', name='ledgerrole', create_type=False)

    op.create_table(
        'ledger_invitations',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('ledger_id', sa.UUID(), nullable=False),
        sa.Column('code', sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column('role', role_enum, nullable=False),
        sa.Column('created_by_id', sa.UUID(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('use_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('max_uses', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['created_by_id'], ['users.id']),
        sa.ForeignKeyConstraint(['ledger_id'], ['ledgers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_ledger_invitations_code'), 'ledger_invitations', ['code'], unique=True)
    op.create_index(op.f('ix_ledger_invitations_ledger_id'), 'ledger_invitations', ['ledger_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_ledger_invitations_ledger_id'), table_name='ledger_invitations')
    op.drop_index(op.f('ix_ledger_invitations_code'), table_name='ledger_invitations')
    op.drop_table('ledger_invitations')
