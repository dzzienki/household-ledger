import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, api, getErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { REMEMBERED_EMAIL_KEY, storage } from '@/lib/storage';
import type { InvitationAcceptResponse } from '@/lib/types';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const { registered, invite_code } = useLocalSearchParams<{ registered?: string; invite_code?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberEmail, setRememberEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const savedEmail = await storage.get(REMEMBERED_EMAIL_KEY);
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberEmail(true);
      }
    })();
  }, []);

  async function onSubmit() {
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('이메일과 비밀번호를 입력하세요');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('올바른 이메일 형식을 입력해 주세요 (예: user@example.com)');
      return;
    }
    setSubmitting(true);
    try {
      if (rememberEmail) {
        await storage.set(REMEMBERED_EMAIL_KEY, trimmedEmail);
      } else {
        await storage.remove(REMEMBERED_EMAIL_KEY);
      }
      await signIn(trimmedEmail, password);
      if (invite_code) {
        try {
          const res = await api<InvitationAcceptResponse>(`/api/invitations/${invite_code}/accept`, {
            method: 'POST',
          });
          router.replace(`/(app)/ledger/${res.ledger_id}`);
          return;
        } catch {
          // fallback to app
        }
      }
      router.replace('/(app)');
    } catch (err) {
      setError(getErrorMessage(err, '로그인에 실패했습니다'));
    } finally {
      setSubmitting(false);
    }
  }

  const signupHref = invite_code
    ? `/(auth)/signup?invite_code=${encodeURIComponent(invite_code)}`
    : '/(auth)/signup';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>가계부 로그인</Text>

        {registered && (
          <Text style={styles.success}>회원가입이 완료됐습니다. 로그인해 주세요.</Text>
        )}

        {invite_code && (
          <Text style={styles.inviteNotice}>가계부 초대를 수락하려면 로그인하세요.</Text>
        )}

        <TextInput
          style={styles.input}
          placeholder="이메일"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="비밀번호"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
        />

        {/* 이메일 기억하기 토글 */}
        <Pressable
          style={styles.rememberRow}
          onPress={() => setRememberEmail((prev) => !prev)}
        >
          <View style={[styles.checkbox, rememberEmail && styles.checkboxActive]}>
            {rememberEmail && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.rememberText}>이메일 기억하기</Text>
        </Pressable>

        {error && <Text style={styles.error}>{error}</Text>}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          disabled={submitting}
          onPress={onSubmit}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>로그인</Text>}
        </Pressable>

        <Link href={signupHref as any} style={styles.link}>
          계정이 없으신가요? 회원가입
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, padding: 24, justifyContent: 'center', maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 32, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 12,
    backgroundColor: '#F9FAFB',
  },
  button: {
    backgroundColor: '#3B82F6',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { textAlign: 'center', marginTop: 20, color: '#3B82F6' },
  error: { color: '#DC2626', fontSize: 14, marginBottom: 8, textAlign: 'center' },
  success: { color: '#16A34A', fontSize: 14, marginBottom: 16, textAlign: 'center' },
  inviteNotice: { color: '#2563EB', fontSize: 14, marginBottom: 16, textAlign: 'center', fontWeight: '600' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 12 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxActive: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  rememberText: { fontSize: 14, color: '#4B5563' },
});
