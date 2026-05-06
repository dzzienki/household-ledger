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
      <Stack.Screen name="ledger/[id]/index" options={{ title: '거래 내역' }} />
      <Stack.Screen
        name="ledger/[id]/new-transaction"
        options={{ title: '거래 추가', presentation: 'modal' }}
      />
    </Stack>
  );
}
