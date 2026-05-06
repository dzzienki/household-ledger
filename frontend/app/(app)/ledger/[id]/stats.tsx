import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
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

const CURRENT_YEAR = new Date().getFullYear();

export default function StatsScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const [year, setYear] = useState(CURRENT_YEAR);
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

  const categoryQuery = useQuery({
    queryKey: ['stats', 'categories', ledgerId, pieType],
    queryFn: () =>
      api<CategoryTotal[]>(`/api/ledgers/${ledgerId}/stats/categories?type=${pieType}`),
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

  const pieData: PieDatum[] = (categoryQuery.data ?? []).map((c, i) => ({
    id: c.category_id ?? `null-${i}`,
    label: c.category_name,
    color: c.color,
    value: Number(c.total),
  }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen options={{ title: '통계' }} />

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>월별 ({year}년)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => setYear(year - 1)} style={styles.yearButton}>
              <Text style={styles.yearButtonText}>‹</Text>
            </Pressable>
            <Pressable
              onPress={() => setYear(year + 1)}
              style={[styles.yearButton, year >= CURRENT_YEAR && { opacity: 0.4 }]}
              disabled={year >= CURRENT_YEAR}
            >
              <Text style={styles.yearButtonText}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>연간 수입</Text>
            <Text style={[styles.summaryValue, { color: '#16A34A' }]}>
              {formatCurrency(yearTotal.income, currency)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>연간 지출</Text>
            <Text style={[styles.summaryValue, { color: '#DC2626' }]}>
              {formatCurrency(yearTotal.expense, currency)}
            </Text>
          </View>
        </View>

        {monthlyQuery.isLoading ? (
          <ActivityIndicator style={{ marginVertical: 40 }} />
        ) : (
          <MonthlyBarChart data={monthlyData} currency={currency} />
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>카테고리별 (이번 달)</Text>
        </View>

        <View style={styles.toggleRow}>
          {(['expense', 'income'] as TransactionType[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.toggleButton, pieType === t && styles.toggleButtonActive]}
              onPress={() => setPieType(t)}
            >
              <Text style={[styles.toggleText, pieType === t && styles.toggleTextActive]}>
                {t === 'expense' ? '지출' : '수입'}
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
  container: { flex: 1, backgroundColor: '#fff' },
  section: {
    padding: 16,
    borderBottomWidth: 8,
    borderBottomColor: '#F3F4F6',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  yearButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearButtonText: { fontSize: 18, fontWeight: '700', color: '#374151' },
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  summaryItem: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  summaryValue: { fontSize: 16, fontWeight: '700' },
  toggleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  toggleButtonActive: { backgroundColor: '#1F2937' },
  toggleText: { fontWeight: '600', color: '#6B7280' },
  toggleTextActive: { color: '#fff' },
});
