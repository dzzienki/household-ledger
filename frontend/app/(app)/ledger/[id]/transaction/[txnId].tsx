import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { confirmAsync, notify } from '@/lib/dialog';

import { TransactionForm, type TransactionFormValue } from '@/components/transaction-form';
import { ApiError, api } from '@/lib/api';
import type { Category, Transaction } from '@/lib/types';

export default function EditTransactionScreen() {
  const { id: ledgerId, txnId } = useLocalSearchParams<{ id: string; txnId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const txnQuery = useQuery({
    queryKey: ['transaction', ledgerId, txnId],
    queryFn: () =>
      api<Transaction>(`/api/ledgers/${ledgerId}/transactions/${txnId}`),
    enabled: !!ledgerId && !!txnId,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
    queryClient.invalidateQueries({ queryKey: ['transaction', ledgerId, txnId] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }

  const updateMutation = useMutation({
    mutationFn: (body: TransactionFormValue) =>
      api<Transaction>(`/api/ledgers/${ledgerId}/transactions/${txnId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '수정 실패';
      notify('오류', msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api(`/api/ledgers/${ledgerId}/transactions/${txnId}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      router.back();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '삭제 실패';
      notify('오류', msg);
    },
  });

  async function confirmDelete() {
    if (await confirmAsync('거래 삭제', '이 거래를 삭제할까요?', { confirmText: '삭제', destructive: true }))
      deleteMutation.mutate();
  }

  if (txnQuery.isLoading || categoriesQuery.isLoading || !txnQuery.data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
        <Stack.Screen options={{ title: '거래 수정' }} />
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: '거래 수정' }} />
      <TransactionForm
        ledgerId={ledgerId!}
        initial={txnQuery.data}
        categories={categoriesQuery.data ?? []}
        submitting={updateMutation.isPending}
        submitLabel="저장"
        onSubmit={(value) => updateMutation.mutate(value)}
        onDelete={confirmDelete}
        deleting={deleteMutation.isPending}
      />
    </>
  );
}
