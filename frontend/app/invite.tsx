import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { notify } from '@/lib/dialog';

import { api, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { InvitationAcceptResponse, InvitationInfo } from '@/lib/types';

export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const inviteQuery = useQuery({
    queryKey: ['invitation-info', code],
    queryFn: () => api<InvitationInfo>(`/api/invitations/${code}`),
    enabled: !!code,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () =>
      api<InvitationAcceptResponse>(`/api/invitations/${code}/accept`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ledgers'] });
      notify(
        '참여 완료',
        data.already_member
          ? `이미 '${data.ledger_name}' 가계부의 멤버입니다.`
          : `'${data.ledger_name}' 가계부에 참여했습니다!`,
      );
      router.replace(`/(app)/ledger/${data.ledger_id}`);
    },
    onError: (err) => {
      notify('초대 수락 실패', getErrorMessage(err, '초대 수락에 실패했습니다.'));
    },
  });

  if (!code) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>잘못된 접근</Text>
        <Text style={styles.errorDesc}>초대 코드가 제공되지 않았습니다.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace('/')}>
          <Text style={styles.primaryButtonText}>홈으로 이동</Text>
        </Pressable>
      </View>
    );
  }

  if (inviteQuery.isLoading || authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>초대 정보를 확인하고 있습니다…</Text>
      </View>
    );
  }

  if (inviteQuery.isError || !inviteQuery.data) {
    const errorMsg = getErrorMessage(inviteQuery.error, '유효하지 않거나 만료된 초대 링크입니다.');
    return (
      <View style={styles.center}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.errorTitle}>초대 링크 오류</Text>
        <Text style={styles.errorDesc}>{errorMsg}</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace('/')}>
          <Text style={styles.primaryButtonText}>홈으로 이동</Text>
        </Pressable>
      </View>
    );
  }

  const info = inviteQuery.data;
  const roleLabel = info.role === 'editor' ? '편집자 (기록 및 관리 가능)' : '뷰어 (조회 전용)';

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>💌</Text>
        <Text style={styles.subTitle}>{info.inviter_name}님이 가계부에 초대했습니다</Text>
        <Text style={styles.ledgerName}>{info.ledger_name}</Text>

        <View style={styles.badgeWrap}>
          <Text style={styles.badgeText}>권한: {roleLabel}</Text>
        </View>

        {user ? (
          <View style={styles.actionWrap}>
            <Text style={styles.userHint}>
              현재 계정: <Text style={{ fontWeight: '700' }}>{user.name}</Text> ({user.email})
            </Text>
            <Pressable
              style={[styles.primaryButton, acceptMutation.isPending && { opacity: 0.6 }]}
              disabled={acceptMutation.isPending}
              onPress={() => acceptMutation.mutate()}
            >
              {acceptMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>가계부 참여하기</Text>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.actionWrap}>
            <Text style={styles.userHint}>가계부에 참여하려면 로그인이 필요합니다.</Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push(`/(auth)/login?invite_code=${encodeURIComponent(code)}`)}
            >
              <Text style={styles.primaryButtonText}>로그인하고 참여하기</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={() => router.push(`/(auth)/signup?invite_code=${encodeURIComponent(code)}`)}
            >
              <Text style={styles.secondaryButtonText}>회원가입하고 참여하기</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  center: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  icon: { fontSize: 44, marginBottom: 12 },
  subTitle: { fontSize: 14, color: '#6B7280', marginBottom: 6, fontWeight: '500' },
  ledgerName: { fontSize: 24, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 14 },
  badgeWrap: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 24,
  },
  badgeText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  actionWrap: { width: '100%', gap: 10, marginTop: 8 },
  userHint: { fontSize: 13, color: '#4B5563', textAlign: 'center', marginBottom: 6 },
  primaryButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    width: '100%',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    width: '100%',
  },
  secondaryButtonText: { color: '#374151', fontSize: 15, fontWeight: '600' },
  loadingText: { marginTop: 14, fontSize: 15, color: '#6B7280' },
  errorTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginTop: 12, marginBottom: 6 },
  errorDesc: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginBottom: 20 },
});
