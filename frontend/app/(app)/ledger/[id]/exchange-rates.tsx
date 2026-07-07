import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { notify } from '@/lib/dialog';

import { ApiError, api } from '@/lib/api';
import { CURRENCIES } from '@/lib/currencies';
import type { ExchangeRate, Ledger } from '@/lib/types';

export default function ExchangeRatesScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const ledgerQuery = useQuery({
    queryKey: ['ledger', ledgerId],
    queryFn: () => api<Ledger>(`/api/ledgers/${ledgerId}`),
    enabled: !!ledgerId,
  });
  const base = ledgerQuery.data?.currency ?? 'KRW';

  const ratesQuery = useQuery({
    queryKey: ['exchange-rates', ledgerId],
    queryFn: () => api<ExchangeRate[]>(`/api/ledgers/${ledgerId}/exchange-rates`),
    enabled: !!ledgerId,
  });

  const [editing, setEditing] = useState<ExchangeRate | 'new' | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (currency: string) =>
      api(`/api/ledgers/${ledgerId}/exchange-rates/${currency}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '삭제 실패';
      notify('오류', msg);
    },
  });

  if (ledgerQuery.isLoading || ratesQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const rates = ratesQuery.data ?? [];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '환율 관리' }} />

      <FlatList
        data={rates}
        keyExtractor={(r) => r.currency}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <>
            <Text style={styles.intro}>
              기준 통화는 <Text style={styles.bold}>{base}</Text> 입니다. 다른 통화 거래는 아래 환율로
              환산되어 통계에 합산됩니다.
            </Text>
            <View style={styles.headerRow}>
              <Text style={styles.sectionTitle}>환율 (1 통화 = ? {base})</Text>
              <Pressable onPress={() => setEditing('new')}>
                <Text style={styles.addText}>+ 추가</Text>
              </Pressable>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => setEditing(item)}>
              <Text style={styles.rowCurrency}>{item.currency}</Text>
              <Text style={styles.rowRate}>
                1 {item.currency} = {Number(item.rate_to_base).toLocaleString('ko-KR')} {base}
              </Text>
            </Pressable>
            <Pressable onPress={() => deleteMutation.mutate(item.currency)} hitSlop={8}>
              <Text style={styles.deleteIcon}>🗑️</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>등록된 환율이 없습니다. + 추가로 만들어 보세요.</Text>
        }
      />

      <RateEditor
        ledgerId={ledgerId!}
        base={base}
        existing={rates}
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

function RateEditor({
  ledgerId,
  base,
  existing,
  editing,
  onClose,
}: {
  ledgerId: string;
  base: string;
  existing: ExchangeRate[];
  editing: ExchangeRate | 'new' | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isNew = editing === 'new';
  const editingRate = editing && editing !== 'new' ? editing : null;

  const takenCodes = useMemo(
    () => new Set(existing.map((r) => r.currency.toUpperCase())),
    [existing],
  );
  const selectableCurrencies = CURRENCIES.filter(
    (c) => c.code !== base && (!takenCodes.has(c.code) || c.code === editingRate?.currency),
  );

  const [currency, setCurrency] = useState(editingRate?.currency ?? selectableCurrencies[0]?.code ?? '');
  const [rate, setRate] = useState(editingRate ? String(Number(editingRate.rate_to_base)) : '');

  const reset = () => {
    const firstSelectable = CURRENCIES.filter(
      (c) => c.code !== base && (!takenCodes.has(c.code) || c.code === editingRate?.currency),
    );
    setCurrency(editingRate?.currency ?? firstSelectable[0]?.code ?? '');
    setRate(editingRate ? String(Number(editingRate.rate_to_base)) : '');
  };

  const mutation = useMutation({
    mutationFn: () =>
      api(`/api/ledgers/${ledgerId}/exchange-rates`, {
        method: 'PUT',
        body: { currency, rate_to_base: rate },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exchange-rates', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '저장 실패';
      notify('오류', msg);
    },
  });

  function submit() {
    const num = Number(rate);
    if (!currency) {
      notify('입력 오류', '통화를 선택하세요');
      return;
    }
    if (!num || num <= 0) {
      notify('입력 오류', '환율은 0보다 커야 합니다');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal visible={!!editing} animationType="slide" transparent onShow={reset} onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{isNew ? '환율 추가' : `${editingRate?.currency} 환율 수정`}</Text>

          {isNew && (
            <>
              <Text style={styles.label}>통화</Text>
              {selectableCurrencies.length === 0 ? (
                <Text style={styles.emptyHint}>추가할 수 있는 통화가 없습니다</Text>
              ) : (
                <View style={styles.currencyRow}>
                  {selectableCurrencies.map((c) => (
                    <Pressable
                      key={c.code}
                      style={[styles.chip, currency === c.code && styles.chipActive]}
                      onPress={() => setCurrency(c.code)}
                    >
                      <Text style={[styles.chipText, currency === c.code && styles.chipTextActive]}>
                        {c.code}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          <Text style={styles.label}>1 {currency || '?'} = ? {base}</Text>
          <TextInput
            style={styles.input}
            keyboardType="numeric"
            placeholder="예: 1380"
            value={rate}
            onChangeText={setRate}
          />

          <View style={styles.modalActions}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.saveButton, mutation.isPending && { opacity: 0.6 }]}
              disabled={mutation.isPending || !currency || !rate.trim()}
              onPress={submit}
            >
              {mutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>{isNew ? '추가' : '저장'}</Text>
              )}
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
  intro: { fontSize: 13, color: '#6B7280', marginBottom: 16, lineHeight: 19 },
  bold: { fontWeight: '700', color: '#111827' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  addText: { color: '#3B82F6', fontWeight: '600' },
  empty: { color: '#9CA3AF', paddingVertical: 24, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rowMain: { flex: 1 },
  rowCurrency: { fontSize: 16, fontWeight: '700' },
  rowRate: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  deleteIcon: { fontSize: 18, paddingHorizontal: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 6, fontWeight: '600' },
  emptyHint: { color: '#9CA3AF', fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
  },
  chipActive: { backgroundColor: '#1F2937', borderColor: '#1F2937' },
  chipText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  chipTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#F3F4F6' },
  cancelText: { color: '#6B7280', fontWeight: '600' },
  saveButton: { backgroundColor: '#3B82F6' },
  saveText: { color: '#fff', fontWeight: '700' },
});
