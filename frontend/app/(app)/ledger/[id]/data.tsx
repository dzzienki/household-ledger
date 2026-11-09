import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const [deletingBulk, setDeletingBulk] = useState(false);

  async function handleBatchCategorize() {
    setCategorizing(true);
    try {
      const res = await api<{
        total_processed: number;
        categorized_count: number;
        rules_count: number;
        ai_count: number;
        remaining_count: number;
        message: string;
      }>(`/api/ledgers/${ledgerId}/transactions/batch-categorize`, { method: 'POST' });
      notify('자동 분류 완료', res.message);
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['categories', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } catch (err) {
      notify('자동 분류 실패', getErrorMessage(err, '자동 분류 실패'));
    } finally {
      setCategorizing(false);
    }
  }

  async function handleDeleteUncategorized() {
    const ok = await confirmAsync(
      '방금 등록한 미분류 토스 거래 삭제',
      '카테고리가 지정되지 않은 미분류 거래내역만 삭제하시겠습니까?\n기존에 분류해둔 정상 거래는 유지됩니다.',
      { confirmText: '미분류 거래 삭제', destructive: true },
    );
    if (!ok) return;

    setDeletingBulk(true);
    try {
      const res = await api<{ deleted_count: number; message: string }>(
        `/api/ledgers/${ledgerId}/transactions/bulk?uncategorized_only=true`,
        { method: 'DELETE' },
      );
      notify('삭제 완료', res.message);
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } catch (err) {
      notify('삭제 실패', getErrorMessage(err, '거래내역 삭제 실패'));
    } finally {
      setDeletingBulk(false);
    }
  }

  async function handleBulkDelete() {
    const ok = await confirmAsync(
      '모든 거래내역 삭제',
      '이 가계부에 등록된 모든 거래내역을 정말 삭제하시겠습니까?\n토스 엑셀 재등록을 위해 초기화할 때 사용하며, 이 작업은 되돌릴 수 없습니다.',
      { confirmText: '전체 삭제', destructive: true },
    );
    if (!ok) return;

    setDeletingBulk(true);
    try {
      const res = await api<{ deleted_count: number; message: string }>(
        `/api/ledgers/${ledgerId}/transactions/bulk`,
        { method: 'DELETE' },
      );
      notify('삭제 완료', res.message);
      queryClient.invalidateQueries({ queryKey: ['transactions', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } catch (err) {
      notify('삭제 실패', getErrorMessage(err, '거래내역 삭제 실패'));
    } finally {
      setDeletingBulk(false);
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

      {/* 미분류 거래 일괄 자동 분류 */}
      <View style={[styles.card, styles.actionCard]}>
        <Text style={styles.cardTitle}>미분류 거래 일괄 자동 분류</Text>
        <Text style={styles.cardHint}>
          이미 등록된 거래내역 중 카테고리가 비어있는 항목들을 메모와 가맹점명 분석을 통해 식비, 교통, 주거, 공과금 등으로 일괄 자동 분류합니다.
        </Text>
        <Pressable
          style={[styles.button, styles.successButton, categorizing && { opacity: 0.6 }]}
          disabled={categorizing}
          onPress={handleBatchCategorize}
        >
          {categorizing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>⚡ 미분류 거래 일괄 자동 분류 실행</Text>
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

      {/* 가계부 거래내역 초기화 (일괄 삭제) */}
      <View style={[styles.card, styles.dangerCard]}>
        <Text style={[styles.cardTitle, { color: '#B91C1C' }]}>거래내역 정리 및 초기화</Text>
        <Text style={styles.cardHint}>
          방금 엑셀로 등록된 미분류 거래만 쏙 골라 삭제하거나, 가계부 전체 거래를 초기화할 수 있습니다.
        </Text>
        <Pressable
          style={[styles.button, styles.dangerButton, { marginBottom: 8 }, deletingBulk && { opacity: 0.6 }]}
          disabled={deletingBulk}
          onPress={handleDeleteUncategorized}
        >
          {deletingBulk ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>🧹 방금 등록한 미분류 토스 거래만 삭제</Text>
          )}
        </Pressable>
        <Pressable
          style={[styles.button, styles.secondary, { borderColor: '#FCA5A5' }, deletingBulk && { opacity: 0.6 }]}
          disabled={deletingBulk}
          onPress={handleBulkDelete}
        >
          <Text style={[styles.secondaryText, { color: '#DC2626' }]}>전체 거래내역 초기화 (모두 삭제)</Text>
        </Pressable>
      </View>
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
  dangerCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
  },
  dangerButton: { backgroundColor: '#DC2626' },
});
