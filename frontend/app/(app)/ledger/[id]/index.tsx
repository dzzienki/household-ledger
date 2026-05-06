import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Category, Ledger, Transaction } from '@/lib/types';

export default function LedgerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const ledgerQuery = useQuery({
    queryKey: ['ledger', id],
    queryFn: () => api<Ledger>(`/api/ledgers/${id}`),
    enabled: !!id,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', id],
    queryFn: () => api<Category[]>(`/api/ledgers/${id}/categories`),
    enabled: !!id,
  });

  const txnQuery = useQuery({
    queryKey: ['transactions', id],
    queryFn: () => api<Transaction[]>(`/api/ledgers/${id}/transactions`),
    enabled: !!id,
  });

  const categoriesById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c]));

  if (ledgerQuery.isLoading || txnQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (ledgerQuery.error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>가계부를 불러올 수 없습니다</Text>
      </View>
    );
  }

  const totals = (txnQuery.data ?? []).reduce(
    (acc, t) => {
      const v = Number(t.amount);
      if (t.type === 'income') acc.income += v;
      else acc.expense += v;
      return acc;
    },
    { income: 0, expense: 0 },
  );
  const currency = ledgerQuery.data?.currency ?? 'KRW';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: ledgerQuery.data?.name ?? '거래 내역',
          headerRight: () => (
            <Pressable onPress={() => router.push(`/(app)/ledger/${id}/stats`)} hitSlop={8}>
              <Text style={styles.headerLink}>통계</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>수입</Text>
          <Text style={[styles.summaryValue, { color: '#16A34A' }]}>
            {formatCurrency(totals.income, currency)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>지출</Text>
          <Text style={[styles.summaryValue, { color: '#DC2626' }]}>
            {formatCurrency(totals.expense, currency)}
          </Text>
        </View>
      </View>

      <View style={styles.quickRow}>
        <QuickButton label="카테고리" onPress={() => router.push(`/(app)/ledger/${id}/categories`)} />
        <QuickButton label="멤버" onPress={() => router.push(`/(app)/ledger/${id}/members`)} />
        <QuickButton label="통계" onPress={() => router.push(`/(app)/ledger/${id}/stats`)} />
      </View>
      <View style={styles.quickRow}>
        <QuickButton label="반복 거래" onPress={() => router.push(`/(app)/ledger/${id}/recurring`)} />
        <QuickButton label="예산" onPress={() => router.push(`/(app)/ledger/${id}/budgets`)} />
        <QuickButton label="CSV" onPress={() => router.push(`/(app)/ledger/${id}/data`)} />
      </View>

      <FlatList
        data={txnQuery.data ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        refreshing={txnQuery.isRefetching}
        onRefresh={() => txnQuery.refetch()}
        renderItem={({ item }) => {
          const category = item.category_id ? categoriesById.get(item.category_id) : null;
          return (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/(app)/ledger/${id}/transaction/${item.id}`)}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.colorDot, { backgroundColor: category?.color ?? '#9CA3AF' }]} />
                <View>
                  <Text style={styles.rowTitle}>{item.payee || category?.name || '(미분류)'}</Text>
                  <Text style={styles.rowMeta}>
                    {category?.name ?? '미분류'} · {formatDate(item.transaction_date)}
                  </Text>
                </View>
              </View>
              <Text
                style={[
                  styles.amount,
                  { color: item.type === 'income' ? '#16A34A' : '#DC2626' },
                ]}
              >
                {item.type === 'income' ? '+' : '-'}
                {formatCurrency(item.amount, item.currency)}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>아직 거래가 없습니다</Text>}
      />

      <Pressable
        style={styles.fab}
        onPress={() => router.push(`/(app)/ledger/${id}/new-transaction`)}
      >
        <Text style={styles.fabText}>+ 거래 추가</Text>
      </Pressable>
    </View>
  );
}

function QuickButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.quickButton} onPress={onPress}>
      <Text style={styles.quickButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  errorText: { color: '#DC2626' },
  headerLink: { color: '#3B82F6', fontWeight: '600', marginRight: 12 },
  summary: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, backgroundColor: '#E5E7EB', marginHorizontal: 8 },
  summaryLabel: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  summaryValue: { fontSize: 18, fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  quickButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickButtonText: { fontWeight: '600', color: '#374151' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  amount: { fontSize: 15, fontWeight: '700' },
  empty: { textAlign: 'center', color: '#9CA3AF', marginTop: 40 },
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
});
