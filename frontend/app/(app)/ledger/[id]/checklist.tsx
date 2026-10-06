import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, getErrorMessage } from '@/lib/api';
import {
  CHECKLIST_FIELDS,
  type ChecklistField,
  currentPeriod,
  daysUntil,
  periodLabel,
  shiftPeriod,
  summarize,
  withToggle,
} from '@/lib/checklist';
import { ReorderArrows, ReorderBar } from '@/components/reorder-controls';
import { notify } from '@/lib/dialog';
import { formatCurrency } from '@/lib/format';
import { moveItem, resetOrder, saveOrder } from '@/lib/reorder';
import { disablePush, enablePush, insecureOrigin, isPushEnabledOnThisDevice, pushSupported } from '@/lib/push';
import type { Category, ChecklistItem, ChecklistMonth, PushSettings } from '@/lib/types';

const DAYS_OPTIONS = [0, 1, 2, 3];
const HOUR_OPTIONS = [7, 8, 9, 12, 18, 20, 21];

export default function ChecklistScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const thisPeriod = currentPeriod();
  const [period, setPeriod] = useState(thisPeriod);
  const isCurrent = period === thisPeriod;

  const queryKey = ['checklist', ledgerId, period];
  const checklistQuery = useQuery({
    queryKey,
    queryFn: () => api<ChecklistMonth>(`/api/ledgers/${ledgerId}/checklist?period=${period}`),
    enabled: !!ledgerId,
  });

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });
  const categoriesById = new Map((categoriesQuery.data ?? []).map((c) => [c.id, c]));

  const toggleMutation = useMutation({
    mutationFn: ({ item, field, value }: { item: ChecklistItem; field: ChecklistField; value: boolean }) =>
      api(`/api/ledgers/${ledgerId}/checklist/${item.recurring_id}`, {
        method: 'PATCH',
        body: { period, [field]: value },
      }),
    // Flip the box immediately so taps feel instant; roll back if the save fails.
    onMutate: async ({ item, field, value }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ChecklistMonth>(queryKey);
      if (previous) {
        const items = previous.items.map((i) =>
          i.recurring_id === item.recurring_id ? withToggle(i, field, value) : i,
        );
        queryClient.setQueryData<ChecklistMonth>(queryKey, { ...previous, items, ...summarize(items) });
      }
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      notify('오류', getErrorMessage(err, '변경 실패'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      // The home banner shows this month's progress.
      queryClient.invalidateQueries({ queryKey: ['checklist', ledgerId, thisPeriod] });
    },
  });

  const [reordering, setReordering] = useState(false);

  const orderMutation = useMutation({
    mutationFn: (ids: string[]) => saveOrder(ledgerId!, ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ChecklistMonth>(queryKey);
      if (previous) {
        const byId = new Map(previous.items.map((i) => [i.recurring_id, i]));
        const items = ids.map((id) => byId.get(id)!).filter(Boolean);
        queryClient.setQueryData<ChecklistMonth>(queryKey, { ...previous, items });
      }
      return { previous };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      notify('오류', getErrorMessage(err, '순서 저장 실패'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['recurring', ledgerId] });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetOrder(ledgerId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist', ledgerId] });
      queryClient.invalidateQueries({ queryKey: ['recurring', ledgerId] });
    },
    onError: (err) => notify('오류', getErrorMessage(err, '되돌리기 실패')),
  });

  const data = checklistQuery.data;
  const today = new Date();
  const shownItems = data?.items ?? [];

  function move(index: number, delta: -1 | 1) {
    const next = moveItem(shownItems, index, delta);
    if (next) orderMutation.mutate(next.map((i) => i.recurring_id));
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '체크리스트' }} />

      <View style={styles.monthBar}>
        <Pressable onPress={() => setPeriod(shiftPeriod(period, -1))} hitSlop={10}>
          <Text style={styles.monthArrow}>◀</Text>
        </Pressable>
        <Pressable onPress={() => setPeriod(thisPeriod)} disabled={isCurrent}>
          <Text style={styles.monthLabel}>{periodLabel(period)}</Text>
          {!isCurrent && <Text style={styles.monthHint}>탭하면 이번 달로</Text>}
        </Pressable>
        <Pressable onPress={() => setPeriod(shiftPeriod(period, 1))} hitSlop={10}>
          <Text style={styles.monthArrow}>▶</Text>
        </Pressable>
      </View>

      {checklistQuery.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : checklistQuery.isError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{getErrorMessage(checklistQuery.error, '불러오지 못했습니다')}</Text>
        </View>
      ) : (
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(i) => i.recurring_id}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshing={checklistQuery.isRefetching}
          onRefresh={() => checklistQuery.refetch()}
          ListHeaderComponent={
            data && data.total > 0 ? (
              <>
                <ProgressCard month={data} />
                <ReorderBar
                  editing={reordering}
                  onToggle={() => setReordering((v) => !v)}
                  onReset={() => resetMutation.mutate()}
                />
              </>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.empty}>{periodLabel(period)}에 해당하는 반복 거래가 없습니다</Text>
              <Pressable onPress={() => router.push(`/(app)/ledger/${ledgerId}/recurring`)}>
                <Text style={styles.link}>적금·대출이자·공과금 등록하러 가기</Text>
              </Pressable>
            </View>
          }
          ListFooterComponent={<PushCard />}
          renderItem={({ item, index }) => {
            const cat = item.category_id ? categoriesById.get(item.category_id) : null;
            const name = item.title || item.payee || cat?.name || '(제목 없음)';
            const overdue = !item.done && item.due_date !== null && period <= thisPeriod && daysUntil(item.due_date, today) < 0;
            return (
              <View style={[styles.row, item.done && styles.rowDone, overdue && styles.rowOverdue, reordering && styles.rowReorder]}>
                <View style={{ flex: 1 }}>
                <View style={styles.rowTop}>
                  <View style={[styles.dot, { backgroundColor: cat?.color ?? '#9CA3AF' }]} />
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.done ? '✅ ' : ''}
                    {name}
                  </Text>
                  <Text style={[styles.amount, { color: item.type === 'income' ? '#16A34A' : '#DC2626' }]}>
                    {item.type === 'income' ? '+' : '-'}
                    {formatCurrency(item.amount, item.currency)}
                  </Text>
                </View>
                <Text style={[styles.rowMeta, overdue && { color: '#DC2626', fontWeight: '600' }]}>
                  {dueText(item, period === thisPeriod, overdue, today)}
                </Text>
                <View style={styles.checkRow}>
                  {CHECKLIST_FIELDS.map((c) => {
                    const on = item[c.key];
                    return (
                      <Pressable
                        key={c.key}
                        style={[styles.chip, on && styles.chipOn]}
                        onPress={() => toggleMutation.mutate({ item, field: c.key, value: !on })}
                        hitSlop={4}
                      >
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>
                          {on ? '✓' : '○'} {c.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                </View>
                {reordering && (
                  <ReorderArrows
                    canUp={index > 0}
                    canDown={index < shownItems.length - 1}
                    onUp={() => move(index, -1)}
                    onDown={() => move(index, 1)}
                  />
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function dueText(item: ChecklistItem, isCurrentMonth: boolean, overdue: boolean, today: Date): string {
  if (!item.due_date) return item.frequency === 'daily' ? '매일 반복' : '매주 반복';
  const [, m, d] = item.due_date.split('-').map(Number);
  const base = `${m}월 ${d}일`;
  if (!isCurrentMonth) return overdue ? `${base} · 확인 안 됨` : base;
  const diff = daysUntil(item.due_date, today);
  if (item.done) return base;
  if (diff === 0) return `${base} · 오늘`;
  if (diff > 0) return `${base} · D-${diff}`;
  return `${base} · ${-diff}일 지남`;
}

function ProgressCard({ month }: { month: ChecklistMonth }) {
  const pct = month.total ? Math.round((month.completed / month.total) * 100) : 0;
  return (
    <View style={styles.progressCard}>
      <View style={styles.progressTop}>
        <Text style={styles.progressTitle}>
          {month.completed === month.total ? '🎉 모두 완료!' : `완료 ${month.completed} / ${month.total}`}
        </Text>
        <Text style={styles.progressPct}>{pct}%</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.progressSub}>
        진행 중 {month.in_progress}건 · 아직 시작 안 함 {month.pending}건 (이체·납부·금액 3가지를 모두 체크하면 완료)
      </Text>
    </View>
  );
}

function PushCard() {
  const queryClient = useQueryClient();
  const supported = pushSupported();
  const [enabledHere, setEnabledHere] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isPushEnabledOnThisDevice().then(setEnabledHere);
  }, []);

  const settingsQuery = useQuery({
    queryKey: ['push-settings'],
    queryFn: () => api<PushSettings>('/api/push/settings'),
  });
  const settings = settingsQuery.data;

  const settingsMutation = useMutation({
    mutationFn: (body: Partial<Pick<PushSettings, 'notify_days_before' | 'notify_hour'>>) =>
      api<PushSettings>('/api/push/settings', { method: 'PATCH', body }),
    onSuccess: (next) => queryClient.setQueryData(['push-settings'], next),
    onError: (err) => notify('오류', getErrorMessage(err, '설정 저장 실패')),
  });

  async function toggle() {
    setBusy(true);
    try {
      if (enabledHere) {
        await disablePush();
        setEnabledHere(false);
      } else {
        await enablePush();
        setEnabledHere(true);
      }
      queryClient.invalidateQueries({ queryKey: ['push-settings'] });
    } catch (err) {
      notify('알림 설정', getErrorMessage(err, '변경하지 못했습니다'));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    try {
      await api('/api/push/test', { method: 'POST' });
      notify('테스트 알림', '알림을 보냈습니다. 잠시 후 도착하는지 확인해 주세요.');
    } catch (err) {
      notify('테스트 알림', getErrorMessage(err, '보내지 못했습니다'));
    }
  }

  const hours = settings && !HOUR_OPTIONS.includes(settings.notify_hour)
    ? [...HOUR_OPTIONS, settings.notify_hour].sort((a, b) => a - b)
    : HOUR_OPTIONS;

  return (
    <View style={styles.pushCard}>
      <Text style={styles.pushTitle}>🔔 납부일 푸시 알림</Text>
      {!supported ? (
        <Text style={styles.pushHint}>
          {insecureOrigin()
            ? '푸시 알림은 보안 연결(HTTPS) 주소에서만 사용할 수 있습니다. 현재 접속 주소는 HTTP라서 켤 수 없어요.'
            : '푸시 알림은 웹 버전(브라우저, 또는 홈 화면에 추가한 앱)에서 켤 수 있습니다.'}
        </Text>
      ) : (
        <>
          <Pressable
            style={[styles.pushButton, enabledHere && styles.pushButtonOn, busy && { opacity: 0.6 }]}
            onPress={toggle}
            disabled={busy}
          >
            <Text style={[styles.pushButtonText, enabledHere && { color: '#15803D' }]}>
              {enabledHere ? '✓ 이 기기에서 알림 받는 중 (탭하여 끄기)' : '이 기기에서 알림 받기'}
            </Text>
          </Pressable>

          {settings && (
            <>
              <Text style={styles.pushLabel}>언제 알려드릴까요?</Text>
              <View style={styles.optionRow}>
                {DAYS_OPTIONS.map((d) => (
                  <Pressable
                    key={d}
                    style={[styles.option, settings.notify_days_before === d && styles.optionOn]}
                    onPress={() => settingsMutation.mutate({ notify_days_before: d })}
                  >
                    <Text style={[styles.optionText, settings.notify_days_before === d && styles.optionTextOn]}>
                      {d === 0 ? '당일' : `${d}일 전`}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.pushLabel}>알림 시각</Text>
              <View style={styles.optionRow}>
                {hours.map((h) => (
                  <Pressable
                    key={h}
                    style={[styles.option, settings.notify_hour === h && styles.optionOn]}
                    onPress={() => settingsMutation.mutate({ notify_hour: h })}
                  >
                    <Text style={[styles.optionText, settings.notify_hour === h && styles.optionTextOn]}>
                      {h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.pushHint}>
                {settings.notify_days_before === 0
                  ? '납부일 당일'
                  : `납부일 ${settings.notify_days_before}일 전과 납부일 당일`}
                에, 그리고 납부일이 지났는데도 체크가 안 되어 있으면 알려드립니다. 3가지를 모두 체크한 항목은 알리지 않으며, 설정은
                내 계정의 모든 가계부에 적용됩니다.
              </Text>
              {enabledHere && (
                <Pressable onPress={sendTest}>
                  <Text style={styles.link}>테스트 알림 보내기</Text>
                </Pressable>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#DC2626' },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  monthArrow: { fontSize: 18, color: '#3B82F6', paddingHorizontal: 8 },
  monthLabel: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  monthHint: { fontSize: 10, color: '#9CA3AF', textAlign: 'center', marginTop: 2 },

  progressCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14, marginBottom: 12 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  progressTitle: { fontSize: 16, fontWeight: '700' },
  progressPct: { fontSize: 14, fontWeight: '700', color: '#16A34A' },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: '#E5E7EB', marginTop: 10, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: '#22C55E' },
  progressSub: { fontSize: 11, color: '#6B7280', marginTop: 8 },

  row: { padding: 14, backgroundColor: '#F9FAFB', borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  rowReorder: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowDone: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  rowOverdue: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { fontSize: 15, fontWeight: '600', flex: 1 },
  amount: { fontSize: 15, fontWeight: '700' },
  rowMeta: { fontSize: 12, color: '#6B7280', marginTop: 4, marginLeft: 20 },
  checkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginLeft: 20 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: '#DCFCE7', borderColor: '#16A34A' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  chipTextOn: { color: '#15803D' },

  emptyBox: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  empty: { textAlign: 'center', color: '#9CA3AF' },
  link: { color: '#3B82F6', fontWeight: '600', textAlign: 'center', marginTop: 8 },

  pushCard: { marginTop: 20, padding: 14, borderRadius: 12, backgroundColor: '#F8FAFC' },
  pushTitle: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  pushHint: { fontSize: 11, color: '#6B7280', marginTop: 10, lineHeight: 16 },
  pushLabel: { fontSize: 12, fontWeight: '600', color: '#4B5563', marginTop: 14, marginBottom: 6 },
  pushButton: {
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
  },
  pushButtonOn: { borderColor: '#16A34A', backgroundColor: '#F0FDF4' },
  pushButtonText: { fontWeight: '700', color: '#2563EB', fontSize: 13 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  optionOn: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  optionText: { fontSize: 12, color: '#4B5563', fontWeight: '600' },
  optionTextOn: { color: '#fff' },
});
