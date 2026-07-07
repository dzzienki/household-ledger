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
  email: string;
  name: string;
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

export interface Tag {
  id: string;
  ledger_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface ExchangeRate {
  currency: string;
  rate_to_base: string;
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
  tags: Tag[];
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  ledger_id: string;
  category_id: string | null;
  type: TransactionType;
  amount: string;
  currency: string;
  payee: string | null;
  memo: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  start_date: string;
  end_date: string | null;
  next_due_date: string;
  active: boolean;
  created_at: string;
}

export interface Budget {
  id: string;
  ledger_id: string;
  category_id: string | null;
  amount: string;
  currency: string;
  memo: string | null;
  created_at: string;
}

export interface BudgetStatus {
  id: string;
  category_id: string | null;
  category_name: string;
  color: string;
  amount: string;
  spent: string;
  remaining: string;
  percent: number;
  is_over: boolean;
  memo: string | null;
}

export interface CategorySuggestion {
  category_id: string | null;
  category_name: string | null;
  confidence: number;
  reasoning: string;
}

export interface ReceiptExtraction {
  amount: number | null;
  transaction_date: string | null;
  payee: string | null;
  memo: string | null;
  suggested_category_name: string | null;
  confidence: number;
  reasoning: string;
}
