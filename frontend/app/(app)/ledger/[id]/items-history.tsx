import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { api } from '@/lib/api';
import type { ItemGroupSummary, ItemPriceHistoryResponse } from '@/lib/types';

export default function ItemsHistoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  // 등록된 품목 그룹 목록 조회 (칩 버튼용)
  const groupsQuery = useQuery({
    queryKey: ['items', 'groups', id],
    queryFn: () => api<ItemGroupSummary[]>(`/api/ledgers/${id}/items/groups`),
    enabled: !!id,
  });
  const groups = groupsQuery.data ?? [];

  // 품목 가격 히스토리 & 통계 조회
  const historyQuery = useQuery({
    queryKey: ['items', 'history', id, activeQuery, selectedGroup],
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeQuery.trim()) params.append('q', activeQuery.trim());
      else if (selectedGroup) params.append('q', selectedGroup);
      if (selectedGroup) params.append('item_group', selectedGroup);
      return api<ItemPriceHistoryResponse>(`/api/ledgers/${id}/items/history?${params.toString()}`);
    },
    enabled: !!id && (!!activeQuery.trim() || !!selectedGroup),
  });

  const data = historyQuery.data;
  const stats = data?.stats;
  const history = data?.history ?? [];

  function handleSearch() {
    if (!searchTerm.trim()) return;
    setSelectedGroup(null);
    setActiveQuery(searchTerm.trim());
  }

  function handleSelectGroup(group: string) {
    if (selectedGroup === group) {
      setSelectedGroup(null);
      setActiveQuery('');
    } else {
      setSelectedGroup(group);
      setSearchTerm(group);
      setActiveQuery(group);
    }
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '품목별 가격 검색 & 히스토리', headerBackTitle: '가계부' }} />

      {/* 상단 검색 영역 */}
      <View style={styles.searchSection}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="품목명 또는 그룹 검색 (예: 양파, 라면)"
            value={searchTerm}
            onChangeText={setSearchTerm}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          <Pressable style={styles.searchBtn} onPress={handleSearch}>
            <Text style={styles.searchBtnText}>검색</Text>
          </Pressable>
        </View>

        {/* 품목 그룹 추천 칩 */}
        {groups.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.groupChipsScroll} contentContainerStyle={styles.groupChipsContent}>
            {groups.map((g) => {
              const isSelected = selectedGroup === g.item_group;
              return (
                <Pressable
                  key={g.item_group}
                  style={[styles.groupChip, isSelected && styles.groupChipActive]}
                  onPress={() => handleSelectGroup(g.item_group)}
                >
                  <Text style={[styles.groupChipText, isSelected && styles.groupChipTextActive]}>
                    #{g.item_group} ({g.item_count})
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* 결과 영역 */}
      {historyQuery.isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>가격 데이터를 불러오는 중...</Text>
        </View>
      ) : !activeQuery && !selectedGroup ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyTitle}>품목별 가격 히스토리 검색</Text>
          <Text style={styles.emptySubtitle}>
            궁금한 품목(예: 양파, 라면, 우유)을 검색하거나{'\n'}상단의 그룹 칩을 터치하여 이전 구매 가격을 확인하세요.
          </Text>
        </View>
      ) : history.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>&apos;{activeQuery}&apos; 구매 기록이 없습니다</Text>
          <Text style={styles.emptySubtitle}>거래 등록 시 세부 품목을 추가하면 이곳에서 가격을 추적할 수 있습니다.</Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            stats && (
              <View style={styles.statsCard}>
                <View style={styles.statsHeader}>
                  <Text style={styles.statsTitle}>📊 &apos;{stats.query}&apos; 가격 분석</Text>
                  <Text style={styles.statsCount}>총 {stats.count}건 구매 기록</Text>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statsBox}>
                    <Text style={styles.statsLabel}>최근 구매가</Text>
                    <Text style={[styles.statsValue, { color: '#2563EB' }]}>
                      {stats.latest_unit_price !== null ? `${stats.latest_unit_price.toLocaleString()}원` : '-'}
                    </Text>
                    <Text style={styles.statsSub}>{stats.latest_date ? `${stats.latest_date} (${stats.latest_payee || '거래처 미입력'})` : ''}</Text>
                  </View>

                  <View style={styles.statsBox}>
                    <Text style={styles.statsLabel}>평균 구매가</Text>
                    <Text style={styles.statsValue}>
                      {stats.avg_unit_price !== null ? `${stats.avg_unit_price.toLocaleString()}원` : '-'}
                    </Text>
                    <Text style={styles.statsSub}>전체 평균 단가</Text>
                  </View>

                  <View style={styles.statsBox}>
                    <Text style={styles.statsLabel}>최저가</Text>
                    <Text style={[styles.statsValue, { color: '#059669' }]}>
                      {stats.min_unit_price !== null ? `${stats.min_unit_price.toLocaleString()}원` : '-'}
                    </Text>
                    <Text style={styles.statsSub}>가장 저렴했던 가격</Text>
                  </View>

                  <View style={styles.statsBox}>
                    <Text style={styles.statsLabel}>최고가</Text>
                    <Text style={[styles.statsValue, { color: '#DC2626' }]}>
                      {stats.max_unit_price !== null ? `${stats.max_unit_price.toLocaleString()}원` : '-'}
                    </Text>
                    <Text style={styles.statsSub}>가장 비쌌던 가격</Text>
                  </View>
                </View>

                <Text style={styles.historyListTitle}>📋 상세 구매 이력 타임라인</Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.historyItem}
              onPress={() => router.push(`/(app)/ledger/${id}/transaction/${item.transaction_id}`)}
            >
              <View style={styles.historyItemHeader}>
                <View style={styles.dateAndPayee}>
                  <Text style={styles.historyDate}>{item.transaction_date}</Text>
                  <Text style={styles.historyPayee}>{item.payee || '거래처 미입력'}</Text>
                </View>
                <View style={styles.priceContainer}>
                  <Text style={styles.unitPriceText}>
                    단가 {item.unit_price !== null ? `${item.unit_price.toLocaleString()}원` : '-'}
                  </Text>
                  <Text style={styles.totalPriceText}>
                    총 {item.total_price.toLocaleString()} {item.currency} ({item.quantity}개)
                  </Text>
                </View>
              </View>

              <View style={styles.historyItemBody}>
                <Text style={styles.itemNameText}>{item.name}</Text>
                {item.item_group && (
                  <View style={styles.groupBadge}>
                    <Text style={styles.groupBadgeText}>#{item.item_group}</Text>
                  </View>
                )}
              </View>

              {item.memo && <Text style={styles.itemMemoText}>메모: {item.memo}</Text>}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  searchSection: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderColor: '#E5E7EB' },
  searchRow: { flexDirection: 'row', gap: 8 },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#F9FAFB',
  },
  searchBtn: { backgroundColor: '#3B82F6', paddingHorizontal: 18, borderRadius: 8, justifyContent: 'center' },
  searchBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  groupChipsScroll: { marginTop: 12 },
  groupChipsContent: { gap: 8, paddingRight: 8 },
  groupChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F3F4F6',
  },
  groupChipActive: { backgroundColor: '#1F2937', borderColor: '#1F2937' },
  groupChipText: { fontSize: 13, color: '#4B5563', fontWeight: '600' },
  groupChipTextActive: { color: '#fff' },

  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#1F2937', marginBottom: 6, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },

  listContent: { padding: 16, paddingBottom: 40 },
  statsCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  statsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statsTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  statsCount: { fontSize: 12, color: '#6B7280' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  statsBox: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  statsLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  statsValue: { fontSize: 16, fontWeight: '700', color: '#111827', marginVertical: 2 },
  statsSub: { fontSize: 10, color: '#9CA3AF' },
  historyListTitle: { fontSize: 14, fontWeight: '700', color: '#374151', marginTop: 4 },

  historyItem: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
  },
  historyItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  dateAndPayee: { gap: 2 },
  historyDate: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  historyPayee: { fontSize: 14, fontWeight: '700', color: '#1F2937' },
  priceContainer: { alignItems: 'flex-end', gap: 2 },
  unitPriceText: { fontSize: 14, fontWeight: '700', color: '#2563EB' },
  totalPriceText: { fontSize: 12, color: '#6B7280' },
  historyItemBody: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  itemNameText: { fontSize: 15, color: '#111827', fontWeight: '600' },
  groupBadge: { backgroundColor: '#EEF2FF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  groupBadgeText: { fontSize: 11, color: '#4F46E5', fontWeight: '600' },
  itemMemoText: { fontSize: 12, color: '#6B7280', marginTop: 6, fontStyle: 'italic' },
});
