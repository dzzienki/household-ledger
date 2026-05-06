export type LedgerType = 'personal' | 'shared';
export type LedgerRole = 'owner' | 'editor' | 'viewer';
export type TransactionType = 'income' | 'expense';

export interface User {
  id: string;
  email: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Ledger {
  id: string;
  name: string;
  type: LedgerType;
  owner_id: string;
  currency: string;
  created_at: string;
}

export interface LedgerMember {
  user_id: string;
  role: LedgerRole;
  created_at: string;
}

export interface Category {
  id: string;
  ledger_id: string;
  name: string;
  type: TransactionType;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
}

export interface Transaction {
  id: string;
  ledger_id: string;
  category_id: string | null;
  created_by_id: string;
  type: TransactionType;
  amount: string;
  currency: string;
  transaction_date: string;
  payee: string | null;
  memo: string | null;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}
