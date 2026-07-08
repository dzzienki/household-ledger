import { useMutation, useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { notify } from '@/lib/dialog';

import { AmountInput } from '@/components/amount-input';
import { ApiError, api, apiUpload } from '@/lib/api';
import { CURRENCIES } from '@/lib/currencies';
import type { CategorySuggestion, Category, Ledger, ReceiptExtraction, Tag, Transaction, TransactionType } from '@/lib/types';

export interface TransactionFormValue {
  type: TransactionType;
  amount: number;
  currency: string;
  transaction_date: string;
  category_id: string | null;
  payee: string | null;
  memo: string | null;
  tag_ids: string[];
}

interface Props {
  ledgerId: string;
  initial?: Transaction | null;
  categories: Category[];
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (value: TransactionFormValue) => void;
  onDelete?: () => void;
  deleting?: boolean;
}

interface ReceiptResponse {
  extraction: ReceiptExtraction;
  suggested_category_id: string | null;
}

export function TransactionForm({
  ledgerId,
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
  const [currency, setCurrency] = useState(initial?.currency ?? 'KRW');
  const [currencyTouched, setCurrencyTouched] = useState(!!initial);
  const [payee, setPayee] = useState(initial?.payee ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id ?? null);
  const [tagIds, setTagIds] = useState<string[]>(initial?.tags?.map((t) => t.id) ?? []);
  const [transactionDate, setTransactionDate] = useState(
    initial?.transaction_date ?? new Date().toISOString().slice(0, 10),
  );
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const ledgerQuery = useQuery({
    queryKey: ['ledger', ledgerId],
    queryFn: () => api<Ledger>(`/api/ledgers/${ledgerId}`),
    enabled: !!ledgerId,
  });
  const baseCurrency = ledgerQuery.data?.currency ?? 'KRW';

  // For a brand-new transaction, default the currency to the ledger's base currency
  // once we know it (unless the user has already picked one).
  useEffect(() => {
    if (!initial && !currencyTouched && ledgerQuery.data) {
      setCurrency(ledgerQuery.data.currency);
    }
  }, [initial, currencyTouched, ledgerQuery.data]);

  const tagsQuery = useQuery({
    queryKey: ['tags', ledgerId],
    queryFn: () => api<Tag[]>(`/api/ledgers/${ledgerId}/tags`),
    enabled: !!ledgerId,
  });
  const availableTags = tagsQuery.data ?? [];

  const aiStatusQuery = useQuery({
    queryKey: ['ai', 'status', ledgerId],
    queryFn: () => api<{ enabled: boolean }>(`/api/ledgers/${ledgerId}/ai/status`),
    enabled: !!ledgerId,
  });
  const aiEnabled = aiStatusQuery.data?.enabled === true;

  useEffect(() => {
    if (categoryId) {
      const c = categories.find((x) => x.id === categoryId);
      if (c && c.type !== type) setCategoryId(null);
    }
  }, [type, categoryId, categories]);

  const filteredCategories = categories.filter((c) => c.type === type);

  // Show the base currency first, then the rest.
  const currencyOptions = [
    ...CURRENCIES.filter((c) => c.code === baseCurrency),
    ...CURRENCIES.filter((c) => c.code !== baseCurrency),
  ];

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const categorizeMutation = useMutation({
    mutationFn: () =>
      api<CategorySuggestion>(`/api/ledgers/${ledgerId}/ai/categorize`, {
        method: 'POST',
        body: { type, payee: payee.trim() || null, memo: memo.trim() || null },
      }),
    onSuccess: (suggestion) => {
      if (suggestion.category_id) {
        setCategoryId(suggestion.category_id);
        setAiTip(`AI 추천: ${suggestion.category_name} (신뢰도 ${(suggestion.confidence * 100).toFixed(0)}%)`);
      } else {
        setAiTip(`AI 추천: 적합한 카테고리를 찾지 못했습니다`);
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : 'AI 호출 실패';
      notify('AI 추천 실패', msg);
    },
  });

  const ocrMutation = useMutation({
    mutationFn: async (asset: ImagePicker.ImagePickerAsset): Promise<ReceiptResponse> => {
      const formData = new FormData();
      const mimeType = asset.mimeType || 'image/jpeg';
      const filename = asset.fileName || `receipt-${Date.now()}.jpg`;
      if (Platform.OS === 'web') {
        const res = await fetch(asset.uri);
        const blob = await res.blob();
        formData.append('file', blob, filename);
      } else {
        formData.append('file', {
          uri: asset.uri,
          name: filename,
          type: mimeType,
        } as any);
      }
      return apiUpload<ReceiptResponse>(`/api/ledgers/${ledgerId}/ai/receipt`, formData);
    },
    onSuccess: ({ extraction, suggested_category_id }) => {
      setType('expense');
      if (extraction.amount) setAmount(String(extraction.amount));
      if (extraction.transaction_date) setTransactionDate(extraction.transaction_date);
      if (extraction.payee) setPayee(extraction.payee);
      if (extraction.memo) setMemo(extraction.memo);
      if (suggested_category_id) setCategoryId(suggested_category_id);
      setAiTip(`영수증 분석 완료 (신뢰도 ${(extraction.confidence * 100).toFixed(0)}%)`);
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '영수증 분석 실패';
      notify('OCR 실패', msg);
    },
  });

  async function pickReceipt() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      notify('권한 필요', '영수증 사진을 선택하려면 사진 접근 권한이 필요합니다');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPreviewUri(asset.uri);
    ocrMutation.mutate(asset);
  }

  function handleSubmit() {
    const num = Number(amount);
    if (!num || num <= 0) {
      notify('입력 오류', '금액을 입력하세요');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
      notify('입력 오류', '날짜는 YYYY-MM-DD 형식이어야 합니다');
      return;
    }
    onSubmit({
      type,
      amount: num,
      currency,
      transaction_date: transactionDate,
      category_id: categoryId,
      payee: payee.trim() || null,
      memo: memo.trim() || null,
      tag_ids: tagIds,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {aiEnabled && !initial && (
        <Pressable
          style={[styles.aiButton, ocrMutation.isPending && { opacity: 0.6 }]}
          disabled={ocrMutation.isPending}
          onPress={pickReceipt}
        >
          {ocrMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.aiButtonText}>📸 영수증 사진으로 자동 입력</Text>
          )}
        </Pressable>
      )}

      {previewUri && <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" />}

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
      <AmountInput
        style={styles.input}
        placeholder="0"
        value={amount}
        onChangeText={setAmount}
      />

      <Text style={styles.label}>통화</Text>
      <View style={styles.currencyRow}>
        {currencyOptions.map((c) => (
          <Pressable
            key={c.code}
            style={[styles.chip, currency === c.code && styles.chipActive]}
            onPress={() => {
              setCurrency(c.code);
              setCurrencyTouched(true);
            }}
          >
            <Text style={[styles.chipText, currency === c.code && styles.chipTextActive]}>
              {c.code}
            </Text>
          </Pressable>
        ))}
      </View>
      {currency !== baseCurrency && (
        <Text style={styles.hint}>
          기준 통화({baseCurrency})와 달라요. 통계 합산에는 환율 설정이 사용됩니다.
        </Text>
      )}

      <Text style={styles.label}>날짜</Text>
      <TextInput
        style={styles.input}
        placeholder="YYYY-MM-DD"
        value={transactionDate}
        onChangeText={setTransactionDate}
        autoCapitalize="none"
      />

      <View style={styles.labelRow}>
        <Text style={styles.label}>카테고리</Text>
        {aiEnabled && (payee.trim() || memo.trim()) && (
          <Pressable
            disabled={categorizeMutation.isPending}
            onPress={() => categorizeMutation.mutate()}
          >
            <Text style={styles.aiInline}>
              {categorizeMutation.isPending ? '분석 중…' : '✨ AI 추천'}
            </Text>
          </Pressable>
        )}
      </View>
      <View style={styles.categoryRow}>
        {filteredCategories.length === 0 ? (
          <Text style={styles.emptyHint}>카테고리가 없습니다 (미분류로 저장됩니다)</Text>
        ) : (
          filteredCategories.map((c) => (
            <Pressable
              key={c.id}
              style={[
                styles.chip,
                { borderColor: c.color, borderWidth: 1.5 },
                categoryId === c.id && { backgroundColor: c.color, borderColor: c.color },
              ]}
              onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
            >
              <Text style={[styles.chipText, categoryId === c.id && { color: '#fff' }]}>{c.name}</Text>
            </Pressable>
          ))
        )}
      </View>
      {aiTip && <Text style={styles.aiTip}>{aiTip}</Text>}

      <Text style={styles.label}>태그</Text>
      <View style={styles.categoryRow}>
        {availableTags.length === 0 ? (
          <Text style={styles.emptyHint}>태그가 없습니다 (태그 관리에서 추가하세요)</Text>
        ) : (
          availableTags.map((t) => {
            const selected = tagIds.includes(t.id);
            return (
              <Pressable
                key={t.id}
                style={[
                  styles.chip,
                  { borderColor: t.color, borderWidth: 1.5 },
                  selected && { backgroundColor: t.color, borderColor: t.color },
                ]}
                onPress={() => toggleTag(t.id)}
              >
                <Text style={[styles.chipText, selected && { color: '#fff' }]}>#{t.name}</Text>
              </Pressable>
            );
          })
        )}
      </View>

      <Text style={styles.label}>거래처</Text>
      <TextInput
        style={styles.input}
        placeholder="예: 스타벅스"
        value={payee}
        onChangeText={(v) => {
          setPayee(v);
          setAiTip(null);
        }}
      />

      <Text style={styles.label}>메모</Text>
      <TextInput
        style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
        placeholder="(선택)"
        multiline
        value={memo}
        onChangeText={(v) => {
          setMemo(v);
          setAiTip(null);
        }}
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
  aiButton: {
    backgroundColor: '#7C3AED',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  aiButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  preview: { width: '100%', height: 200, borderRadius: 8, marginBottom: 16, backgroundColor: '#F3F4F6' },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  typeButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#F3F4F6' },
  typeButtonActive: { backgroundColor: '#1F2937' },
  typeText: { fontSize: 16, fontWeight: '600', color: '#6B7280' },
  typeTextActive: { color: '#fff' },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 6, fontWeight: '600' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiInline: { color: '#7C3AED', fontWeight: '700', fontSize: 13, marginTop: 12 },
  hint: { color: '#9CA3AF', fontSize: 12, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyHint: { color: '#9CA3AF', fontSize: 13 },
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
  aiTip: { color: '#7C3AED', fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  submit: { marginTop: 28, backgroundColor: '#3B82F6', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
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
