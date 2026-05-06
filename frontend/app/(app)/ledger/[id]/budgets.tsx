import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import type { BudgetStatus, Category } from '@/lib/types';

export default function BudgetsScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['budgets', 'status', ledgerId],
    queryFn: () => api<BudgetStatus[]>(`/api/ledgers/${ledgerId}/budgets/status`),
    enabled: !!ledgerId,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });

  const [editingId, setEditingId] = useState<'new' | string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (bid: string) =>
      api(`/api/ledgers/${ledgerId}/budgets/${bid}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['budgets', 'status', ledgerId] }),
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '삭제 실패';
      Alert.alert('오류', msg);
    },
  });

  if (statusQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '예산 관리' }} />

      <FlatList
        data={statusQuery.data ?? []}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={
          <Text style={styles.headerHint}>
            이번 달 기준입니다. 카테고리별 또는 전체 지출에 대한 예산을 설정할 수 있습니다.
          </Text>
        }
        renderItem={({ item }) => {
          const pct = Math.min(100, item.percent);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardLeft}>
                  <View style={[styles.colorDot, { backgroundColor: item.color }]} />
                  <Text style={styles.cardName}>{item.category_name}</Text>
                </View>
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    Alert.alert('예산 삭제', '예산을 삭제할까요?', [
                      { text: '취소', style: 'cancel' },
                      { text: '삭제', style: 'destructive', onPress: () => deleteMutation.mutate(item.id) },
                    ])
                  }
                >
                  <Text style={styles.deleteIcon}>🗑️</Text>
                </Pressable>
              </View>
              <View style={styles.barBg}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${pct}%`, backgroundColor: item.is_over ? '#DC2626' : item.percent > 80 ? '#F59E0B' : '#3B82F6' },
                  ]}
                />
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.amountUsed}>
                  {formatCurrency(item.spent)} / {formatCurrency(item.amount)}
                </Text>
                <Text style={[styles.percent, item.is_over && { color: '#DC2626' }]}>
                  {item.percent.toFixed(1)}%
                  {item.is_over ? ' 초과!' : ''}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>설정된 예산이 없습니다</Text>}
      />

      <Pressable style={styles.fab} onPress={() => setEditingId('new')}>
        <Text style={styles.fabText}>+ 예산 추가</Text>
      </Pressable>

      <BudgetEditor
        ledgerId={ledgerId!}
        categories={(categoriesQuery.data ?? []).filter((c) => c.type === 'expense')}
        existing={statusQuery.data ?? []}
        editing={editingId}
        onClose={() => setEditingId(null)}
      />
    </View>
  );
}

function BudgetEditor({
  ledgerId,
  categories,
  existing,
  editing,
  onClose,
}: {
  ledgerId: string;
  categories: Category[];
  existing: BudgetStatus[];
  editing: 'new' | string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');

  const usedCategoryIds = new Set(existing.map((e) => e.category_id));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const num = Number(amount);
      if (!num || num <= 0) throw new Error('금액을 입력하세요');
      return api(`/api/ledgers/${ledgerId}/budgets`, {
        method: 'POST',
        body: { category_id: categoryId, amount: num },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets', 'status', ledgerId] });
      setAmount('');
      setCategoryId(null);
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : (err as Error).message;
      Alert.alert('오류', msg);
    },
  });

  return (
    <Modal visible={editing === 'new'} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>예산 추가</Text>

          <Text style={styles.label}>대상</Text>
          <View style={styles.scopeRow}>
            <Pressable
              style={[styles.scopeButton, categoryId === null && styles.scopeButtonActive]}
              onPress={() => setCategoryId(null)}
              disabled={usedCategoryIds.has(null)}
            >
              <Text style={[styles.scopeText, categoryId === null && styles.scopeTextActive]}>
                전체 지출 {usedCategoryIds.has(null) ? '(사용 중)' : ''}
              </Text>
            </Pressable>
          </View>

          <View style={styles.categoryRow}>
            {categories.map((c) => {
              const used = usedCategoryIds.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  style={[
                    styles.chip,
                    { borderColor: c.color },
                    categoryId === c.id && { backgroundColor: c.color },
                    used && { opacity: 0.4 },
                  ]}
                  disabled={used}
                  onPress={() => setCategoryId(c.id)}
                >
                  <Text style={[styles.chipText, categoryId === c.id && { color: '#fff' }]}>
                    {c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>월 예산 금액 (KRW)</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
          />

          <View style={styles.actions}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.saveButton, saveMutation.isPending && { opacity: 0.6 }]}
              disabled={saveMutation.isPending || !amount}
              onPress={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>추가</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  headerHint: { color: '#6B7280', fontSize: 13, marginBottom: 12 },
  card: {
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  cardName: { fontSize: 15, fontWeight: '700' },
  deleteIcon: { fontSize: 16 },
  barBg: { height: 10, borderRadius: 5, backgroundColor: '#E5E7EB', overflow: 'hidden', marginBottom: 8 },
  barFill: { height: '100%' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  amountUsed: { fontSize: 13, color: '#374151' },
  percent: { fontSize: 13, fontWeight: '700', color: '#374151' },
  empty: { color: '#9CA3AF', textAlign: 'center', marginTop: 40 },
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
  },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 6, fontWeight: '600' },
  scopeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  scopeButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  scopeButtonActive: { backgroundColor: '#1F2937' },
  scopeText: { fontWeight: '600', color: '#6B7280' },
  scopeTextActive: { color: '#fff' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#F3F4F6' },
  cancelText: { color: '#6B7280', fontWeight: '600' },
  saveButton: { backgroundColor: '#3B82F6' },
  saveText: { color: '#fff', fontWeight: '700' },
});
