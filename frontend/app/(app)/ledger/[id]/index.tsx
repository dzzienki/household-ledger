import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DEFAULT_FILTER,
  TransactionFilterSheet,
  isFilterActive,
  resolveRange,
  type TransactionFilterState,
} from '@/components/transaction-filter';
import { api } from '@/lib/api';
import { convertToBase, ratesToMap } from '@/lib/currencies';
import { formatCurrency, formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import type { Category, ExchangeRate, Ledger, Tag, Transaction } from '@/lib/types';

export default function LedgerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [filter, setFilter] = useState<TransactionFilterState>(DEFAULT_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
    if (filter.type !== 'all') params.set('type', filter.type);
    if (filter.categoryId) params.set('category_id', filter.categoryId);
    if (filter.tagId) params.set('tag_id', filter.tagId);
    const range = resolveRange(filter);
    if (range.start) params.set('start_date', range.start);
    if (range.end) params.set('end_date', range.end);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [debouncedSearch, filter]);

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

  const tagsQuery = useQuery({
    queryKey: ['tags', id],
    queryFn: () => api<Tag[]>(`/api/ledgers/${id}/tags`),
    enabled: !!id,
  });

  const ratesQuery = useQuery({
    queryKey: ['exchange-rates', id],
    queryFn: () => api<ExchangeRate[]>(`/api/ledgers/${id}/exchange-rates`),
    enabled: !!id,
  });

  const txnQuery = useQuery({
    queryKey: ['transactions', id, queryParams],
    queryFn: () => api<Transaction[]>(`/api/ledgers/${id}/transactions${queryParams}`),
    enabled: !!id,
  });

  const categoriesById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c]));

  if (ledgerQuery.isLoading) {
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

  const txns = txnQuery.data ?? [];
  const currency = ledgerQuery.data?.currency ?? 'KRW';
  const rateMap = ratesToMap(ratesQuery.data ?? []);
  const hasForeign = txns.some((t) => t.currency !== currency);
  const totals = txns.reduce(
    (acc, t) => {
      const v = convertToBase(Number(t.amount), t.currency, currency, rateMap);
      if (t.type === 'income') acc.income += v;
      else acc.expense += v;
      return acc;
    },
    { income: 0, expense: 0 },
  );
  const filterActive = isFilterActive(filter) || debouncedSearch.trim().length > 0;

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
          <Text style={styles.summaryLabel}>수입{filterActive ? ' (필터)' : ''}</Text>
          <Text style={[styles.summaryValue, { color: '#16A34A' }]}>
            {formatCurrency(totals.income, currency)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>지출{filterActive ? ' (필터)' : ''}</Text>
          <Text style={[styles.summaryValue, { color: '#DC2626' }]}>
            {formatCurrency(totals.expense, currency)}
          </Text>
        </View>
      </View>
      {hasForeign && (
        <Text style={styles.convertNote}>* 외화 거래는 {currency} 환율로 환산해 합산했습니다</Text>
      )}

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="거래처·메모 검색"
            value={searchInput}
            onChangeText={setSearchInput}
            placeholderTextColor="#9CA3AF"
            returnKeyType="search"
          />
          {searchInput.length > 0 && (
            <Pressable onPress={() => setSearchInput('')} hitSlop={8}>
              <Text style={styles.searchClear}>✕</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.filterButton, filterActive && styles.filterButtonActive]}
          onPress={() => setFilterOpen(true)}
        >
          <Text style={[styles.filterButtonText, filterActive && styles.filterButtonTextActive]}>
            필터{filterActive ? ' •' : ''}
          </Text>
        </Pressable>
      </View>

      <View style={styles.quickRow}>
        <QuickButton label="카테고리" onPress={() => router.push(`/(app)/ledger/${id}/categories`)} />
        <QuickButton label="태그" onPress={() => router.push(`/(app)/ledger/${id}/tags`)} />
        <QuickButton label="멤버" onPress={() => router.push(`/(app)/ledger/${id}/members`)} />
      </View>
      <View style={styles.quickRow}>
        <QuickButton label="반복 거래" onPress={() => router.push(`/(app)/ledger/${id}/recurring`)} />
        <QuickButton label="예산" onPress={() => router.push(`/(app)/ledger/${id}/budgets`)} />
        <QuickButton label="통계" onPress={() => router.push(`/(app)/ledger/${id}/stats`)} />
      </View>
      <View style={styles.quickRow}>
        <QuickButton label="환율" onPress={() => router.push(`/(app)/ledger/${id}/exchange-rates`)} />
        <QuickButton label="CSV" onPress={() => router.push(`/(app)/ledger/${id}/data`)} />
        <View style={styles.quickSpacer} />
      </View>

      {txnQuery.isLoading ? (
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={txns}
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
                  <View style={styles.rowTextWrap}>
                    <Text style={styles.rowTitle}>{item.payee || category?.name || '(미분류)'}</Text>
                    <Text style={styles.rowMeta}>
                      {category?.name ?? '미분류'} · {formatDate(item.transaction_date)}
                    </Text>
                    {item.tags.length > 0 && (
                      <View style={styles.rowTags}>
                        {item.tags.map((t) => (
                          <View key={t.id} style={[styles.rowTag, { borderColor: t.color }]}>
                            <Text style={[styles.rowTagText, { color: t.color }]}>#{t.name}</Text>
                          </View>
                        ))}
                      </View>
                    )}
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
          ListEmptyComponent={
            <Text style={styles.empty}>
              {filterActive ? '검색 조건에 맞는 거래가 없습니다' : '아직 거래가 없습니다'}
            </Text>
          }
        />
      )}

      <Pressable
        style={styles.fab}
        onPress={() => router.push(`/(app)/ledger/${id}/new-transaction`)}
      >
        <Text style={styles.fabText}>+ 거래 추가</Text>
      </Pressable>

      <TransactionFilterSheet
        visible={filterOpen}
        value={filter}
        categories={categoriesQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        onChange={setFilter}
        onClose={() => setFilterOpen(false)}
        onClear={() => setFilter(DEFAULT_FILTER)}
      />
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
  center: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
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
  convertNote: { fontSize: 11, color: '#9CA3AF', paddingHorizontal: 16, marginBottom: 4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
  },
  searchIcon: { fontSize: 14, marginRight: 6, color: '#6B7280' },
  searchInput: { flex: 1, fontSize: 15, color: '#111827', paddingVertical: 0 },
  searchClear: { color: '#6B7280', fontSize: 16, paddingHorizontal: 4 },
  filterButton: {
    paddingHorizontal: 14,
    height: 40,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  filterButtonActive: { backgroundColor: '#1F2937' },
  filterButtonText: { fontWeight: '700', color: '#374151' },
  filterButtonTextActive: { color: '#fff' },
  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  quickButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickButtonText: { fontWeight: '600', color: '#374151' },
  quickSpacer: { flex: 1 },
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
  rowTextWrap: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  rowTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  rowTag: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  rowTagText: { fontSize: 10, fontWeight: '600' },
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
