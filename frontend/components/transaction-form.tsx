import { useMutation, useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { notify } from '@/lib/dialog';

import { AmountInput } from '@/components/amount-input';
import { ApiError, api, apiUpload, getErrorMessage } from '@/lib/api';
import { CURRENCIES } from '@/lib/currencies';
import type { CategorySuggestion, Category, Ledger, ReceiptExtraction, Tag, Transaction, TransactionItem, TransactionType } from '@/lib/types';

export interface TransactionFormValue {
  type: TransactionType;
  amount: number;
  currency: string;
  transaction_date: string;
  category_id: string | null;
  payee: string | null;
  memo: string | null;
  tag_ids: string[];
  items?: TransactionItem[];
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
  const [items, setItems] = useState<TransactionItem[]>(initial?.items ?? []);
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
    queryFn: () => api<{ enabled: boolean; primary?: string; strategy?: string }>(`/api/ledgers/${ledgerId}/ai/status`),
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

  function addItem() {
    setItems((prev) => [
      ...prev,
      { name: '', item_group: null, quantity: 1, unit_price: null, total_price: 0, memo: null },
    ]);
  }

  function updateItem(index: number, patch: Partial<TransactionItem>) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function syncAmountFromItems() {
    const total = items.reduce((sum, it) => sum + (Number(it.total_price) || 0), 0);
    if (total > 0) {
      setAmount(String(total));
      notify('금액 동기화', `세부 품목 합계(${total.toLocaleString()}원)로 금액이 설정되었습니다.`);
    }
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
      notify('AI 추천 실패', getErrorMessage(err, 'AI 호출 실패'));
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
      const itemsSum = (extraction.items || []).reduce((s, it) => s + (Number(it.total_price) || 0), 0);
      if (extraction.amount) {
        setAmount(String(extraction.amount));
      } else if (itemsSum > 0) {
        setAmount(String(itemsSum));
      }
      if (extraction.transaction_date) setTransactionDate(extraction.transaction_date);
      if (extraction.payee) setPayee(extraction.payee);
      if (extraction.memo) setMemo(extraction.memo);
      if (suggested_category_id) setCategoryId(suggested_category_id);
      if (extraction.items && extraction.items.length > 0) {
        setItems(extraction.items);
      }
      const itemCountText = extraction.items?.length ? ` (세부 품목 ${extraction.items.length}개 추출)` : '';
      setAiTip(`영수증 분석 완료${itemCountText} (신뢰도 ${(extraction.confidence * 100).toFixed(0)}%)`);
    },
    onError: (err) => {
      notify('OCR 실패', getErrorMessage(err, '영수증 분석 실패'));
    },
  });

  async function pickReceiptFromCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      notify('권한 필요', '영수증을 촬영하려면 카메라 접근 권한이 필요합니다');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPreviewUri(asset.uri);
    ocrMutation.mutate(asset);
  }

  async function pickReceiptFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      notify('권한 필요', '영수증 사진을 선택하려면 사진 접근 권한이 필요합니다');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPreviewUri(asset.uri);
    ocrMutation.mutate(asset);
  }

  function handleReceiptAction() {
    if (Platform.OS === 'web') {
      pickReceiptFromLibrary();
      return;
    }
    Alert.alert(
      '영수증 사진 입력',
      '영수증을 가져올 방법을 선택하세요',
      [
        { text: '📷 카메라로 촬영', onPress: pickReceiptFromCamera },
        { text: '🖼️ 사진 보관함에서 선택', onPress: pickReceiptFromLibrary },
        { text: '취소', style: 'cancel' },
      ],
      { cancelable: true },
    );
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

    const validItems = items
      .filter((it) => it.name.trim() && Number(it.total_price) > 0)
      .map((it) => ({
        ...it,
        name: it.name.trim(),
        item_group: it.item_group?.trim() || null,
        quantity: Number(it.quantity) || 1,
        unit_price: it.unit_price ? Number(it.unit_price) : null,
        total_price: Number(it.total_price),
        memo: it.memo?.trim() || null,
      }));

    onSubmit({
      type,
      amount: num,
      currency,
      transaction_date: transactionDate,
      category_id: categoryId,
      payee: payee.trim() || null,
      memo: memo.trim() || null,
      tag_ids: tagIds,
      items: validItems,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {aiEnabled && !initial && (
        <Pressable
          style={[styles.aiButton, ocrMutation.isPending && { opacity: 0.6 }]}
          disabled={ocrMutation.isPending}
          onPress={handleReceiptAction}
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

      {/* 세부 품목 (Line Items) 섹션 */}
      <View style={styles.itemsSectionHeader}>
        <View>
          <Text style={styles.itemsSectionTitle}>🛒 세부 품목 ({items.length}개)</Text>
          <Text style={styles.itemsSectionSubtitle}>영수증 내 개별 상품 및 가격을 관리합니다</Text>
        </View>
        <Pressable style={styles.addItemBtn} onPress={addItem}>
          <Text style={styles.addItemBtnText}>+ 품목 추가</Text>
        </Pressable>
      </View>

      {items.length > 0 && (
        <View style={styles.itemsContainer}>
          <View style={styles.itemsSummaryBar}>
            <Text style={styles.itemsSumText}>
              품목 합계: {items.reduce((s, it) => s + (Number(it.total_price) || 0), 0).toLocaleString()} {currency}
            </Text>
            <Pressable style={styles.syncBtn} onPress={syncAmountFromItems}>
              <Text style={styles.syncBtnText}>총금액에 반영</Text>
            </Pressable>
          </View>

          {items.map((item, index) => (
            <View key={index} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <TextInput
                  style={[styles.itemInput, { flex: 2 }]}
                  placeholder="품목명 (예: 신라면 5입)"
                  value={item.name}
                  onChangeText={(val) => updateItem(index, { name: val })}
                />
                <TextInput
                  style={[styles.itemInput, { flex: 1.2 }]}
                  placeholder="그룹 (예: 라면)"
                  value={item.item_group || ''}
                  onChangeText={(val) => updateItem(index, { item_group: val || null })}
                />
                <Pressable style={styles.removeItemBtn} onPress={() => removeItem(index)}>
                  <Text style={styles.removeItemBtnText}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.itemRow}>
                <View style={[styles.itemCol, { flex: 1 }]}>
                  <Text style={styles.itemFieldLabel}>수량</Text>
                  <TextInput
                    style={styles.itemInputSmall}
                    placeholder="1"
                    keyboardType="numeric"
                    value={item.quantity !== undefined ? String(item.quantity) : '1'}
                    onChangeText={(val) => {
                      const q = Number(val) || 1;
                      const patch: Partial<TransactionItem> = { quantity: q };
                      if (item.unit_price) {
                        patch.total_price = Math.round(q * item.unit_price);
                      }
                      updateItem(index, patch);
                    }}
                  />
                </View>

                <View style={[styles.itemCol, { flex: 1.3 }]}>
                  <Text style={styles.itemFieldLabel}>단가</Text>
                  <TextInput
                    style={styles.itemInputSmall}
                    placeholder="단가"
                    keyboardType="numeric"
                    value={item.unit_price ? String(item.unit_price) : ''}
                    onChangeText={(val) => {
                      const up = val ? Number(val) : null;
                      const patch: Partial<TransactionItem> = { unit_price: up };
                      if (up && item.quantity) {
                        patch.total_price = Math.round(item.quantity * up);
                      }
                      updateItem(index, patch);
                    }}
                  />
                </View>

                <View style={[styles.itemCol, { flex: 1.5 }]}>
                  <Text style={styles.itemFieldLabel}>금액</Text>
                  <TextInput
                    style={styles.itemInputSmall}
                    placeholder="총 금액"
                    keyboardType="numeric"
                    value={item.total_price ? String(item.total_price) : ''}
                    onChangeText={(val) => {
                      const tp = Number(val) || 0;
                      const patch: Partial<TransactionItem> = { total_price: tp };
                      if (item.quantity && item.quantity > 0) {
                        patch.unit_price = Math.round(tp / item.quantity);
                      }
                      updateItem(index, patch);
                    }}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

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

  /* 세부 품목 스타일 */
  itemsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 10,
  },
  itemsSectionTitle: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  itemsSectionSubtitle: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  addItemBtn: {
    backgroundColor: '#EEF2FF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  addItemBtnText: { fontSize: 13, fontWeight: '700', color: '#4F46E5' },
  itemsContainer: { gap: 10, marginBottom: 8 },
  itemsSummaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  itemsSumText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  syncBtn: { backgroundColor: '#3B82F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  syncBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  itemCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  itemRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  itemCol: { gap: 2 },
  itemFieldLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  itemInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  itemInputSmall: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    backgroundColor: '#fff',
  },
  removeItemBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
  },
  removeItemBtnText: { color: '#DC2626', fontWeight: '700', fontSize: 14 },

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
