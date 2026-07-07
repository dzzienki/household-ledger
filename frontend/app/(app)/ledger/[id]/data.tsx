import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { notify } from '@/lib/dialog';

import { API_URL, ApiError, apiDownloadBlob, apiUpload } from '@/lib/api';
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
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [pickingStatement, setPickingStatement] = useState(false);
  const [statementResult, setStatementResult] = useState<StatementResult | null>(null);

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
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : (err as Error).message;
      notify('내보내기 실패', msg);
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
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : (err as Error).message;
      notify('가져오기 실패', msg);
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
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : (err as Error).message;
      notify('가져오기 실패', msg);
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
    <View style={styles.container}>
      <Stack.Screen options={{ title: '데이터 가져오기/내보내기' }} />

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

      <View style={styles.card}>
        <Text style={styles.cardTitle}>카드 이용내역(엑셀) 가져오기</Text>
        <Text style={styles.cardHint}>
          카드사에서 받은 이용내역 엑셀(.xls/.xlsx)을 올리면 지출로 일괄 등록됩니다. 컬럼은
          자동 인식하며, 취소 건은 환불(수입)로, 해외 건은 해당 통화로 등록됩니다. 카테고리는
          미분류로 등록되니 이후 분류하세요.
        </Text>
        <Pressable
          style={[styles.button, styles.secondary, (pickingStatement || statementMutation.isPending) && { opacity: 0.6 }]}
          disabled={pickingStatement || statementMutation.isPending}
          onPress={importStatement}
        >
          {pickingStatement || statementMutation.isPending ? (
            <ActivityIndicator color="#1F2937" />
          ) : (
            <Text style={styles.secondaryText}>🧾 엑셀 파일 선택</Text>
          )}
        </Pressable>

        {statementResult && (
          <View style={styles.resultBox}>
            <Text style={styles.resultText}>
              ✓ 등록 {statementResult.imported}건
              {statementResult.income_from_cancel > 0 ? ` · 취소→수입 ${statementResult.income_from_cancel}` : ''}
              {statementResult.foreign > 0 ? ` · 외화 ${statementResult.foreign}` : ''}
              {statementResult.skipped > 0 ? ` · 제외 ${statementResult.skipped}` : ''}
            </Text>
            {statementResult.errors.length > 0 && (
              <>
                <Text style={styles.errorTitle}>건너뛴 줄 ({statementResult.errors.length}):</Text>
                {statementResult.errors.slice(0, 5).map((e, i) => (
                  <Text key={i} style={styles.errorLine}>
                    • {e}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
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
});
