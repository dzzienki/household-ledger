import { Link, Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';

const FEATURES = [
  { icon: '🏷️', title: '태그 분류', desc: '카테고리 위에 태그로 자유롭게 묶어보기' },
  { icon: '💱', title: '다중 통화', desc: '해외 지출도 원래 통화 그대로 기록' },
  { icon: '🧾', title: '카드내역 가져오기', desc: '카드사 엑셀을 올려 지출 일괄 등록' },
  { icon: '📊', title: '예산·통계', desc: '기준 통화로 환산해 한눈에 집계' },
];

const STEPS = [
  { num: '01', icon: '➕', title: '기록하기', desc: '수입·지출을 카테고리와 태그로 빠르게 남겨요.' },
  { num: '02', icon: '📥', title: '가져오기', desc: '카드 이용내역 엑셀을 올리면 지출로 자동 등록돼요.' },
  { num: '03', icon: '📈', title: '돌아보기', desc: '기간·카테고리·통화별로 지출을 다시 꺼내봐요.' },
];

function Landing() {
  const router = useRouter();
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.badge}>
          <View style={styles.badgeDot} />
          <Text style={styles.badgeText}>우리 가족 가계부</Text>
        </View>
        <Text style={styles.heroTitle}>매일의 수입과 지출을{'\n'}하나의 가계부로</Text>
        <Text style={styles.heroSubtitle}>
          카테고리·태그로 기록하고, 카드 내역을 불러오고, 예산과 통계로 다시 꺼내보세요.
        </Text>
        <View style={styles.heroActions}>
          <Pressable style={[styles.button, styles.primary]} onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.primaryText}>시작하기 →</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.ghost]} onPress={() => router.push('/(auth)/signup')}>
            <Text style={styles.ghostText}>회원가입</Text>
          </Pressable>
        </View>
      </View>

      {/* Features */}
      <View style={styles.section}>
        <Text style={styles.kicker}>FEATURES</Text>
        <Text style={styles.sectionTitle}>가계부가 해주는 것들</Text>
        <View style={styles.grid}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureCard}>
              <View style={styles.featureIconWrap}>
                <Text style={styles.featureIcon}>{f.icon}</Text>
              </View>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureDesc}>{f.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* How it works */}
      <View style={[styles.section, styles.sectionMuted]}>
        <Text style={styles.kicker}>HOW IT WORKS</Text>
        <Text style={styles.sectionTitle}>사용 방법</Text>
        <View style={styles.steps}>
          {STEPS.map((s) => (
            <View key={s.num} style={styles.stepCard}>
              <View style={styles.stepHeader}>
                <View style={styles.stepIconWrap}>
                  <Text style={styles.stepIcon}>{s.icon}</Text>
                </View>
                <Text style={styles.stepNum}>{s.num}</Text>
              </View>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepDesc}>{s.desc}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* CTA */}
      <View style={styles.cta}>
        <Text style={styles.ctaTitle}>지금 바로 시작해보세요</Text>
        <Text style={styles.ctaSubtitle}>기록하지 않은 지출은 어디로 갔는지 알 수 없어요.</Text>
        <Pressable style={[styles.button, styles.primary, styles.ctaButton]} onPress={() => router.push('/(auth)/login')}>
          <Text style={styles.primaryText}>가계부 시작하기 →</Text>
        </Pressable>
        <Link href="/(auth)/login" style={styles.footerLink}>
          이미 계정이 있으신가요? 로그인
        </Link>
      </View>
    </ScrollView>
  );
}

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (user) return <Redirect href="/(app)" />;
  return <Landing />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { flex: 1, backgroundColor: '#fff' },
  pageContent: { paddingBottom: 48 },

  // Hero
  hero: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'web' ? 72 : 56,
    paddingBottom: 48,
    backgroundColor: '#EFF6FF',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    marginBottom: 20,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3B82F6' },
  badgeText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  heroTitle: { fontSize: 32, lineHeight: 42, fontWeight: '800', textAlign: 'center', color: '#111827' },
  heroSubtitle: {
    marginTop: 16,
    fontSize: 15,
    lineHeight: 23,
    color: '#6B7280',
    textAlign: 'center',
    maxWidth: 440,
  },
  heroActions: { flexDirection: 'row', gap: 12, marginTop: 28, flexWrap: 'wrap', justifyContent: 'center' },

  // Buttons
  button: { paddingHorizontal: 22, paddingVertical: 13, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: '#3B82F6' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghost: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB' },
  ghostText: { color: '#1F2937', fontWeight: '700', fontSize: 15 },

  // Sections
  section: { paddingHorizontal: 24, paddingVertical: 44, maxWidth: 960, width: '100%', alignSelf: 'center' },
  sectionMuted: { backgroundColor: '#F9FAFB', maxWidth: undefined, borderTopWidth: 1, borderColor: '#F3F4F6' },
  kicker: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: '#9CA3AF', textAlign: 'center' },
  sectionTitle: { fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center', marginTop: 8, marginBottom: 24 },

  // Features grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  featureCard: {
    flexGrow: 1,
    flexBasis: 200,
    maxWidth: 300,
    minWidth: 150,
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  featureIcon: { fontSize: 22 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 },
  featureDesc: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 19 },

  // Steps
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', maxWidth: 960, width: '100%', alignSelf: 'center' },
  stepCard: {
    flexGrow: 1,
    flexBasis: 240,
    maxWidth: 300,
    minWidth: 200,
    padding: 22,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  stepIconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  stepIcon: { fontSize: 18 },
  stepNum: { fontSize: 12, fontWeight: '800', letterSpacing: 2, color: '#9CA3AF' },
  stepTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  stepDesc: { fontSize: 14, color: '#6B7280', lineHeight: 21 },

  // CTA
  cta: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  ctaTitle: { fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center' },
  ctaSubtitle: { marginTop: 8, fontSize: 14, color: '#6B7280', textAlign: 'center' },
  ctaButton: { marginTop: 22 },
  footerLink: { marginTop: 18, color: '#3B82F6', fontSize: 14, textAlign: 'center' },
});
