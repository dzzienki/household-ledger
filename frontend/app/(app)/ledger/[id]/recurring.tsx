import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { confirmAsync, notify } from '@/lib/dialog';

import { AmountInput } from '@/components/amount-input';
import { ApiError, api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import {
  WEEKDAYS,
  computeStartDate,
  describeSchedule,
  monthMaxDay,
  scheduleFromDate,
} from '@/lib/recurrence';
import type { Category, RecurrenceFrequency, RecurringTransaction, TransactionType } from '@/lib/types';

const FREQ_LABEL: Record<RecurrenceFrequency, string> = {
  daily: '매일',
  weekly: '매주',
  monthly: '매월',
  yearly: '매년',
};

type ChecklistField = 'checked_funded' | 'checked_paid' | 'checked_amount';

const CHECKLIST: { key: ChecklistField; label: string }[] = [
  { key: 'checked_funded', label: '이체' },
  { key: 'checked_paid', label: '납부' },
  { key: 'checked_amount', label: '금액' },
];

export default function RecurringScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({
    queryKey: ['recurring', ledgerId],
    queryFn: () => api<RecurringTransaction[]>(`/api/ledgers/${ledgerId}/recurring`),
    enabled: !!ledgerId,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });

  const [editing, setEditing] = useState<RecurringTransaction | 'new' | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (rid: string) =>
      api(`/api/ledgers/${ledgerId}/recurring/${rid}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring', ledgerId] }),
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '삭제 실패';
      notify('오류', msg);
    },
  });

  const checklistMutation = useMutation({
    mutationFn: ({ id, field, value }: { id: string; field: ChecklistField; value: boolean }) =>
      api(`/api/ledgers/${ledgerId}/recurring/${id}/checklist`, {
        method: 'PATCH',
        body: { [field]: value },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recurring', ledgerId] }),
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '변경 실패';
      notify('오류', msg);
    },
  });

  const categoriesById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c]));

  if (rulesQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '반복 거래' }} />

      <FlatList
        data={rulesQuery.data ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListHeaderComponent={
          (rulesQuery.data ?? []).length > 0 ? (
            <Text style={styles.legend}>
              자동이체 체크리스트 — 이체(통장에 입금) · 납부(출금 완료) · 금액(고지서 대조). 매 회차마다
              자동으로 초기화됩니다.
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const cat = item.category_id ? categoriesById.get(item.category_id) : null;
          return (
            <View style={[styles.row, !item.active && { opacity: 0.55 }]}>
              <View style={{ flex: 1 }}>
                <Pressable onPress={() => setEditing(item)}>
                  <View style={styles.rowTopLine}>
                    <View style={[styles.colorDot, { backgroundColor: cat?.color ?? '#9CA3AF' }]} />
                    <Text style={styles.rowTitle}>
                      {item.title || item.payee || cat?.name || '(제목 없음)'}
                    </Text>
                    <Text
                      style={[
                        styles.amount,
                        { color: item.type === 'income' ? '#16A34A' : '#DC2626' },
                      ]}
                    >
                      {item.type === 'income' ? '+' : '-'}
                      {formatCurrency(item.amount, item.currency)}
                    </Text>
                  </View>
                  <Text style={styles.rowMeta}>
                    {describeSchedule(item.frequency, item.start_date)} · 다음: {item.next_due_date}
                    {!item.active ? ' · 비활성' : ''}
                  </Text>
                  {item.payee ? (
                    <Text style={styles.rowPayee}>
                      <Text style={styles.rowFieldLabel}>거래처</Text> {item.payee}
                    </Text>
                  ) : null}
                  {item.memo ? <Text style={styles.rowMemo}>{item.memo}</Text> : null}
                </Pressable>
                <View style={styles.checkRow}>
                  {CHECKLIST.map((c) => {
                    const on = item[c.key];
                    return (
                      <Pressable
                        key={c.key}
                        style={[styles.checkChip, on && styles.checkChipOn]}
                        onPress={() => checklistMutation.mutate({ id: item.id, field: c.key, value: !on })}
                        hitSlop={4}
                      >
                        <Text style={[styles.checkText, on && styles.checkTextOn]}>
                          {on ? '✓' : '○'} {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <Pressable
                onPress={async () => {
                  if (await confirmAsync('반복 규칙 삭제', '삭제하시겠습니까?', { confirmText: '삭제', destructive: true }))
                    deleteMutation.mutate(item.id);
                }}
                hitSlop={8}
              >
                <Text style={styles.deleteIcon}>🗑️</Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.empty}>등록된 반복 거래가 없습니다</Text>
        }
      />

      <Pressable style={styles.fab} onPress={() => setEditing('new')}>
        <Text style={styles.fabText}>+ 반복 거래 추가</Text>
      </Pressable>

      {editing && (
        <RecurringEditor
          key={editing === 'new' ? 'new' : editing.id}
          ledgerId={ledgerId!}
          categories={categoriesQuery.data ?? []}
          editing={editing}
          onClose={() => setEditing(null)}
          onDelete={
            editing !== 'new'
              ? async () => {
                  if (
                    await confirmAsync('반복 규칙 삭제', '삭제하시겠습니까?', {
                      confirmText: '삭제',
                      destructive: true,
                    })
                  ) {
                    deleteMutation.mutate(editing.id);
                    setEditing(null);
                  }
                }
              : undefined
          }
        />
      )}
    </View>
  );
}

function RecurringEditor({
  ledgerId,
  categories,
  editing,
  onClose,
  onDelete,
}: {
  ledgerId: string;
  categories: Category[];
  editing: RecurringTransaction | 'new' | null;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = editing && editing !== 'new';
  const initial = isEdit ? (editing as RecurringTransaction) : null;

  const initialSchedule = scheduleFromDate(initial?.start_date ?? null);

  const [type, setType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [amount, setAmount] = useState(initial ? String(Number(initial.amount)) : '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [payee, setPayee] = useState(initial?.payee ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id ?? null);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(initial?.frequency ?? 'monthly');
  const [weekday, setWeekday] = useState(initialSchedule.weekday);
  const [monthDay, setMonthDay] = useState(initialSchedule.day);
  const [yearMonth, setYearMonth] = useState(initialSchedule.month);
  const [endDate, setEndDate] = useState(initial?.end_date ?? '');
  const [active, setActive] = useState(initial?.active ?? true);

  const filteredCategories = categories.filter((c) => c.type === type);

  const startDate = computeStartDate(frequency, { weekday, day: monthDay, month: yearMonth });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        type,
        amount: Number(amount),
        category_id: categoryId,
        title: title.trim() || null,
        payee: payee.trim() || null,
        memo: memo.trim() || null,
        frequency,
        interval: 1,
        start_date: startDate,
        end_date: endDate || null,
      };
      if (isEdit) {
        body.active = active;
        const { type: _t, amount: _a, ...patch } = body as any;
        return api(`/api/ledgers/${ledgerId}/recurring/${initial!.id}`, {
          method: 'PATCH',
          body: { ...patch, amount: body.amount },
        });
      }
      return api(`/api/ledgers/${ledgerId}/recurring`, { method: 'POST', body });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '저장 실패';
      notify('오류', msg);
    },
  });

  function onSubmit() {
    if (!amount || Number(amount) <= 0) {
      notify('입력 오류', '금액을 입력하세요');
      return;
    }
    if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      notify('입력 오류', '종료일 형식: YYYY-MM-DD');
      return;
    }
    saveMutation.mutate();
  }

  return (
    <Modal visible={!!editing} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
            <Text style={styles.modalTitle}>{isEdit ? '반복 거래 수정' : '반복 거래 추가'}</Text>

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
            <AmountInput style={styles.input} value={amount} onChangeText={setAmount} />

            <Text style={styles.label}>주기</Text>
            <View style={styles.freqRow}>
              {(['daily', 'weekly', 'monthly', 'yearly'] as RecurrenceFrequency[]).map((f) => (
                <Pressable
                  key={f}
                  style={[styles.freqButton, frequency === f && styles.freqButtonActive]}
                  onPress={() => setFrequency(f)}
                >
                  <Text style={[styles.freqText, frequency === f && styles.freqTextActive]}>{FREQ_LABEL[f]}</Text>
                </Pressable>
              ))}
            </View>

            {frequency === 'daily' && <Text style={[styles.hint, { marginTop: 10 }]}>매일 반복됩니다.</Text>}

            {frequency === 'weekly' && (
              <>
                <Text style={styles.label}>요일</Text>
                <View style={styles.pickerRow}>
                  {WEEKDAYS.map((w, i) => (
                    <Pressable
                      key={i}
                      style={[styles.dayChip, weekday === i && styles.dayChipActive]}
                      onPress={() => setWeekday(i)}
                    >
                      <Text style={[styles.dayChipText, weekday === i && styles.dayChipTextActive]}>{w}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {frequency === 'monthly' && (
              <>
                <Text style={styles.label}>매월 며칠</Text>
                <View style={styles.pickerRow}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <Pressable
                      key={d}
                      style={[styles.dayChip, monthDay === d && styles.dayChipActive]}
                      onPress={() => setMonthDay(d)}
                    >
                      <Text style={[styles.dayChipText, monthDay === d && styles.dayChipTextActive]}>{d}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.hint, { marginTop: 6 }]}>29~31일은 매월 있지 않아 선택할 수 없어요.</Text>
              </>
            )}

            {frequency === 'yearly' && (
              <>
                <Text style={styles.label}>월</Text>
                <View style={styles.pickerRow}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.dayChip, yearMonth === m && styles.dayChipActive]}
                      onPress={() => {
                        setYearMonth(m);
                        setMonthDay((d) => Math.min(d, monthMaxDay(m)));
                      }}
                    >
                      <Text style={[styles.dayChipText, yearMonth === m && styles.dayChipTextActive]}>{m}월</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.label}>일</Text>
                <View style={styles.pickerRow}>
                  {Array.from({ length: monthMaxDay(yearMonth) }, (_, i) => i + 1).map((d) => (
                    <Pressable
                      key={d}
                      style={[styles.dayChip, monthDay === d && styles.dayChipActive]}
                      onPress={() => setMonthDay(d)}
                    >
                      <Text style={[styles.dayChipText, monthDay === d && styles.dayChipTextActive]}>{d}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={[styles.hint, { marginTop: 10 }]}>첫 등록 예정일: {startDate}</Text>

            <Text style={styles.label}>종료일 (선택)</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={endDate}
              onChangeText={setEndDate}
              autoCapitalize="none"
            />

            <Text style={styles.label}>카테고리</Text>
            <View style={styles.categoryRow}>
              {filteredCategories.length === 0 ? (
                <Text style={styles.hint}>카테고리가 없습니다</Text>
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

            <Text style={styles.label}>제목</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="예: 넷플릭스 구독"
              maxLength={100}
            />

            <Text style={styles.label}>거래처</Text>
            <TextInput style={styles.input} value={payee} onChangeText={setPayee} placeholder="예: Netflix" />

            <Text style={styles.label}>메모</Text>
            <TextInput style={styles.input} value={memo} onChangeText={setMemo} placeholder="(선택)" />

            {isEdit && (
              <Pressable style={styles.toggleRow} onPress={() => setActive(!active)}>
                <Text style={styles.toggleLabel}>활성</Text>
                <View style={[styles.toggle, active && styles.toggleOn]}>
                  <View style={[styles.toggleKnob, active && styles.toggleKnobOn]} />
                </View>
              </Pressable>
            )}

            <View style={styles.actions}>
              <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={onClose}>
                <Text style={styles.cancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[styles.modalButton, styles.saveButton, saveMutation.isPending && { opacity: 0.6 }]}
                disabled={saveMutation.isPending}
                onPress={onSubmit}
              >
                {saveMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>저장</Text>}
              </Pressable>
            </View>

            {onDelete && (
              <Pressable style={styles.deleteButton} onPress={onDelete}>
                <Text style={styles.deleteButtonText}>반복 거래 삭제</Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    gap: 8,
  },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  colorDot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  amount: { fontSize: 15, fontWeight: '700' },
  rowMeta: { fontSize: 12, color: '#6B7280', marginTop: 4, marginLeft: 18 },
  rowPayee: { fontSize: 12, color: '#4B5563', marginTop: 3, marginLeft: 18 },
  rowFieldLabel: { color: '#9CA3AF', fontWeight: '700' },
  rowMemo: { fontSize: 11, color: '#9CA3AF', marginTop: 2, marginLeft: 18 },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginLeft: 18 },
  checkChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  checkChipOn: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  checkText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  checkTextOn: { color: '#15803D' },
  legend: { fontSize: 12, color: '#6B7280', lineHeight: 18, marginBottom: 12 },
  deleteIcon: { fontSize: 18, paddingHorizontal: 4 },
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
  modalCard: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 6, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  typeButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#F3F4F6' },
  typeButtonActive: { backgroundColor: '#1F2937' },
  typeText: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  typeTextActive: { color: '#fff' },
  freqRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  freqButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#F3F4F6' },
  freqButtonActive: { backgroundColor: '#1F2937' },
  freqText: { fontWeight: '600', color: '#6B7280' },
  freqTextActive: { color: '#fff' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { color: '#9CA3AF', fontSize: 13 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  dayChipActive: { backgroundColor: '#3B82F6' },
  dayChipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  dayChipTextActive: { color: '#fff' },
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    marginTop: 8,
  },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  toggle: { width: 44, height: 26, borderRadius: 13, backgroundColor: '#D1D5DB', padding: 2 },
  toggleOn: { backgroundColor: '#3B82F6' },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  toggleKnobOn: { transform: [{ translateX: 18 }] },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#F3F4F6' },
  cancelText: { color: '#6B7280', fontWeight: '600' },
  saveButton: { backgroundColor: '#3B82F6' },
  saveText: { color: '#fff', fontWeight: '700' },
});
