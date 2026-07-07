import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { notify } from '@/lib/dialog';

import { ApiError, api } from '@/lib/api';
import { CURRENCIES } from '@/lib/currencies';
import type { Ledger, LedgerType } from '@/lib/types';

export default function NewLedgerScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<LedgerType>('shared');
  const [currency, setCurrency] = useState('KRW');

  const createMutation = useMutation({
    mutationFn: () =>
      api<Ledger>('/api/ledgers', {
        method: 'POST',
        body: { name: name.trim(), type, currency },
      }),
    onSuccess: (ledger) => {
      queryClient.invalidateQueries({ queryKey: ['ledgers'] });
      router.replace(`/(app)/ledger/${ledger.id}`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '생성 실패';
      notify('오류', msg);
    },
  });

  function onSubmit() {
    if (!name.trim()) {
      notify('입력 오류', '이름을 입력하세요');
      return;
    }
    createMutation.mutate();
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '새 가계부' }} />

      <Text style={styles.label}>이름</Text>
      <TextInput
        style={styles.input}
        placeholder="예: 우리 가족 가계부"
        value={name}
        onChangeText={setName}
        autoFocus
      />

      <Text style={styles.label}>종류</Text>
      <View style={styles.typeRow}>
        {(['shared', 'personal'] as LedgerType[]).map((t) => (
          <Pressable
            key={t}
            style={[styles.typeButton, type === t && styles.typeButtonActive]}
            onPress={() => setType(t)}
          >
            <Text style={[styles.typeTitle, type === t && styles.typeTitleActive]}>
              {t === 'shared' ? '공유' : '개인'}
            </Text>
            <Text style={[styles.typeDesc, type === t && styles.typeDescActive]}>
              {t === 'shared' ? '가족·배우자 등을 초대할 수 있습니다' : '나만 보는 가계부'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>기준 통화</Text>
      <View style={styles.currencyRow}>
        {CURRENCIES.map((c) => (
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

      <Pressable
        style={[styles.submit, createMutation.isPending && { opacity: 0.6 }]}
        disabled={createMutation.isPending}
        onPress={onSubmit}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitText}>만들기</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 8, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  typeRow: { gap: 12 },
  typeButton: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  typeButtonActive: { borderColor: '#3B82F6', backgroundColor: '#EFF6FF' },
  typeTitle: { fontSize: 16, fontWeight: '700' },
  typeTitleActive: { color: '#1E40AF' },
  typeDesc: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  typeDescActive: { color: '#1E40AF' },
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
  submit: {
    marginTop: 32,
    backgroundColor: '#3B82F6',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
