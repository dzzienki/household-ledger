import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, api } from '@/lib/api';
import type { Category, Transaction, TransactionType } from '@/lib/types';

export default function NewTransactionScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [payee, setPayee] = useState('');
  const [memo, setMemo] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [transactionDate] = useState(() => new Date().toISOString().slice(0, 10));

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });

  const filteredCategories = (categoriesQuery.data ?? []).filter((c) => c.type === type);

  const createMutation = useMutation({
    mutationFn: (body: unknown) =>
      api<Transaction>(`/api/ledgers/${ledgerId}/transactions`, { method: 'POST', body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      router.back();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '거래 등록에 실패했습니다';
      Alert.alert('오류', msg);
    },
  });

  function onSubmit() {
    const num = Number(amount);
    if (!num || num <= 0) {
      Alert.alert('입력 오류', '금액을 입력하세요');
      return;
    }
    createMutation.mutate({
      type,
      amount: num,
      transaction_date: transactionDate,
      category_id: categoryId,
      payee: payee || null,
      memo: memo || null,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.typeRow}>
        {(['expense', 'income'] as TransactionType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.typeButton, type === t && styles.typeButtonActive]}
            onPress={() => {
              setType(t);
              setCategoryId(null);
            }}
          >
            <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
              {t === 'expense' ? '지출' : '수입'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>금액</Text>
      <TextInput
        style={styles.input}
        keyboardType="numeric"
        placeholder="0"
        value={amount}
        onChangeText={setAmount}
      />

      <Text style={styles.label}>카테고리</Text>
      <View style={styles.categoryRow}>
        {filteredCategories.length === 0 ? (
          <Text style={styles.emptyHint}>
            카테고리가 없습니다. (지금은 미분류로 저장됩니다)
          </Text>
        ) : (
          filteredCategories.map((c) => (
            <Pressable
              key={c.id}
              style={[
                styles.chip,
                { borderColor: c.color },
                categoryId === c.id && { backgroundColor: c.color },
              ]}
              onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
            >
              <Text
                style={[
                  styles.chipText,
                  categoryId === c.id && { color: '#fff' },
                ]}
              >
                {c.name}
              </Text>
            </Pressable>
          ))
        )}
      </View>

      <Text style={styles.label}>거래처</Text>
      <TextInput
        style={styles.input}
        placeholder="예: 스타벅스"
        value={payee}
        onChangeText={setPayee}
      />

      <Text style={styles.label}>메모</Text>
      <TextInput
        style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
        placeholder="(선택)"
        multiline
        value={memo}
        onChangeText={setMemo}
      />

      <Pressable
        style={[styles.submit, createMutation.isPending && styles.submitDisabled]}
        disabled={createMutation.isPending}
        onPress={onSubmit}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>저장</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, paddingBottom: 60 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  typeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  typeButtonActive: { backgroundColor: '#1F2937' },
  typeText: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  typeTextActive: { color: '#fff' },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 6, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyHint: { color: '#9CA3AF', fontSize: 13 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  submit: {
    marginTop: 28,
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
