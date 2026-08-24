import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { confirmAsync, notify } from '@/lib/dialog';

import { api, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { copyToClipboard, getInviteUrl, shareInviteLink } from '@/lib/share';
import type { InvitationPublic, Ledger, LedgerMember, LedgerRole } from '@/lib/types';

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

  const isOwner = ledgerQuery.data?.owner_id === user?.id;

  const invitationQuery = useQuery({
    queryKey: ['invitation', ledgerId],
    queryFn: () => api<InvitationPublic>(`/api/ledgers/${ledgerId}/invitation`),
    enabled: !!ledgerId && isOwner,
  });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<LedgerRole>('editor');
  const [linkRole, setLinkRole] = useState<LedgerRole>('editor');

  const newInviteMutation = useMutation({
    mutationFn: (r: LedgerRole) =>
      api<InvitationPublic>(`/api/ledgers/${ledgerId}/invitation`, {
        method: 'POST',
        body: { role: r },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['invitation', ledgerId], data);
      notify('완료', '새로운 초대 링크가 생성되었습니다.');
    },
    onError: (err) => {
      notify('오류', getErrorMessage(err, '초대 링크 생성 실패'));
    },
  });

  const inviteCode = invitationQuery.data?.code;
  const inviteUrl = inviteCode ? getInviteUrl(inviteCode) : '';

  async function handleCopyLink() {
    if (!inviteUrl) return;
    const ok = await copyToClipboard(inviteUrl);
    if (ok) {
      notify('복사 완료', '초대 링크가 복사되었습니다!\n카카오톡이나 문자메시지에 붙여넣어 보내세요.');
    } else {
      notify('복사 안내', `링크: ${inviteUrl}`);
    }
  }

  async function handleNativeShare() {
    if (!inviteCode) return;
    await shareInviteLink({
      ledgerName: ledgerQuery.data?.name ?? '가계부',
      inviterName: user?.name,
      code: inviteCode,
    });
  }

  const inviteMutation = useMutation({
    mutationFn: () => {
      const trimmed = email.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) {
        throw new Error('올바른 이메일 형식을 입력해 주세요 (예: user@example.com)');
      }
      return api<LedgerMember>(`/api/ledgers/${ledgerId}/members`, {
        method: 'POST',
        body: { email: trimmed, role },
      });
    },
    onSuccess: () => {
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['members', ledgerId] });
      notify('초대 완료', '멤버가 추가되었습니다.');
    },
    onError: (err) => {
      notify('오류', getErrorMessage(err, '초대 실패'));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/ledgers/${ledgerId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', ledgerId] }),
    onError: (err) => {
      notify('오류', getErrorMessage(err, '제거 실패'));
    },
  });

  async function confirmRemove(member: LedgerMember) {
    if (
      await confirmAsync('멤버 제거', `${member.name}님을 가계부에서 제거할까요?`, {
        confirmText: '제거',
        destructive: true,
      })
    )
      removeMutation.mutate(member.user_id);
  }

  if (ledgerQuery.isLoading || membersQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const renderHeader = () => (
    <View>
      {isOwner && (
        <>
          {/* 1. 초대 링크 공유 카드 */}
          <View style={styles.shareCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.shareCardTitle}>🔗 초대 링크로 공유</Text>
              <Pressable
                onPress={() => newInviteMutation.mutate(linkRole)}
                disabled={newInviteMutation.isPending}
                hitSlop={8}
              >
                <Text style={styles.refreshLinkText}>
                  {newInviteMutation.isPending ? '생성 중…' : '🔄 새 링크 생성'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.shareCardDesc}>
              카카오톡이나 문자로 링크를 보내면 상대방이 클릭 한 번으로 바로 가계부에 참여할 수 있습니다.
            </Text>

            <View style={styles.roleLabelRow}>
              <Text style={styles.fieldLabel}>부여할 권한</Text>
            </View>
            <View style={styles.roleRow}>
              {(['editor', 'viewer'] as LedgerRole[]).map((r) => (
                <Pressable
                  key={r}
                  style={[styles.roleChip, linkRole === r && styles.roleChipActive]}
                  onPress={() => {
                    setLinkRole(r);
                    if (invitationQuery.data?.role !== r) {
                      newInviteMutation.mutate(r);
                    }
                  }}
                >
                  <Text style={[styles.roleChipText, linkRole === r && styles.roleChipTextActive]}>
                    {ROLE_LABEL[r]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.urlBox}>
              <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
                {invitationQuery.isLoading ? '초대 링크 생성 중…' : inviteUrl}
              </Text>
            </View>

            <View style={styles.buttonRow}>
              <Pressable style={styles.copyButton} onPress={handleCopyLink} disabled={!inviteUrl}>
                <Text style={styles.copyButtonText}>📋 링크 복사</Text>
              </Pressable>
              <Pressable style={styles.shareButton} onPress={handleNativeShare} disabled={!inviteUrl}>
                <Text style={styles.shareButtonText}>📱 카톡 / 메시지 공유</Text>
              </Pressable>
            </View>
          </View>

          {/* 2. 이메일로 직접 추가 카드 */}
          <View style={styles.inviteCard}>
            <Text style={styles.inviteTitle}>✉️ 이메일로 직접 추가</Text>
            <Text style={styles.inviteDesc}>가입된 상대방의 이메일 주소를 입력해 즉시 멤버로 추가합니다.</Text>
            <TextInput
              style={styles.input}
              placeholder="상대방 가입 이메일"
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
                <Text style={styles.inviteButtonText}>멤버 추가</Text>
              )}
            </Pressable>
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>현재 멤버 ({membersQuery.data?.length ?? 0}명)</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '멤버 관리' }} />

      <FlatList
        data={membersQuery.data ?? []}
        keyExtractor={(m) => m.user_id}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={{ paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          const canRemove = isOwner && item.role !== 'owner';
          return (
            <View style={styles.memberRowWrapper}>
              <View style={styles.memberRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.memberName}>{item.name}</Text>
                    {item.user_id === user?.id && <Text style={styles.meBadge}>나</Text>}
                  </View>
                  <Text style={styles.memberMeta}>
                    {item.email} · <Text style={{ fontWeight: '600', color: '#374151' }}>{ROLE_LABEL[item.role]}</Text>
                  </Text>
                </View>
                {canRemove && (
                  <Pressable onPress={() => confirmRemove(item)} style={styles.removeBtn}>
                    <Text style={styles.removeText}>제거</Text>
                  </Pressable>
                )}
              </View>
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
  shareCard: {
    margin: 16,
    marginBottom: 8,
    padding: 16,
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  shareCardTitle: { fontSize: 16, fontWeight: '700', color: '#1E40AF' },
  shareCardDesc: { fontSize: 13, color: '#3B82F6', marginBottom: 12, lineHeight: 18 },
  refreshLinkText: { fontSize: 12, color: '#2563EB', fontWeight: '600' },
  fieldLabel: { fontSize: 12, color: '#4B5563', fontWeight: '600', marginBottom: 6 },
  roleLabelRow: { marginTop: 4 },
  urlBox: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 12,
  },
  urlText: { fontSize: 13, color: '#1F2937' },
  buttonRow: { flexDirection: 'row', gap: 10 },
  copyButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  copyButtonText: { color: '#2563EB', fontWeight: '700', fontSize: 14 },
  shareButton: {
    flex: 1,
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  inviteCard: {
    margin: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inviteTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4, color: '#111827' },
  inviteDesc: { fontSize: 12, color: '#6B7280', marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 11,
    fontSize: 14,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  roleChipActive: { backgroundColor: '#1F2937', borderColor: '#1F2937' },
  roleChipText: { color: '#374151', fontWeight: '600', fontSize: 13 },
  roleChipTextActive: { color: '#fff' },
  inviteButton: { backgroundColor: '#4B5563', padding: 11, borderRadius: 8, alignItems: 'center' },
  inviteButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  memberRowWrapper: { paddingHorizontal: 16 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  memberName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  meBadge: {
    fontSize: 11,
    color: '#2563EB',
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    fontWeight: '600',
  },
  memberMeta: { fontSize: 12, color: '#6B7280', marginTop: 3 },
  removeBtn: { padding: 6 },
  removeText: { color: '#DC2626', fontWeight: '600', fontSize: 13 },
});
