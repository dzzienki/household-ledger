import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AmountInput } from '@/components/amount-input';
import { ApiError, api } from '@/lib/api';
import { CATEGORY_COLOR_PALETTE } from '@/lib/colors';
import { confirmAsync, notify } from '@/lib/dialog';
import { formatCurrency } from '@/lib/format';
import type { BudgetStatus, Category, TransactionType } from '@/lib/types';

type CatEditing = { mode: 'create'; type: TransactionType } | { mode: 'edit'; category: Category };
type BudgetEditing = { categoryId: string | null; name: string; existing: BudgetStatus | null };

export default function BudgetsScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });

  const statusQuery = useQuery({
    queryKey: ['budgets', 'status', ledgerId],
    queryFn: () => api<BudgetStatus[]>(`/api/ledgers/${ledgerId}/budgets/status`),
    enabled: !!ledgerId,
  });

  const [catEditing, setCatEditing] = useState<CatEditing | null>(null);
  const [budgetEditing, setBudgetEditing] = useState<BudgetEditing | null>(null);

  const expense = (categoriesQuery.data ?? []).filter((c) => c.type === 'expense');
  const income = (categoriesQuery.data ?? []).filter((c) => c.type === 'income');
  const statusByCat = new Map((statusQuery.data ?? []).map((s) => [s.category_id, s]));
  const totalBudget = statusByCat.get(null) ?? null;

  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: string) =>
      api(`/api/ledgers/${ledgerId}/categories/${categoryId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'status', ledgerId] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '삭제 실패';
      notify('오류', msg);
    },
  });

  async function confirmDeleteCategory(category: Category) {
    if (
      await confirmAsync(
        '카테고리 삭제',
        `"${category.name}" 카테고리를 삭제할까요? 연결된 거래는 미분류로 남습니다.`,
        { confirmText: '삭제', destructive: true },
      )
    )
      deleteCategoryMutation.mutate(category.id);
  }

  if (categoriesQuery.isLoading || statusQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '예산 · 카테고리' }} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.hint}>
          카테고리를 추가하고, 지출 카테고리에는 이번 달 예산을 설정할 수 있어요. 진행률은 이번 달
          기준입니다.
        </Text>

        {/* 지출 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>지출</Text>
          <Pressable onPress={() => setCatEditing({ mode: 'create', type: 'expense' })} hitSlop={8}>
            <Text style={styles.addText}>+ 항목</Text>
          </Pressable>
        </View>

        {/* 전체 지출(총액) 예산 */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardLeft}>
              <View style={[styles.colorDot, { backgroundColor: '#1F2937' }]} />
              <Text style={styles.cardName}>전체 지출(총액)</Text>
            </View>
          </View>
          <BudgetInline
            status={totalBudget}
            onPress={() =>
              setBudgetEditing({ categoryId: null, name: '전체 지출(총액)', existing: totalBudget })
            }
          />
        </View>

        {expense.length === 0 && <Text style={styles.empty}>지출 카테고리가 없습니다</Text>}
        {expense.map((c) => {
          const status = statusByCat.get(c.id) ?? null;
          return (
            <View key={c.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Pressable style={styles.cardLeft} onPress={() => setCatEditing({ mode: 'edit', category: c })}>
                  <View style={[styles.colorDot, { backgroundColor: c.color }]} />
                  <Text style={styles.cardName}>{c.name}</Text>
                  <Text style={styles.editHint}>✎</Text>
                </Pressable>
                <Pressable onPress={() => confirmDeleteCategory(c)} hitSlop={8}>
                  <Text style={styles.deleteIcon}>🗑️</Text>
                </Pressable>
              </View>
              <BudgetInline
                status={status}
                onPress={() => setBudgetEditing({ categoryId: c.id, name: c.name, existing: status })}
              />
            </View>
          );
        })}

        {/* 수입 */}
        <View style={[styles.sectionHeader, { marginTop: 24 }]}>
          <Text style={styles.sectionTitle}>수입</Text>
          <Pressable onPress={() => setCatEditing({ mode: 'create', type: 'income' })} hitSlop={8}>
            <Text style={styles.addText}>+ 항목</Text>
          </Pressable>
        </View>

        {income.length === 0 && <Text style={styles.empty}>수입 카테고리가 없습니다</Text>}
        {income.map((c) => (
          <View key={c.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <Pressable style={styles.cardLeft} onPress={() => setCatEditing({ mode: 'edit', category: c })}>
                <View style={[styles.colorDot, { backgroundColor: c.color }]} />
                <Text style={styles.cardName}>{c.name}</Text>
                <Text style={styles.editHint}>✎</Text>
              </Pressable>
              <Pressable onPress={() => confirmDeleteCategory(c)} hitSlop={8}>
                <Text style={styles.deleteIcon}>🗑️</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      {catEditing && (
        <CategoryEditor
          key={catEditing.mode === 'edit' ? catEditing.category.id : `new-${catEditing.type}`}
          ledgerId={ledgerId!}
          editing={catEditing}
          onClose={() => setCatEditing(null)}
        />
      )}

      {budgetEditing && (
        <BudgetEditor
          key={budgetEditing.categoryId ?? 'total'}
          ledgerId={ledgerId!}
          editing={budgetEditing}
          onClose={() => setBudgetEditing(null)}
        />
      )}
    </View>
  );
}

function BudgetInline({ status, onPress }: { status: BudgetStatus | null; onPress: () => void }) {
  if (!status) {
    return (
      <Pressable style={styles.addBudget} onPress={onPress}>
        <Text style={styles.addBudgetText}>+ 예산 설정</Text>
      </Pressable>
    );
  }
  const pct = Math.min(100, status.percent);
  const barColor = status.is_over ? '#DC2626' : status.percent > 80 ? '#F59E0B' : '#3B82F6';
  return (
    <Pressable onPress={onPress}>
      {status.memo ? <Text style={styles.budgetMemo}>{status.memo}</Text> : null}
      <View style={styles.barBg}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <View style={styles.budgetFooter}>
        <Text style={styles.amountUsed}>
          {formatCurrency(status.spent)} / {formatCurrency(status.amount)}
        </Text>
        <Text style={[styles.percent, status.is_over && { color: '#DC2626' }]}>
          {status.percent.toFixed(1)}%{status.is_over ? ' 초과!' : ''}
        </Text>
      </View>
    </Pressable>
  );
}

function CategoryEditor({
  ledgerId,
  editing,
  onClose,
}: {
  ledgerId: string;
  editing: CatEditing;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = editing.mode === 'edit';
  const initial = editing.mode === 'edit' ? editing.category : null;

  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLOR_PALETTE[0]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (editing.mode === 'create') {
        await api(`/api/ledgers/${ledgerId}/categories`, {
          method: 'POST',
          body: { name, type: editing.type, color },
        });
      } else {
        await api(`/api/ledgers/${ledgerId}/categories/${editing.category.id}`, {
          method: 'PATCH',
          body: { name, color },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['budgets', 'status', ledgerId] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '저장 실패';
      notify('오류', msg);
    },
  });

  const addingType = editing.mode === 'create' ? editing.type : null;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>
            {isEdit ? '카테고리 수정' : `${addingType === 'expense' ? '지출' : '수입'} 카테고리 추가`}
          </Text>

          <Text style={styles.label}>이름</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="예: 식비" />

          <Text style={styles.label}>색상</Text>
          <View style={styles.palette}>
            {CATEGORY_COLOR_PALETTE.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchSelected]}
              />
            ))}
          </View>

          <View style={styles.modalActions}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.saveButton, mutation.isPending && { opacity: 0.6 }]}
              disabled={mutation.isPending || !name.trim()}
              onPress={() => mutation.mutate()}
            >
              {mutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>{isEdit ? '저장' : '추가'}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function BudgetEditor({
  ledgerId,
  editing,
  onClose,
}: {
  ledgerId: string;
  editing: BudgetEditing;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const existing = editing.existing;
  const [amount, setAmount] = useState(existing ? String(Number(existing.amount)) : '');
  const [memo, setMemo] = useState(existing?.memo ?? '');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['budgets', 'status', ledgerId] });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const num = Number(amount);
      if (!num || num <= 0) throw new Error('금액을 입력하세요');
      if (existing) {
        return api(`/api/ledgers/${ledgerId}/budgets/${existing.id}`, {
          method: 'PATCH',
          body: { amount: num, memo: memo.trim() || null },
        });
      }
      return api(`/api/ledgers/${ledgerId}/budgets`, {
        method: 'POST',
        body: { category_id: editing.categoryId, amount: num, memo: memo.trim() || null },
      });
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : (err as Error).message;
      notify('오류', msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/api/ledgers/${ledgerId}/budgets/${existing!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '삭제 실패';
      notify('오류', msg);
    },
  });

  async function askDelete() {
    if (await confirmAsync('예산 삭제', `"${editing.name}" 예산을 삭제할까요?`, { confirmText: '삭제', destructive: true }))
      deleteMutation.mutate();
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{editing.name} 예산</Text>

          <Text style={styles.label}>월 예산 금액 (KRW)</Text>
          <AmountInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="0" />

          <Text style={styles.label}>문구 (선택)</Text>
          <TextInput
            style={styles.input}
            value={memo}
            onChangeText={setMemo}
            placeholder="예: 이번 달 외식비 아끼기"
            maxLength={100}
          />

          <View style={styles.modalActions}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.saveButton, saveMutation.isPending && { opacity: 0.6 }]}
              disabled={saveMutation.isPending || !amount}
              onPress={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>{existing ? '저장' : '추가'}</Text>
              )}
            </Pressable>
          </View>

          {existing && (
            <Pressable style={styles.deleteButton} onPress={askDelete}>
              <Text style={styles.deleteButtonText}>예산 삭제</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  hint: { color: '#6B7280', fontSize: 13, marginBottom: 16, lineHeight: 19 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  addText: { color: '#3B82F6', fontWeight: '700', fontSize: 15 },
  empty: { color: '#9CA3AF', paddingVertical: 8 },
  card: {
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  cardName: { fontSize: 15, fontWeight: '700' },
  editHint: { fontSize: 12, color: '#9CA3AF' },
  deleteIcon: { fontSize: 16 },
  addBudget: { marginTop: 10 },
  addBudgetText: { color: '#3B82F6', fontWeight: '600', fontSize: 14 },
  budgetMemo: { fontSize: 12, color: '#6B7280', marginTop: 10, marginBottom: 2 },
  barBg: { height: 10, borderRadius: 5, backgroundColor: '#E5E7EB', overflow: 'hidden', marginTop: 10, marginBottom: 8 },
  barFill: { height: '100%' },
  budgetFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  amountUsed: { fontSize: 13, color: '#374151' },
  percent: { fontSize: 13, fontWeight: '700', color: '#374151' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 6, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  swatchSelected: { borderWidth: 3, borderColor: '#1F2937' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#F3F4F6' },
  cancelText: { color: '#6B7280', fontWeight: '600' },
  saveButton: { backgroundColor: '#3B82F6' },
  saveText: { color: '#fff', fontWeight: '700' },
  deleteButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  deleteButtonText: { color: '#DC2626', fontSize: 15, fontWeight: '700' },
});
