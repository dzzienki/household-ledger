import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DEFAULT_FILTER,
  TransactionFilterSheet,
  isFilterActive,
  type TransactionFilterState,
} from '@/components/transaction-filter';
import { api } from '@/lib/api';
import { convertToBase, ratesToMap } from '@/lib/currencies';
import { formatCurrency, formatDate } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';
import { storage } from '@/lib/storage';
import type { Category, ExchangeRate, Ledger, LedgerSummary, Tag, Transaction } from '@/lib/types';

type SummaryMode = 'balance' | 'expense' | 'simple';

const SUMMARY_MODE_LABELS: Record<SummaryMode, string> = {
  balance: '잔액',
  expense: '지출',
  simple: '수지',
};

export default function LedgerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const [filter, setFilter] = useState<TransactionFilterState>(DEFAULT_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);

  const [summaryMode, setSummaryMode] = useState<SummaryMode>('balance');
  const [userExplicitMode, setUserExplicitMode] = useState(false);

  // Month scope: home shows one month at a time (arrows to move). "전체" turns it off.
  const [monthMode, setMonthMode] = useState(true);
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const monthLabel = `${viewMonth.getFullYear()}년 ${viewMonth.getMonth() + 1}월`;
  const isCurrentMonth = useMemo(() => {
    const n = new Date();
    return viewMonth.getFullYear() === n.getFullYear() && viewMonth.getMonth() === n.getMonth();
  }, [viewMonth]);

  function shiftMonth(delta: number) {
    setMonthMode(true);
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
    if (filter.type !== 'all') params.set('type', filter.type);
    if (filter.categoryId) params.set('category_id', filter.categoryId);
    if (filter.tagId) params.set('tag_id', filter.tagId);
    if (monthMode) {
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const start = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      const end = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
      params.set('start_date', iso(start));
      params.set('end_date', iso(end));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [debouncedSearch, filter, monthMode, viewMonth]);

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

  const summaryParams = useMemo(() => {
    if (!monthMode) return '';
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const start = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const end = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
    return `?start_date=${iso(start)}&end_date=${iso(end)}`;
  }, [monthMode, viewMonth]);

  const summaryQuery = useQuery({
    queryKey: ['summary', id, summaryParams],
    queryFn: () => api<LedgerSummary>(`/api/ledgers/${id}/stats/summary${summaryParams}`),
    enabled: !!id,
  });

  const txnQuery = useQuery({
    queryKey: ['transactions', id, queryParams],
    queryFn: () => api<Transaction[]>(`/api/ledgers/${id}/transactions${queryParams}`),
    enabled: !!id,
  });

  // Storage persistence for summary mode
  useEffect(() => {
    if (!id) return;
    storage.get(`ledger.summaryMode.${id}`).then((saved) => {
      if (saved === 'balance' || saved === 'expense' || saved === 'simple') {
        setSummaryMode(saved as SummaryMode);
        setUserExplicitMode(true);
      }
    });
  }, [id]);

  // Auto-detection: If user has never set a preference and this ledger has no income, default to 'expense'
  useEffect(() => {
    if (!userExplicitMode && summaryQuery.data && !summaryQuery.data.has_income) {
      setSummaryMode('expense');
    }
  }, [userExplicitMode, summaryQuery.data]);

  function handleSelectMode(nextMode: SummaryMode) {
    setSummaryMode(nextMode);
    setUserExplicitMode(true);
    if (id) {
      storage.set(`ledger.summaryMode.${id}`, nextMode);
    }
  }

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

  const carryover = Number(summaryQuery.data?.carryover_balance ?? 0);
  const periodIncome = summaryQuery.data ? Number(summaryQuery.data.period_income) : totals.income;
  const periodExpense = summaryQuery.data ? Number(summaryQuery.data.period_expense) : totals.expense;
  const periodNet = summaryQuery.data ? Number(summaryQuery.data.period_net) : totals.income - totals.expense;
  const finalBalance = summaryQuery.data ? Number(summaryQuery.data.final_balance) : carryover + periodNet;
  const allTimeBalance = summaryQuery.data ? Number(summaryQuery.data.all_time_balance) : finalBalance;
  const prevExpense = Number(summaryQuery.data?.prev_period_expense ?? 0);

  const displayIncome = filterActive ? totals.income : periodIncome;
  const displayExpense = filterActive ? totals.expense : periodExpense;
  const displayNet = filterActive ? totals.income - totals.expense : periodNet;

  const expenseDiff = displayExpense - prevExpense;
  const isSaving = expenseDiff <= 0;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: ledgerQuery.data?.name ?? '거래 내역',
          headerRight: () => (
            <Pressable onPress={() => router.push(`/(app)/ledger/${id}/members`)} hitSlop={8}>
              <Text style={styles.headerLink}>멤버</Text>
            </Pressable>
          ),
        }}
      />

      <View style={styles.monthBar}>
        <Pressable
          style={styles.monthArrow}
          onPress={() => shiftMonth(-1)}
          disabled={!monthMode}
          hitSlop={8}
        >
          <Text style={[styles.monthArrowText, !monthMode && styles.monthDim]}>◀</Text>
        </Pressable>
        <Pressable style={styles.monthCenter} onPress={() => shiftMonth(0)}>
          <Text style={styles.monthLabel}>{monthMode ? monthLabel : '전체 기간'}</Text>
          {monthMode && !isCurrentMonth && <Text style={styles.monthToday}>이번 달로</Text>}
        </Pressable>
        <Pressable
          style={styles.monthArrow}
          onPress={() => shiftMonth(1)}
          disabled={!monthMode}
          hitSlop={8}
        >
          <Text style={[styles.monthArrowText, !monthMode && styles.monthDim]}>▶</Text>
        </Pressable>
        <Pressable
          style={[styles.monthAllButton, !monthMode && styles.monthAllButtonActive]}
          onPress={() => setMonthMode((v) => !v)}
        >
          <Text style={[styles.monthAllText, !monthMode && styles.monthAllTextActive]}>전체</Text>
        </Pressable>
      </View>

      {/* 종합 잔액 & 수입/지출 요약 카드 (모드 선택 지원) */}
      <View style={styles.summaryCard}>
        {/* 상단 모드 전환 탭/헤더 */}
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardHeaderTitle}>
            {summaryMode === 'balance'
              ? '💰 잔액 & 이월'
              : summaryMode === 'expense'
                ? '📉 지출 중심 요약'
                : '⚖️ 수입 / 지출'}
          </Text>
          <View style={styles.modePillRow}>
            {(['balance', 'expense', 'simple'] as SummaryMode[]).map((m) => (
              <Pressable
                key={m}
                style={[styles.modePill, summaryMode === m && styles.modePillActive]}
                onPress={() => handleSelectMode(m)}
                hitSlop={6}
              >
                <Text
                  style={[styles.modePillText, summaryMode === m && styles.modePillTextActive]}
                >
                  {SUMMARY_MODE_LABELS[m]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 1. 잔액 & 이월 모드 */}
        {summaryMode === 'balance' &&
          (monthMode ? (
            <>
              <View style={styles.summaryTopRow}>
                <View style={styles.summaryTopItem}>
                  <Text style={styles.summaryTopLabel}>전월 이월 (지난달까지)</Text>
                  <Text
                    style={[
                      styles.summaryTopValue,
                      { color: carryover >= 0 ? '#2563EB' : '#DC2626' },
                    ]}
                  >
                    {carryover > 0 ? '+' : ''}
                    {formatCurrency(carryover, currency)}
                  </Text>
                </View>
                <View style={styles.summaryTopDivider} />
                <View style={styles.summaryTopItem}>
                  <Text style={styles.summaryTopLabel}>당월 수지 (수입-지출)</Text>
                  <Text
                    style={[
                      styles.summaryTopValue,
                      { color: displayNet >= 0 ? '#16A34A' : '#DC2626' },
                    ]}
                  >
                    {displayNet > 0 ? '+' : ''}
                    {formatCurrency(displayNet, currency)}
                  </Text>
                </View>
              </View>

              <View style={styles.summaryCardDivider} />

              <View style={styles.summaryMainRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryMainLabel}>
                    {monthLabel} 말 기준 잔액{filterActive ? ' (필터 미적용)' : ''}
                  </Text>
                  <Text
                    style={[
                      styles.summaryMainBalance,
                      { color: finalBalance >= 0 ? '#111827' : '#DC2626' },
                    ]}
                  >
                    {formatCurrency(finalBalance, currency)}
                  </Text>
                </View>
                <View style={styles.summarySubAmounts}>
                  <View style={styles.summarySubItem}>
                    <View style={[styles.subDot, { backgroundColor: '#16A34A' }]} />
                    <Text style={styles.subLabel}>수입</Text>
                    <Text style={[styles.subAmount, { color: '#16A34A' }]}>
                      +{formatCurrency(displayIncome, currency)}
                    </Text>
                  </View>
                  <View style={styles.summarySubItem}>
                    <View style={[styles.subDot, { backgroundColor: '#DC2626' }]} />
                    <Text style={styles.subLabel}>지출</Text>
                    <Text style={[styles.subAmount, { color: '#DC2626' }]}>
                      -{formatCurrency(displayExpense, currency)}
                    </Text>
                  </View>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.summaryMainRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryMainLabel}>
                  전체 누적 잔액{filterActive ? ' (필터 미적용)' : ''}
                </Text>
                <Text
                  style={[
                    styles.summaryMainBalance,
                    { color: allTimeBalance >= 0 ? '#111827' : '#DC2626' },
                  ]}
                >
                  {formatCurrency(allTimeBalance, currency)}
                </Text>
              </View>
              <View style={styles.summarySubAmounts}>
                <View style={styles.summarySubItem}>
                  <View style={[styles.subDot, { backgroundColor: '#16A34A' }]} />
                  <Text style={styles.subLabel}>총 수입</Text>
                  <Text style={[styles.subAmount, { color: '#16A34A' }]}>
                    +{formatCurrency(displayIncome, currency)}
                  </Text>
                </View>
                <View style={styles.summarySubItem}>
                  <View style={[styles.subDot, { backgroundColor: '#DC2626' }]} />
                  <Text style={styles.subLabel}>총 지출</Text>
                  <Text style={[styles.subAmount, { color: '#DC2626' }]}>
                    -{formatCurrency(displayExpense, currency)}
                  </Text>
                </View>
              </View>
            </View>
          ))}

        {/* 2. 지출 중심 & 전월 비교 모드 */}
        {summaryMode === 'expense' &&
          (monthMode ? (
            <>
              <View style={styles.summaryTopRow}>
                <View style={styles.summaryTopItem}>
                  <Text style={styles.summaryTopLabel}>지난달 지출</Text>
                  <Text style={[styles.summaryTopValue, { color: '#4B5563' }]}>
                    {formatCurrency(prevExpense, currency)}
                  </Text>
                </View>
                <View style={styles.summaryTopDivider} />
                <View style={styles.summaryTopItem}>
                  <Text style={styles.summaryTopLabel}>전월 대비 변화</Text>
                  <Text
                    style={[
                      styles.summaryTopValue,
                      { color: isSaving ? '#16A34A' : '#DC2626' },
                    ]}
                  >
                    {prevExpense > 0
                      ? isSaving
                        ? `${formatCurrency(Math.abs(expenseDiff), currency)} 절약 👏`
                        : `${formatCurrency(expenseDiff, currency)} 증가 ⚠️`
                      : '비교 데이터 없음'}
                  </Text>
                </View>
              </View>

              <View style={styles.summaryCardDivider} />

              <View style={styles.summaryMainRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryMainLabel}>
                    {monthLabel} 총 지출{filterActive ? ' (필터 적용)' : ''}
                  </Text>
                  <Text style={[styles.summaryMainBalance, { color: '#DC2626' }]}>
                    {formatCurrency(displayExpense, currency)}
                  </Text>
                </View>
                <View style={styles.summarySubAmounts}>
                  {displayIncome > 0 ? (
                    <View style={styles.summarySubItem}>
                      <View style={[styles.subDot, { backgroundColor: '#16A34A' }]} />
                      <Text style={styles.subLabel}>수입</Text>
                      <Text style={[styles.subAmount, { color: '#16A34A' }]}>
                        +{formatCurrency(displayIncome, currency)}
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 11, color: '#9CA3AF' }}>지출 전용 가계부</Text>
                  )}
                </View>
              </View>
            </>
          ) : (
            <View style={styles.summaryMainRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryMainLabel}>
                  전체 누적 지출{filterActive ? ' (필터 적용)' : ''}
                </Text>
                <Text style={[styles.summaryMainBalance, { color: '#DC2626' }]}>
                  {formatCurrency(displayExpense, currency)}
                </Text>
              </View>
              <View style={styles.summarySubAmounts}>
                {displayIncome > 0 && (
                  <View style={styles.summarySubItem}>
                    <View style={[styles.subDot, { backgroundColor: '#16A34A' }]} />
                    <Text style={styles.subLabel}>총 수입</Text>
                    <Text style={[styles.subAmount, { color: '#16A34A' }]}>
                      +{formatCurrency(displayIncome, currency)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}

        {/* 3. 심플 2단 수입/지출 모드 */}
        {summaryMode === 'simple' && (
          <View style={styles.simpleRow}>
            <View style={styles.simpleItem}>
              <Text style={styles.simpleLabel}>수입{filterActive ? ' (필터)' : ''}</Text>
              <Text style={[styles.simpleValue, { color: '#16A34A' }]}>
                {formatCurrency(displayIncome, currency)}
              </Text>
            </View>
            <View style={styles.summaryTopDivider} />
            <View style={styles.simpleItem}>
              <Text style={styles.simpleLabel}>지출{filterActive ? ' (필터)' : ''}</Text>
              <Text style={[styles.simpleValue, { color: '#DC2626' }]}>
                {formatCurrency(displayExpense, currency)}
              </Text>
            </View>
          </View>
        )}
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
        <QuickButton label="🛒 품목 가격 검색" onPress={() => router.push(`/(app)/ledger/${id}/items-history`)} />
        <QuickButton label="예산·카테고리" onPress={() => router.push(`/(app)/ledger/${id}/budgets`)} />
        <QuickButton label="통계" onPress={() => router.push(`/(app)/ledger/${id}/stats`)} />
      </View>
      <View style={styles.quickRow}>
        <QuickButton label="반복 거래" onPress={() => router.push(`/(app)/ledger/${id}/recurring`)} />
        <QuickButton label="태그" onPress={() => router.push(`/(app)/ledger/${id}/tags`)} />
        <QuickButton label="환율" onPress={() => router.push(`/(app)/ledger/${id}/exchange-rates`)} />
        <QuickButton label="가져오기" onPress={() => router.push(`/(app)/ledger/${id}/data`)} />
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
          refreshing={txnQuery.isRefetching || summaryQuery.isRefetching}
          onRefresh={() => {
            txnQuery.refetch();
            summaryQuery.refetch();
          }}
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
                    {item.items && item.items.length > 0 && (
                      <Text style={styles.rowItemsPreview}>
                        🛒 {item.items[0].name}{item.items.length > 1 ? ` 외 ${item.items.length - 1}건` : ''}
                      </Text>
                    )}
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
              {filterActive
                ? '검색 조건에 맞는 거래가 없습니다'
                : monthMode
                  ? `${monthLabel}에 거래가 없습니다`
                  : '아직 거래가 없습니다'}
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
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  monthArrow: { paddingHorizontal: 10, paddingVertical: 4 },
  monthArrowText: { fontSize: 16, color: '#374151', fontWeight: '700' },
  monthDim: { color: '#D1D5DB' },
  monthCenter: { flex: 1, alignItems: 'center' },
  monthLabel: { fontSize: 16, fontWeight: '700', color: '#111827' },
  monthToday: { fontSize: 11, color: '#3B82F6', marginTop: 1 },
  monthAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  monthAllButtonActive: { backgroundColor: '#1F2937' },
  monthAllText: { fontWeight: '700', color: '#6B7280', fontSize: 13 },
  monthAllTextActive: { color: '#fff' },
  summaryCard: {
    backgroundColor: '#F8FAFC',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardHeaderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  modePillRow: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: '#E2E8F0',
    padding: 2,
    borderRadius: 14,
  },
  modePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  modePillActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  modePillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  modePillTextActive: {
    color: '#1E293B',
    fontWeight: '700',
  },
  simpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  simpleItem: {
    flex: 1,
    alignItems: 'center',
  },
  simpleLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
    fontWeight: '500',
  },
  simpleValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  summaryTopItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryTopDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#CBD5E1',
    marginHorizontal: 8,
  },
  summaryTopLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 2,
    fontWeight: '500',
  },
  summaryTopValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  summaryCardDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginBottom: 10,
  },
  summaryMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  summaryMainLabel: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
    marginBottom: 2,
  },
  summaryMainBalance: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  summarySubAmounts: {
    alignItems: 'flex-end',
    gap: 4,
  },
  summarySubItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  subDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  subLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  subAmount: {
    fontSize: 12,
    fontWeight: '700',
  },
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
  rowItemsPreview: { fontSize: 11, color: '#4F46E5', marginTop: 2, fontWeight: '500' },
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
