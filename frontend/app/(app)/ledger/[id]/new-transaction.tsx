import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { TransactionForm, type TransactionFormValue } from '@/components/transaction-form';
import { ApiError, api } from '@/lib/api';
import type { Category, Transaction } from '@/lib/types';

export default function NewTransactionScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });

  const createMutation = useMutation({
    mutationFn: (body: TransactionFormValue) =>
      api<Transaction>(`/api/ledgers/${ledgerId}/transactions`, { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      router.back();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '거래 등록 실패';
      Alert.alert('오류', msg);
    },
  });

  return (
    <TransactionForm
      categories={categoriesQuery.data ?? []}
      submitting={createMutation.isPending}
      submitLabel="저장"
      onSubmit={(value) => createMutation.mutate(value)}
    />
  );
}
