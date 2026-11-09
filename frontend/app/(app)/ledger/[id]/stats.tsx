import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CategoryPieChart, MonthlyBarChart, type MonthlyDatum, type PieDatum } from '@/components/charts';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import type { Ledger, TransactionType } from '@/lib/types';

interface MonthlyTotal {
  year: number;
  month: number;
  income: string;
  expense: string;
}

interface CategoryTotal {
  category_id: string | null;
  category_name: string;
  color: string;
  type: string;
  total: string;
  count: number;
}

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;

export default function StatsScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(CURRENT_MONTH);
  const [pieType, setPieType] = useState<TransactionType>('expense');

  const ledgerQuery = useQuery({
    queryKey: ['ledger', ledgerId],
    queryFn: () => api<Ledger>(`/api/ledgers/${ledgerId}`),
    enabled: !!ledgerId,
  });

  const monthlyQuery = useQuery({
    queryKey: ['stats', 'monthly', ledgerId, year],
    queryFn: () => api<MonthlyTotal[]>(`/api/ledgers/${ledgerId}/stats/monthly?year=${year}`),
    enabled: !!ledgerId,
  });

  // Calculate start/end date for category stats query
  const categoryParams = useMemo(() => {
    if (selectedMonth !== null) {
      const start = `${year}-${String(selectedMonth).padStart(2, '0')}-01`;
      const lastDay = new Date(year, selectedMonth, 0).getDate();
      const end = `${year}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return `&start_date=${start}&end_date=${end}`;
    } else {
      return `&start_date=${year}-01-01&end_date=${year}-12-31`;
    }
  }, [year, selectedMonth]);

  const categoryQuery = useQuery({
    queryKey: ['stats', 'categories', ledgerId, pieType, categoryParams],
    queryFn: () =>
      api<CategoryTotal[]>(`/api/ledgers/${ledgerId}/stats/categories?type=${pieType}${categoryParams}`),
    enabled: !!ledgerId,
  });

  const currency = ledgerQuery.data?.currency ?? 'KRW';

  const monthlyData: MonthlyDatum[] = (monthlyQuery.data ?? []).map((m) => ({
    month: m.month,
    income: Number(m.income),
    expense: Number(m.expense),
  }));

  const yearTotal = monthlyData.reduce(
    (acc, m) => ({ income: acc.income + m.income, expense: acc.expense + m.expense }),
    { income: 0, expense: 0 },
  );

  // Current scope totals
  const currentMonthDatum = selectedMonth !== null
    ? monthlyData.find((m) => m.month === selectedMonth)
    : null;
  const scopeIncome = currentMonthDatum ? currentMonthDatum.income : yearTotal.income;
  const scopeExpense = currentMonthDatum ? currentMonthDatum.expense : yearTotal.expense;
  const scopeNet = scopeIncome - scopeExpense;

  const isCurrentMonthScope = selectedMonth === CURRENT_MONTH && year === CURRENT_YEAR;

  function shiftMonth(delta: number) {
    if (selectedMonth === null) {
      // If currently annual mode, switch to current month or step year
      setYear((y) => Math.min(CURRENT_YEAR, y + delta));
      return;
    }
    let nextM = selectedMonth + delta;
    let nextY = year;
    if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    } else if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    setYear(nextY);
    setSelectedMonth(nextM);
  }

  function resetToCurrentMonth() {
    setYear(CURRENT_YEAR);
    setSelectedMonth(CURRENT_MONTH);
  }

  function toggleAnnualMode() {
    if (selectedMonth === null) {
      setSelectedMonth(CURRENT_MONTH);
    } else {
      setSelectedMonth(null);
    }
  }

  const pieData: PieDatum[] = (categoryQuery.data ?? []).map((c, i) => ({
    id: c.category_id ?? `null-${i}`,
    label: c.category_name,
    color: c.color,
    value: Number(c.total),
  }));

  const periodLabel = selectedMonth !== null
    ? `${year}년 ${selectedMonth}월`
    : `${year}년 전체 (연간)`;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Stack.Screen options={{ title: '통계' }} />

      {/* 1. 상단 월별/연간 이동 컨트롤러 */}
      <View style={styles.periodBar}>
        <Pressable
          style={styles.arrowBtn}
          onPress={() => shiftMonth(-1)}
          hitSlop={8}
        >
          <Text style={styles.arrowText}>◀</Text>
        </Pressable>

        <Pressable
          style={styles.periodCenter}
          onPress={resetToCurrentMonth}
          hitSlop={6}
        >
          <Text style={styles.periodLabel}>{periodLabel}</Text>
          {selectedMonth !== null && !isCurrentMonthScope && (
            <Text style={styles.todayBadge}>이번 달로 이동</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.arrowBtn, (year >= CURRENT_YEAR && selectedMonth !== null && selectedMonth >= 12) && { opacity: 0.4 }]}
          onPress={() => shiftMonth(1)}
          hitSlop={8}
        >
          <Text style={styles.arrowText}>▶</Text>
        </Pressable>

        <Pressable
          style={[styles.annualToggleBtn, selectedMonth === null && styles.annualToggleBtnActive]}
          onPress={toggleAnnualMode}
          hitSlop={6}
        >
          <Text style={[styles.annualToggleText, selectedMonth === null && styles.annualToggleTextActive]}>
            {selectedMonth === null ? '월별' : '연간'}
          </Text>
        </Pressable>
      </View>

      {/* 2. 해당 기간 수입 / 지출 / 수지 요약 카드 */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>{selectedMonth !== null ? `${selectedMonth}월 수입` : '연간 수입'}</Text>
          <Text style={[styles.summaryValue, { color: '#16A34A' }]}>
            +{formatCurrency(scopeIncome, currency)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>{selectedMonth !== null ? `${selectedMonth}월 지출` : '연간 지출'}</Text>
          <Text style={[styles.summaryValue, { color: '#DC2626' }]}>
            -{formatCurrency(scopeExpense, currency)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>수지 (수입-지출)</Text>
          <Text style={[styles.summaryValue, { color: scopeNet >= 0 ? '#16A34A' : '#DC2626' }]}>
            {scopeNet > 0 ? '+' : ''}{formatCurrency(scopeNet, currency)}
          </Text>
        </View>
      </View>

      {/* 3. 월별 수입/지출 비교 차트 (바 차트) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>월별 추이 ({year}년)</Text>
          <View style={styles.yearBtnRow}>
            <Pressable onPress={() => setYear((y) => y - 1)} style={styles.yearButton} hitSlop={6}>
              <Text style={styles.yearButtonText}>‹</Text>
            </Pressable>
            <Text style={styles.yearText}>{year}년</Text>
            <Pressable
              onPress={() => setYear((y) => y + 1)}
              style={[styles.yearButton, year >= CURRENT_YEAR && { opacity: 0.4 }]}
              disabled={year >= CURRENT_YEAR}
              hitSlop={6}
            >
              <Text style={styles.yearButtonText}>›</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.chartHint}>
          💡 아래 월(1~12)을 누르면 해당 월의 카테고리 상세 통계로 바로 전환됩니다.
        </Text>

        {monthlyQuery.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 40 }} />
        ) : (
          <MonthlyBarChart
            data={monthlyData}
            currency={currency}
            selectedMonth={selectedMonth}
            onSelectMonth={(m) => setSelectedMonth(m)}
          />
        )}
      </View>

      {/* 4. 카테고리별 상세 통계 (원형 차트 & 리스트) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            카테고리별 ({selectedMonth !== null ? `${year}년 ${selectedMonth}월` : `${year}년 전체`})
          </Text>
        </View>

        <View style={styles.toggleRow}>
          {(['expense', 'income'] as TransactionType[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.toggleButton, pieType === t && (t === 'income' ? styles.toggleIncomeActive : styles.toggleButtonActive)]}
              onPress={() => setPieType(t)}
            >
              <Text style={[styles.toggleText, pieType === t && styles.toggleTextActive]}>
                {t === 'expense' ? '📉 지출 통계' : '💰 수입 통계'}
              </Text>
            </Pressable>
          ))}
        </View>

        {categoryQuery.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 40 }} />
        ) : (
          <CategoryPieChart data={pieData} currency={currency} />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  // 월별 이동 바
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  arrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { fontSize: 15, color: '#374151', fontWeight: '700' },
  periodCenter: { alignItems: 'center', flex: 1, marginHorizontal: 8 },
  periodLabel: { fontSize: 17, fontWeight: '700', color: '#111827' },
  todayBadge: { fontSize: 11, color: '#2563EB', fontWeight: '600', marginTop: 2 },
  annualToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  annualToggleBtnActive: {
    backgroundColor: '#1F2937',
    borderColor: '#1F2937',
  },
  annualToggleText: { fontSize: 12, fontWeight: '600', color: '#4B5563' },
  annualToggleTextActive: { color: '#fff' },

  // 수입 / 지출 요약 카드
  summaryCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    alignItems: 'center',
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 32, backgroundColor: '#E5E7EB' },
  summaryLabel: { fontSize: 11, color: '#6B7280', marginBottom: 4, fontWeight: '500' },
  summaryValue: { fontSize: 14, fontWeight: '700' },

  // 섹션
  section: {
    backgroundColor: '#fff',
    marginTop: 12,
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  chartHint: { fontSize: 11, color: '#9CA3AF', marginBottom: 10 },
  yearBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  yearText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  yearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearButtonText: { fontSize: 15, fontWeight: '700', color: '#374151' },

  // 수입/지출 토글 탭
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  toggleButtonActive: { backgroundColor: '#DC2626' },
  toggleIncomeActive: { backgroundColor: '#16A34A' },
  toggleText: { fontWeight: '600', color: '#6B7280', fontSize: 13 },
  toggleTextActive: { color: '#fff', fontWeight: '700' },
});
