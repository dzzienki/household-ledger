import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { confirmAsync, notify } from '@/lib/dialog';

import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Ledger, LedgerMember, LedgerRole } from '@/lib/types';

const ROLE_LABEL: Record<LedgerRole, string> = {
  owner: '소유자',
  editor: '편집자',
  viewer: '뷰어',
};

export default function MembersScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const ledgerQuery = useQuery({
    queryKey: ['ledger', ledgerId],
    queryFn: () => api<Ledger>(`/api/ledgers/${ledgerId}`),
    enabled: !!ledgerId,
  });

  const membersQuery = useQuery({
    queryKey: ['members', ledgerId],
    queryFn: () => api<LedgerMember[]>(`/api/ledgers/${ledgerId}/members`),
    enabled: !!ledgerId,
  });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<LedgerRole>('editor');

  const isOwner = ledgerQuery.data?.owner_id === user?.id;

  const inviteMutation = useMutation({
    mutationFn: () =>
      api<LedgerMember>(`/api/ledgers/${ledgerId}/members`, {
        method: 'POST',
        body: { email: email.trim(), role },
      }),
    onSuccess: () => {
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['members', ledgerId] });
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '초대 실패';
      notify('오류', msg);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/ledgers/${ledgerId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', ledgerId] }),
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '제거 실패';
      notify('오류', msg);
    },
  });

  async function confirmRemove(member: LedgerMember) {
    if (await confirmAsync('멤버 제거', `${member.name}님을 가계부에서 제거할까요?`, { confirmText: '제거', destructive: true }))
      removeMutation.mutate(member.user_id);
  }

  if (ledgerQuery.isLoading || membersQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '멤버 관리' }} />

      {isOwner && (
        <View style={styles.inviteCard}>
          <Text style={styles.inviteTitle}>새 멤버 초대</Text>
          <TextInput
            style={styles.input}
            placeholder="초대할 사용자의 이메일"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <View style={styles.roleRow}>
            {(['editor', 'viewer'] as LedgerRole[]).map((r) => (
              <Pressable
                key={r}
                style={[styles.roleChip, role === r && styles.roleChipActive]}
                onPress={() => setRole(r)}
              >
                <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>
                  {ROLE_LABEL[r]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={[
              styles.inviteButton,
              (!email.trim() || inviteMutation.isPending) && { opacity: 0.6 },
            ]}
            disabled={!email.trim() || inviteMutation.isPending}
            onPress={() => inviteMutation.mutate()}
          >
            {inviteMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.inviteButtonText}>초대</Text>
            )}
          </Pressable>
        </View>
      )}

      <Text style={styles.sectionTitle}>현재 멤버</Text>
      <FlatList
        data={membersQuery.data ?? []}
        keyExtractor={(m) => m.user_id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          const canRemove = isOwner && item.role !== 'owner';
          return (
            <View style={styles.memberRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.memberName}>
                  {item.name}
                  {item.user_id === user?.id ? ' (나)' : ''}
                </Text>
                <Text style={styles.memberMeta}>
                  {item.email} · {ROLE_LABEL[item.role]}
                </Text>
              </View>
              {canRemove && (
                <Pressable onPress={() => confirmRemove(item)}>
                  <Text style={styles.removeText}>제거</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  inviteCard: {
    margin: 16,
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inviteTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  roleChipActive: { backgroundColor: '#1F2937', borderColor: '#1F2937' },
  roleChipText: { color: '#374151', fontWeight: '600' },
  roleChipTextActive: { color: '#fff' },
  inviteButton: { backgroundColor: '#3B82F6', padding: 12, borderRadius: 8, alignItems: 'center' },
  inviteButtonText: { color: '#fff', fontWeight: '700' },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
  },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  removeText: { color: '#DC2626', fontWeight: '600' },
});
