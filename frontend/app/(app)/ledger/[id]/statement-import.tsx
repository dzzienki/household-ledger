import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api, apiUpload, getErrorMessage } from '@/lib/api';
import { notify } from '@/lib/dialog';
import type { Category, StatementImportResponse, StatementItemPreview, StatementParseResponse } from '@/lib/types';

export default function StatementImportScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [parseResult, setParseResult] = useState<StatementParseResponse | null>(null);
  const [items, setItems] = useState<StatementItemPreview[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ uri: string; name: string; mimeType: string } | null>(null);
  const [password, setPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [activeCategoryModalIndex, setActiveCategoryModalIndex] = useState<number | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });
  const categories = categoriesQuery.data ?? [];
  const expenseCategories = categories.filter((c) => c.type === 'expense');

  // 파일 파싱 mutation
  const parseMutation = useMutation({
    mutationFn: async ({
      file,
      pw,
    }: {
      file: { uri: string; name: string; mimeType: string };
      pw?: string;
    }): Promise<StatementParseResponse> => {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const res = await fetch(file.uri);
        const blob = await res.blob();
        formData.append('file', blob, file.name);
      } else {
        formData.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'application/octet-stream',
        } as any);
      }
      if (pw) {
        formData.append('password', pw);
      }
      return apiUpload<StatementParseResponse>(`/api/ledgers/${ledgerId}/statements/parse`, formData);
    },
    onSuccess: (data) => {
      setParseResult(data);
      if (data.requires_password) {
        setShowPasswordModal(true);
        notify('비밀번호 필요', data.error_message || '비밀번호를 입력해주세요');
      } else {
        setShowPasswordModal(false);
        setItems(data.items);
        notify(
          '명세서 분석 완료',
          `${data.card_company || '카드사'} 명세서에서 총 ${data.total_count}건의 거래를 확인했습니다.`,
        );
      }
    },
    onError: (err) => {
      notify('파싱 실패', getErrorMessage(err, '명세서 분석 실패'));
    },
  });

  // 일괄 등록 mutation
  const importMutation = useMutation({
    mutationFn: (importItems: StatementItemPreview[]) =>
      api<StatementImportResponse>(`/api/ledgers/${ledgerId}/statements/import`, {
        method: 'POST',
        body: { items: importItems },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['summary', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      notify('등록 완료', `총 ${res.imported_count}건의 소비가 가계부에 성공적으로 등록되었습니다!`);
      router.replace(`/(app)/ledger/${ledgerId}`);
    },
    onError: (err) => {
      notify('등록 실패', getErrorMessage(err, '가계부 일괄 등록 실패'));
    },
  });

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
          'application/pdf',
          'image/*',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      const fileInfo = {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
      };
      setSelectedFile(fileInfo);
      parseMutation.mutate({ file: fileInfo });
    } catch (err) {
      notify('파일 선택 오류', getErrorMessage(err, '파일을 가져올 수 없습니다'));
    }
  }

  async function pickImage() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      const fileInfo = {
        uri: asset.uri,
        name: asset.fileName || 'statement_screenshot.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      };
      setSelectedFile(fileInfo);
      parseMutation.mutate({ file: fileInfo });
    } catch (err) {
      notify('사진 선택 오류', getErrorMessage(err, '사진을 가져올 수 없습니다'));
    }
  }

  function handleFileAction() {
    if (Platform.OS === 'web') {
      pickDocument();
      return;
    }
    Alert.alert(
      '명세서 파일 가져오기',
      '가져올 파일 형태를 선택하세요',
      [
        { text: '📂 엑셀 / PDF / CSV 문서 파일', onPress: pickDocument },
        { text: '🖼️ 명세서 캡처 이미지 / 사진', onPress: pickImage },
        { text: '취소', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }

  function toggleItem(index: number) {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], is_selected: !next[index].is_selected };
      return next;
    });
  }

  function selectAll(mode: 'all' | 'no_dup' | 'none') {
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        is_selected: mode === 'all' ? true : mode === 'no_dup' ? !it.is_duplicate : false,
      })),
    );
  }

  function changeItemCategory(category: Category) {
    if (activeCategoryModalIndex === null) return;
    setItems((prev) => {
      const next = [...prev];
      next[activeCategoryModalIndex] = {
        ...next[activeCategoryModalIndex],
        category_id: category.id,
        category_name: category.name,
      };
      return next;
    });
    setActiveCategoryModalIndex(null);
  }

  const selectedCount = items.filter((it) => it.is_selected).length;
  const selectedTotalAmount = items
    .filter((it) => it.is_selected)
    .reduce((s, it) => s + (Number(it.amount) || 0), 0);

  function handleImportSubmit() {
    const targets = items.filter((it) => it.is_selected);
    if (targets.length === 0) {
      notify('선택 필요', '가계부에 등록할 거래를 최소 1건 이상 선택해주세요');
      return;
    }
    importMutation.mutate(targets);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '카드 이용대금명세서 가져오기', headerBackTitle: '가계부' }} />

      {/* 상단 파일 업로드 섹션 */}
      <View style={styles.uploadSection}>
        <Pressable
          style={[styles.uploadButton, parseMutation.isPending && { opacity: 0.6 }]}
          disabled={parseMutation.isPending}
          onPress={handleFileAction}
        >
          {parseMutation.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.uploadButtonText}>📂 명세서 파일 선택 (엑셀/PDF/CSV/이미지)</Text>
          )}
        </Pressable>
        <Text style={styles.uploadHint}>
          국민카드, 농협카드, 현대카드 등 모든 카드사의 엑셀, PDF, CSV 명세서를 자동 분석합니다.
        </Text>
      </View>

      {/* 분석 결과 헤더 & 요약 */}
      {parseResult && items.length > 0 && (
        <View style={styles.summaryBar}>
          <View style={styles.summaryInfo}>
            <View style={styles.badgeRow}>
              {parseResult.card_company && (
                <View style={styles.cardBadge}>
                  <Text style={styles.cardBadgeText}>💳 {parseResult.card_company}</Text>
                </View>
              )}
              <Text style={styles.countText}>
                총 {items.length}건 중 <Text style={{ color: '#2563EB', fontWeight: '700' }}>{selectedCount}건</Text> 선택됨
              </Text>
            </View>
            <Text style={styles.totalAmountText}>선택 합계: {selectedTotalAmount.toLocaleString()}원</Text>
          </View>

          {/* 일괄 선택 컨트롤 */}
          <View style={styles.selectBtnRow}>
            <Pressable style={styles.miniBtn} onPress={() => selectAll('all')}>
              <Text style={styles.miniBtnText}>전체 선택</Text>
            </Pressable>
            <Pressable style={styles.miniBtn} onPress={() => selectAll('no_dup')}>
              <Text style={styles.miniBtnText}>중복 제외</Text>
            </Pressable>
            <Pressable style={styles.miniBtn} onPress={() => selectAll('none')}>
              <Text style={styles.miniBtnText}>해제</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 거래 내역 목록 */}
      {parseMutation.isPending ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>명세서를 분석하고 카테고리를 매핑하는 중...</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>📄</Text>
          <Text style={styles.emptyTitle}>명세서 파일을 업로드해주세요</Text>
          <Text style={styles.emptySubtitle}>
            카드사 홈페이지나 앱에서 다운로드한 엑셀(.xlsx, .xls),{'\n'}PDF, CSV, 또는 화면 캡처 이미지를 올려주시면{'\n'}소비 내역을 자동으로 정리해 드립니다.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(_, idx) => String(idx)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item, index }) => (
            <Pressable
              style={[
                styles.itemCard,
                item.is_selected ? styles.itemCardSelected : styles.itemCardUnselected,
                item.is_duplicate && styles.itemCardDuplicate,
              ]}
              onPress={() => toggleItem(index)}
            >
              {/* 체크박스 & 날짜/가맹점 */}
              <View style={styles.itemHeader}>
                <View style={styles.checkRow}>
                  <View style={[styles.checkbox, item.is_selected && styles.checkboxActive]}>
                    {item.is_selected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <View>
                    <Text style={styles.itemDate}>{item.transaction_date}</Text>
                    <Text style={styles.itemPayee}>{item.payee}</Text>
                  </View>
                </View>
                <View style={styles.priceCol}>
                  <Text style={[styles.itemAmount, item.type === 'income' && { color: '#16A34A' }]}>
                    {item.type === 'income' ? '+' : ''}
                    {Number(item.amount).toLocaleString()}원
                  </Text>
                  {item.is_duplicate && (
                    <View style={styles.dupBadge}>
                      <Text style={styles.dupBadgeText}>⚠️ 기존 거래 있음</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* 카테고리 & 메모 영역 */}
              <View style={styles.itemFooter}>
                <Pressable
                  style={styles.categoryChip}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    setActiveCategoryModalIndex(index);
                  }}
                >
                  <Text style={styles.categoryChipText}>
                    🏷️ {item.category_name ? item.category_name : '카테고리 선택'} ▾
                  </Text>
                </Pressable>
                {item.memo && <Text style={styles.itemMemo} numberOfLines={1}>📝 {item.memo}</Text>}
              </View>
            </Pressable>
          )}
        />
      )}

      {/* 하단 고정 등록 버튼 */}
      {items.length > 0 && (
        <View style={styles.bottomBar}>
          <Pressable
            style={[styles.importSubmitBtn, (importMutation.isPending || selectedCount === 0) && styles.submitDisabled]}
            disabled={importMutation.isPending || selectedCount === 0}
            onPress={handleImportSubmit}
          >
            {importMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.importSubmitBtnText}>
                선택한 {selectedCount}건 가계부에 등록하기 ({selectedTotalAmount.toLocaleString()}원)
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {/* 카테고리 선택 모달 */}
      <Modal visible={activeCategoryModalIndex !== null} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setActiveCategoryModalIndex(null)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>카테고리 선택</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {expenseCategories.map((c) => (
                <Pressable
                  key={c.id}
                  style={styles.catOption}
                  onPress={() => changeItemCategory(c)}
                >
                  <View style={[styles.catColorDot, { backgroundColor: c.color }]} />
                  <Text style={styles.catOptionText}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* 보안 PDF 비밀번호 모달 */}
      <Modal visible={showPasswordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🔒 비밀번호 입력</Text>
            <Text style={styles.modalSub}>
              보안 암호화된 PDF 명세서입니다.{'\n'}비밀번호(주민번호 앞 6자리 또는 사업자번호)를 입력하세요.
            </Text>
            <TextInput
              style={styles.pwInput}
              placeholder="비밀번호"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <View style={styles.modalBtnRow}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setShowPasswordModal(false)}>
                <Text style={styles.modalCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={styles.modalConfirmBtn}
                onPress={() => {
                  if (selectedFile) {
                    parseMutation.mutate({ file: selectedFile, pw: password });
                  }
                }}
              >
                <Text style={styles.modalConfirmText}>확인</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  uploadSection: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderColor: '#E5E7EB' },
  uploadButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  uploadButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  uploadHint: { fontSize: 12, color: '#6B7280', marginTop: 8, textAlign: 'center', lineHeight: 18 },

  summaryBar: {
    backgroundColor: '#EEF2FF',
    padding: 14,
    borderBottomWidth: 1,
    borderColor: '#C7D2FE',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryInfo: { gap: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardBadge: { backgroundColor: '#4F46E5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  cardBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  countText: { fontSize: 13, color: '#374151' },
  totalAmountText: { fontSize: 15, fontWeight: '700', color: '#1E1B4B' },
  selectBtnRow: { flexDirection: 'row', gap: 4 },
  miniBtn: { backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#C7D2FE' },
  miniBtnText: { fontSize: 11, color: '#4F46E5', fontWeight: '600' },

  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { marginTop: 14, color: '#6B7280', fontSize: 14 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#1F2937', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  listContent: { padding: 16, paddingBottom: 90 },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  itemCardSelected: { borderColor: '#3B82F6', backgroundColor: '#FFFFFF' },
  itemCardUnselected: { opacity: 0.6, backgroundColor: '#F9FAFB' },
  itemCardDuplicate: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  checkRow: { flexDirection: 'row', gap: 10, alignItems: 'center', flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  itemDate: { fontSize: 11, color: '#6B7280' },
  itemPayee: { fontSize: 14, fontWeight: '700', color: '#111827', marginTop: 1 },
  priceCol: { alignItems: 'flex-end', gap: 2 },
  itemAmount: { fontSize: 15, fontWeight: '700', color: '#DC2626' },
  dupBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  dupBadgeText: { fontSize: 10, color: '#B45309', fontWeight: '600' },

  itemFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderColor: '#F3F4F6' },
  categoryChip: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryChipText: { fontSize: 12, color: '#374151', fontWeight: '600' },
  itemMemo: { fontSize: 11, color: '#6B7280', flex: 1 },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 14,
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
  },
  importSubmitBtn: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  importSubmitBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  submitDisabled: { opacity: 0.5 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  modalSub: { fontSize: 13, color: '#4B5563', lineHeight: 18, marginBottom: 14 },
  catOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#F3F4F6' },
  catColorDot: { width: 12, height: 12, borderRadius: 6 },
  catOptionText: { fontSize: 14, color: '#111827', fontWeight: '600' },
  pwInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    marginBottom: 16,
  },
  modalBtnRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#F3F4F6' },
  modalCancelText: { fontSize: 14, color: '#4B5563', fontWeight: '600' },
  modalConfirmBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6, backgroundColor: '#3B82F6' },
  modalConfirmText: { fontSize: 14, color: '#fff', fontWeight: '700' },
});
