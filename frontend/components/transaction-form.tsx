import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Category, Transaction, TransactionType } from '@/lib/types';

export interface TransactionFormValue {
  type: TransactionType;
  amount: number;
  transaction_date: string;
  category_id: string | null;
  payee: string | null;
  memo: string | null;
}

interface Props {
  initial?: Transaction | null;
  categories: Category[];
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (value: TransactionFormValue) => void;
  onDelete?: () => void;
  deleting?: boolean;
}

export function TransactionForm({
  initial,
  categories,
  submitting,
  submitLabel = '저장',
  onSubmit,
  onDelete,
  deleting,
}: Props) {
  const [type, setType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [amount, setAmount] = useState(initial ? String(Number(initial.amount)) : '');
  const [payee, setPayee] = useState(initial?.payee ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id ?? null);
  const [transactionDate, setTransactionDate] = useState(
    initial?.transaction_date ?? new Date().toISOString().slice(0, 10),
  );

  useEffect(() => {
    if (categoryId) {
      const c = categories.find((x) => x.id === categoryId);
      if (c && c.type !== type) setCategoryId(null);
    }
  }, [type, categoryId, categories]);

  const filteredCategories = categories.filter((c) => c.type === type);

  function handleSubmit() {
    const num = Number(amount);
    if (!num || num <= 0) {
      Alert.alert('입력 오류', '금액을 입력하세요');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
      Alert.alert('입력 오류', '날짜는 YYYY-MM-DD 형식이어야 합니다');
      return;
    }
    onSubmit({
      type,
      amount: num,
      transaction_date: transactionDate,
      category_id: categoryId,
      payee: payee.trim() || null,
      memo: memo.trim() || null,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.typeRow}>
        {(['expense', 'income'] as TransactionType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.typeButton, type === t && styles.typeButtonActive]}
            onPress={() => setType(t)}
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

      <Text style={styles.label}>날짜</Text>
      <TextInput
        style={styles.input}
        placeholder="YYYY-MM-DD"
        value={transactionDate}
        onChangeText={setTransactionDate}
        autoCapitalize="none"
      />

      <Text style={styles.label}>카테고리</Text>
      <View style={styles.categoryRow}>
        {filteredCategories.length === 0 ? (
          <Text style={styles.emptyHint}>카테고리가 없습니다 (미분류로 저장됩니다)</Text>
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
              <Text style={[styles.chipText, categoryId === c.id && { color: '#fff' }]}>{c.name}</Text>
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
        style={[styles.submit, submitting && styles.submitDisabled]}
        disabled={submitting}
        onPress={handleSubmit}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{submitLabel}</Text>}
      </Pressable>

      {onDelete && (
        <Pressable
          style={[styles.delete, deleting && styles.submitDisabled]}
          disabled={deleting}
          onPress={onDelete}
        >
          {deleting ? <ActivityIndicator color="#DC2626" /> : <Text style={styles.deleteText}>거래 삭제</Text>}
        </Pressable>
      )}
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
  delete: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  deleteText: { color: '#DC2626', fontSize: 15, fontWeight: '700' },
});
