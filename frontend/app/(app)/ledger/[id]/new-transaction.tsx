import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { notify } from '@/lib/dialog';

import { TransactionForm, type TransactionFormValue } from '@/components/transaction-form';
import { ApiError, api, getErrorMessage } from '@/lib/api';
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
      queryClient.invalidateQueries({ queryKey: ['items'] });
      // router.back() 은 웹에서 히스토리 없으면 무동작 → 목록으로 확실히 이동
      router.replace(`/(app)/ledger/${ledgerId}`);
    },
    onError: (err) => {
      notify('오류', getErrorMessage(err, '거래 등록 실패'));
    },
  });

  return (
    <TransactionForm
      ledgerId={ledgerId!}
      categories={categoriesQuery.data ?? []}
      submitting={createMutation.isPending}
      submitLabel="저장"
      onSubmit={(value) => createMutation.mutate(value)}
    />
  );
}
