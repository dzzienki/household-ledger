import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Screen name="index" options={{ title: '내 가계부' }} />
      <Stack.Screen name="new-ledger" options={{ title: '새 가계부', presentation: 'modal' }} />
      <Stack.Screen name="ledger/[id]/index" options={{ title: '거래 내역' }} />
      <Stack.Screen
        name="ledger/[id]/new-transaction"
        options={{ title: '거래 추가', presentation: 'modal' }}
      />
      <Stack.Screen
        name="ledger/[id]/transaction/[txnId]"
        options={{ title: '거래 수정', presentation: 'modal' }}
      />
      <Stack.Screen name="ledger/[id]/categories" options={{ title: '카테고리' }} />
      <Stack.Screen name="ledger/[id]/members" options={{ title: '멤버' }} />
      <Stack.Screen name="ledger/[id]/stats" options={{ title: '통계' }} />
    </Stack>
  );
}
