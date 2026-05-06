import { useQuery } from '@tanstack/react-query';
import { Link, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Ledger } from '@/lib/types';

export default function LedgerListScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const { data: ledgers, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ['ledgers'],
    queryFn: () => api<Ledger[]>('/api/ledgers'),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>가계부를 불러올 수 없습니다</Text>
        <Pressable onPress={() => refetch()} style={styles.retryButton}>
          <Text style={styles.retryText}>다시 시도</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>안녕하세요, {user?.name}님</Text>
        <Pressable onPress={signOut}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </Pressable>
      </View>

      <FlatList
        data={ledgers ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => router.push(`/(app)/ledger/${item.id}`)}
          >
            <View>
              <Text style={styles.cardName}>{item.name}</Text>
              <Text style={styles.cardMeta}>
                {item.type === 'personal' ? '개인' : '공유'} · {item.currency}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.empty}>가계부가 없습니다</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  greeting: { fontSize: 16, fontWeight: '600' },
  logoutText: { color: '#6B7280', fontSize: 14 },
  list: { padding: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardName: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  cardMeta: { fontSize: 13, color: '#6B7280' },
  chevron: { fontSize: 28, color: '#D1D5DB' },
  empty: { textAlign: 'center', color: '#9CA3AF', marginTop: 40 },
  errorText: { color: '#DC2626', marginBottom: 16 },
  retryButton: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#3B82F6' },
  retryText: { color: '#fff', fontWeight: '600' },
});
