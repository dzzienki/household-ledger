"""monthly checklist history + web push tables

Revision ID: e5f6a7b8c9d0
Revises: 6c43121628ae
Create Date: 2026-10-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = '6c43121628ae'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        'recurring_checks',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('recurring_id', sa.UUID(), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('checked_funded', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('checked_paid', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('checked_amount', sa.Boolean(), nullable=False, server_default=sa.false()),
        *_timestamps(),
        sa.ForeignKeyConstraint(['recurring_id'], ['recurring_transactions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('recurring_id', 'period', name='uq_recurring_checks_rule_period'),
    )
    op.create_index(op.f('ix_recurring_checks_id'), 'recurring_checks', ['id'], unique=False)
    op.create_index(op.f('ix_recurring_checks_recurring_id'), 'recurring_checks', ['recurring_id'], unique=False)

    # Carry over the current-cycle checks so nothing ticked this month is lost.
    # Only 'YYYY-MM' (monthly) keys map onto the new per-month model.
    op.execute(
        """
        INSERT INTO recurring_checks (id, recurring_id, period, checked_funded, checked_paid, checked_amount)
        SELECT gen_random_uuid(), id, checklist_period, checked_funded, checked_paid, checked_amount
        FROM recurring_transactions
        WHERE checklist_period ~ '^[0-9]{4}-[0-9]{2}$'
          AND (checked_funded OR checked_paid OR checked_amount)
        """
    )

    op.drop_column('recurring_transactions', 'checklist_period')
    op.drop_column('recurring_transactions', 'checked_amount')
    op.drop_column('recurring_transactions', 'checked_paid')
    op.drop_column('recurring_transactions', 'checked_funded')

    op.add_column('users', sa.Column('notify_days_before', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('users', sa.Column('notify_hour', sa.Integer(), nullable=False, server_default='9'))

    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('endpoint', sa.Text(), nullable=False),
        sa.Column('p256dh', sa.String(length=255), nullable=False),
        sa.Column('auth', sa.String(length=255), nullable=False),
        sa.Column('user_agent', sa.String(length=500), nullable=False, server_default=''),
        *_timestamps(),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('endpoint'),
    )
    op.create_index(op.f('ix_push_subscriptions_id'), 'push_subscriptions', ['id'], unique=False)
    op.create_index(op.f('ix_push_subscriptions_user_id'), 'push_subscriptions', ['user_id'], unique=False)

    op.create_table(
        'notification_logs',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('user_id', sa.UUID(), nullable=False),
        sa.Column('recurring_id', sa.UUID(), nullable=False),
        sa.Column('period', sa.String(length=7), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recurring_id'], ['recurring_transactions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'recurring_id', 'period', 'kind', name='uq_notification_logs_dedupe'),
    )
    op.create_index(op.f('ix_notification_logs_id'), 'notification_logs', ['id'], unique=False)
    op.create_index(op.f('ix_notification_logs_user_id'), 'notification_logs', ['user_id'], unique=False)

    op.create_table(
        'app_settings',
        sa.Column('key', sa.String(length=64), nullable=False),
        sa.Column('value', sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )


def downgrade() -> None:
    op.drop_table('app_settings')
    op.drop_index(op.f('ix_notification_logs_user_id'), table_name='notification_logs')
    op.drop_index(op.f('ix_notification_logs_id'), table_name='notification_logs')
    op.drop_table('notification_logs')
    op.drop_index(op.f('ix_push_subscriptions_user_id'), table_name='push_subscriptions')
    op.drop_index(op.f('ix_push_subscriptions_id'), table_name='push_subscriptions')
    op.drop_table('push_subscriptions')

    op.drop_column('users', 'notify_hour')
    op.drop_column('users', 'notify_days_before')

    op.add_column('recurring_transactions', sa.Column('checked_funded', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('recurring_transactions', sa.Column('checked_paid', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('recurring_transactions', sa.Column('checked_amount', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('recurring_transactions', sa.Column('checklist_period', sqlmodel.sql.sqltypes.AutoString(length=10), nullable=True))

    op.drop_index(op.f('ix_recurring_checks_recurring_id'), table_name='recurring_checks')
    op.drop_index(op.f('ix_recurring_checks_id'), table_name='recurring_checks')
    op.drop_table('recurring_checks')
