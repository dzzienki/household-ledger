import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { confirmAsync, notify } from '@/lib/dialog';

import { API_URL, api, apiDownloadBlob, apiUpload, getErrorMessage } from '@/lib/api';
import { ACCESS_TOKEN_KEY, storage } from '@/lib/storage';

interface ImportResult {
  imported: number;
  categories_created: number;
  errors: string[];
}

interface StatementResult {
  imported: number;
  income_from_cancel: number;
  foreign: number;
  skipped: number;
  errors: string[];
}

interface InternalTransferPair {
  pair_id: string;
  date: string;
  amount: number;
  description: string;
  expense_txn: {
    id: string;
    type: string;
    amount: number;
    transaction_date: string;
    payee: string | null;
    memo: string | null;
  };
  income_txn: {
    id: string;
    type: string;
    amount: number;
    transaction_date: string;
    payee: string | null;
    memo: string | null;
  };
}

interface InternalTransferListResponse {
  pairs: InternalTransferPair[];
  total_count: number;
  total_amount: number;
}

export default function DataScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [pickingStatement, setPickingStatement] = useState(false);
  const [statementResult, setStatementResult] = useState<StatementResult | null>(null);
  const [categorizing, setCategorizing] = useState(false);

  // 내부 이체 중복 탐지 상태
  const [scanningTransfers, setScanningTransfers] = useState(false);
  const [transferData, setTransferData] = useState<InternalTransferListResponse | null>(null);
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [resolvingTransfers, setResolvingTransfers] = useState(false);

  async function handleBatchCategorize() {
    setCategorizing(true);
    try {
      const res = await api<{
        total_processed: number;
        categorized_count: number;
        rules_count: number;
        ai_count: number;
        remaining_count: number;
        removed_transfers_count?: number;
        message: string;
      }>(`/api/ledgers/${ledgerId}/transactions/batch-categorize?reclassify_misc=true`, { method: 'POST' });
      notify('자동 분류 및 세분화 완료', res.message);
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['categories', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['summary', ledgerId] });
    } catch (err) {
      notify('자동 분류 실패', getErrorMessage(err, '자동 분류 실패'));
    } finally {
      setCategorizing(false);
    }
  }

  async function handleScanInternalTransfers() {
    setScanningTransfers(true);
    try {
      const data = await api<InternalTransferListResponse>(
        `/api/ledgers/${ledgerId}/transactions/internal-transfers`,
      );
      setTransferData(data);
      if (data.total_count === 0) {
        notify('확인 완료', '현재 감지된 내부 이체 중복 거래가 없습니다.');
      } else {
        setTransferModalVisible(true);
      }
    } catch (err) {
      notify('탐지 실패', getErrorMessage(err, '내부 이체 탐지 실패'));
    } finally {
      setScanningTransfers(false);
    }
  }

  async function handleResolveAllTransfers() {
    if (!transferData || transferData.total_count === 0) return;
    const ok = await confirmAsync(
      '내부 이체 중복 정리',
      `감지된 ${transferData.total_count}쌍(총 ${transferData.total_count * 2}건, 중복금액 ${Number(transferData.total_amount).toLocaleString()}원)의 내부 이체 거래를 가계부에서 삭제하시겠습니까?\n\n허브통장과 생활비통장 간 오간 중복 거래가 제거되어 통계가 정확해집니다.`,
      { confirmText: '삭제 실행', destructive: true },
    );
    if (!ok) return;

    setResolvingTransfers(true);
    try {
      const res = await api<{ deleted_count: number; freed_amount: number; message: string }>(
        `/api/ledgers/${ledgerId}/transactions/internal-transfers/resolve`,
        {
          method: 'POST',
          body: { delete_all_detected: true },
        },
      );
      notify('정리 완료', res.message);
      setTransferModalVisible(false);
      setTransferData(null);
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['summary', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } catch (err) {
      notify('정리 실패', getErrorMessage(err, '중복 정리 실패'));
    } finally {
      setResolvingTransfers(false);
    }
  }



  async function exportCsv() {
    setDownloading(true);
    try {
      if (Platform.OS === 'web') {
        const blob = await apiDownloadBlob(`/api/ledgers/${ledgerId}/export.csv`);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const token = await storage.get(ACCESS_TOKEN_KEY);
        const fileUri = FileSystem.cacheDirectory + `ledger-${Date.now()}.csv`;
        const result = await FileSystem.downloadAsync(
          `${API_URL}/api/ledgers/${ledgerId}/export.csv`,
          fileUri,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri, { mimeType: 'text/csv', dialogTitle: 'CSV 내보내기' });
        } else {
          notify('완료', `다운로드 위치: ${result.uri}`);
        }
      }
    } catch (err) {
      notify('내보내기 실패', getErrorMessage(err, '내보내기 실패'));
    } finally {
      setDownloading(false);
    }
  }

  const importMutation = useMutation({
    mutationFn: async (file: { uri: string; name: string; mimeType?: string }): Promise<ImportResult> => {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const res = await fetch(file.uri);
        const blob = await res.blob();
        formData.append('file', blob, file.name);
      } else {
        formData.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'text/csv',
        } as any);
      }
      return apiUpload<ImportResult>(`/api/ledgers/${ledgerId}/import.csv`, formData);
    },
    onSuccess: (result) => {
      setLastResult(result);
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['categories', ledgerId] });
    },
    onError: (err) => {
      notify('가져오기 실패', getErrorMessage(err, '가져오기 실패'));
    },
  });

  async function importCsv() {
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', '*/*'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      importMutation.mutate({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    } catch (err) {
      notify('파일 선택 실패', (err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const statementMutation = useMutation({
    mutationFn: async (file: { uri: string; name: string; mimeType?: string }): Promise<StatementResult> => {
      const formData = new FormData();
      if (Platform.OS === 'web') {
        const res = await fetch(file.uri);
        const blob = await res.blob();
        formData.append('file', blob, file.name);
      } else {
        formData.append('file', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'application/vnd.ms-excel',
        } as any);
      }
      return apiUpload<StatementResult>(`/api/ledgers/${ledgerId}/import-statement`, formData);
    },
    onSuccess: (result) => {
      setStatementResult(result);
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (err) => {
      notify('가져오기 실패', getErrorMessage(err, '가져오기 실패'));
    },
  });

  async function importStatement() {
    setPickingStatement(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '*/*',
        ],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      statementMutation.mutate({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    } catch (err) {
      notify('파일 선택 실패', (err as Error).message);
    } finally {
      setPickingStatement(false);
    }
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: '데이터 관리 & 명세서' }} />

      {/* 스마트 카드 명세서 일괄 분석 & 등록 */}
      <View style={[styles.card, styles.highlightCard]}>
        <View style={styles.highlightBadge}>
          <Text style={styles.highlightBadgeText}>✨ 토스 & 카드 명세서 자동 파싱</Text>
        </View>
        <Text style={styles.cardTitle}>명세서 / 거래내역 엑셀 자동 분석 & 등록</Text>
        <Text style={styles.cardHint}>
          토스뱅크 거래내역 엑셀을 포함하여 모든 카드사/은행의 엑셀(.xlsx/.xls), PDF, CSV를 올리면 메모와 가맹점, 입출금을 자동 분류하여 미리보기 후 원하는 항목만 일괄 등록합니다.
        </Text>
        <Pressable
          style={[styles.button, styles.highlightButton]}
          onPress={() => router.push(`/(app)/ledger/${ledgerId}/statement-import`)}
        >
          <Text style={styles.highlightButtonText}>🚀 토스 / 카드 명세서 가져오기</Text>
        </Pressable>
      </View>

      {/* 미분류 거래 일괄 자동 분류 & 세분화 */}
      <View style={[styles.card, styles.actionCard]}>
        <Text style={styles.cardTitle}>미분류 거래 일괄 자동 분류 및 세분화</Text>
        <Text style={styles.cardHint}>
          미분류 거래뿐만 아니라, 기존 '기타 지출'로 몰려있던 거래들을 분석하여 보험, 금융/대출, 저축/투자, 경조사/선물, 용돈 등으로 세분화하여 일괄 분류합니다.
        </Text>
        <Pressable
          style={[styles.button, styles.successButton, categorizing && { opacity: 0.6 }]}
          disabled={categorizing}
          onPress={handleBatchCategorize}
        >
          {categorizing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>⚡ 자동 분류 및 기타 지출 세분화 실행</Text>
          )}
        </Pressable>
      </View>

      {/* 내부 이체 중복 거래 정리 (허브통장 ⇄ 생활비 등) */}
      <View style={[styles.card, styles.transferCard]}>
        <Text style={styles.cardTitle}>허브통장 ⇄ 생활비/공과금 중복 이체 정리</Text>
        <Text style={styles.cardHint}>
          허브통장에서 생활비/공과금 통장으로 보낸 돈처럼, 가족/통장 간에 동일한 날짜와 금액으로 오간 입출금 쌍(내부 이체)을 감지하여 수입과 지출의 중복 집계를 정리합니다.
        </Text>
        <Pressable
          style={[styles.button, styles.transferButton, scanningTransfers && { opacity: 0.6 }]}
          disabled={scanningTransfers}
          onPress={handleScanInternalTransfers}
        >
          {scanningTransfers ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>🔍 내부 이체 중복 거래 탐지 및 정리</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>CSV로 내보내기</Text>
        <Text style={styles.cardHint}>
          이 가계부의 모든 거래 내역을 CSV 파일로 다운로드합니다. 컬럼: date, type, amount, category, payee, memo.
        </Text>
        <Pressable
          style={[styles.button, styles.primary, downloading && { opacity: 0.6 }]}
          disabled={downloading}
          onPress={exportCsv}
        >
          {downloading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>📥 CSV 다운로드</Text>}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>CSV에서 가져오기</Text>
        <Text style={styles.cardHint}>
          같은 형식의 CSV 파일에서 거래를 일괄 등록합니다. 카테고리 이름이 일치하지 않으면 새로 만듭니다.
        </Text>
        <Pressable
          style={[styles.button, styles.secondary, (importing || importMutation.isPending) && { opacity: 0.6 }]}
          disabled={importing || importMutation.isPending}
          onPress={importCsv}
        >
          {importing || importMutation.isPending ? (
            <ActivityIndicator color="#1F2937" />
          ) : (
            <Text style={styles.secondaryText}>📤 CSV 파일 선택</Text>
          )}
        </Pressable>

        {lastResult && (
          <View style={styles.resultBox}>
            <Text style={styles.resultText}>
              ✓ 가져옴 {lastResult.imported}건
              {lastResult.categories_created > 0 ? ` · 새 카테고리 ${lastResult.categories_created}개` : ''}
            </Text>
            {lastResult.errors.length > 0 && (
              <>
                <Text style={styles.errorTitle}>건너뛴 줄 ({lastResult.errors.length}):</Text>
                {lastResult.errors.slice(0, 5).map((e, i) => (
                  <Text key={i} style={styles.errorLine}>
                    • {e}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}
      </View>

      {/* 내부 이체 중복 모달 */}
      <Modal
        visible={transferModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setTransferModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>내부 이체 중복 거래 ({transferData?.total_count || 0}쌍)</Text>
              <Pressable onPress={() => setTransferModalVisible(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.modalSubtitle}>
              동일 날짜·동일 금액으로 매칭된 내부 이체입니다. 정리 시 양쪽 거래가 삭제되어 수입·지출 중복이 제거됩니다.{'\n'}
              중복 총액: {Number(transferData?.total_amount || 0).toLocaleString()}원
            </Text>

            <ScrollView style={styles.pairList}>
              {transferData?.pairs.map((p) => (
                <View key={p.pair_id} style={styles.pairCard}>
                  <View style={styles.pairRow}>
                    <Text style={styles.pairDate}>{p.date}</Text>
                    <Text style={styles.pairAmount}>{Number(p.amount).toLocaleString()}원</Text>
                  </View>
                  <View style={styles.pairDetailBox}>
                    <Text style={styles.pairExpText}>
                      🔴 출금: {p.expense_txn.payee || '출금'} {p.expense_txn.memo ? `(${p.expense_txn.memo})` : ''}
                    </Text>
                    <Text style={styles.pairIncText}>
                      🟢 입금: {p.income_txn.payee || '입금'} {p.income_txn.memo ? `(${p.income_txn.memo})` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable
                style={[styles.button, styles.cancelModalBtn]}
                onPress={() => setTransferModalVisible(false)}
              >
                <Text style={styles.cancelModalBtnText}>닫기</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.deleteModalBtn, resolvingTransfers && { opacity: 0.6 }]}
                disabled={resolvingTransfers}
                onPress={handleResolveAllTransfers}
              >
                {resolvingTransfers ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    🗑️ 중복 이체 일괄 정리 ({transferData ? transferData.total_count * 2 : 0}건 삭제)
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#fff' },
  container: { padding: 16, paddingBottom: 40 },
  card: {
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  cardHint: { fontSize: 13, color: '#6B7280', marginBottom: 14, lineHeight: 19 },
  button: { paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  primary: { backgroundColor: '#3B82F6' },
  secondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryText: { color: '#1F2937', fontWeight: '700', fontSize: 15 },
  resultBox: { marginTop: 12, padding: 12, backgroundColor: '#fff', borderRadius: 8 },
  resultText: { fontWeight: '600', color: '#16A34A', marginBottom: 4 },
  errorTitle: { color: '#DC2626', fontWeight: '600', marginTop: 8 },
  errorLine: { color: '#7F1D1D', fontSize: 12, marginTop: 2 },
  highlightCard: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
    borderWidth: 1.5,
  },
  highlightBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#4F46E5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  highlightBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  highlightButton: { backgroundColor: '#4F46E5' },
  highlightButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  actionCard: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1.5,
  },
  successButton: { backgroundColor: '#16A34A' },
  transferCard: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1.5,
  },
  transferButton: { backgroundColor: '#2563EB' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 540,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937' },
  modalCloseText: { fontSize: 20, color: '#9CA3AF', padding: 4 },
  modalSubtitle: { fontSize: 13, color: '#4B5563', marginBottom: 12, lineHeight: 18 },
  pairList: { maxHeight: 380, marginVertical: 8 },
  pairCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  pairRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  pairDate: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  pairAmount: { fontSize: 15, fontWeight: '700', color: '#2563EB' },
  pairDetailBox: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  pairExpText: { fontSize: 13, color: '#DC2626', marginBottom: 4 },
  pairIncText: { fontSize: 13, color: '#16A34A' },
  modalFooter: { flexDirection: 'row', gap: 8, marginTop: 14 },
  cancelModalBtn: { flex: 1, backgroundColor: '#F3F4F6' },
  cancelModalBtnText: { color: '#4B5563', fontWeight: '700', fontSize: 14 },
  deleteModalBtn: { flex: 2, backgroundColor: '#DC2626' },
});
