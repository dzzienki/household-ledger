import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Category, TransactionType } from '@/lib/types';

export type DateRangePreset = 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear' | 'custom';

export interface TransactionFilterState {
  type: TransactionType | 'all';
  categoryId: string | null;
  range: DateRangePreset;
  customStart: string;
  customEnd: string;
}

export const DEFAULT_FILTER: TransactionFilterState = {
  type: 'all',
  categoryId: null,
  range: 'all',
  customStart: '',
  customEnd: '',
};

const RANGE_LABEL: Record<DateRangePreset, string> = {
  all: '전체 기간',
  thisMonth: '이번 달',
  lastMonth: '지난 달',
  last3Months: '최근 3개월',
  thisYear: '올해',
  custom: '직접 지정',
};

export function isFilterActive(f: TransactionFilterState): boolean {
  return f.type !== 'all' || f.categoryId !== null || f.range !== 'all';
}

export function resolveRange(f: TransactionFilterState): { start?: string; end?: string } {
  const today = new Date();
  const startOfDay = (d: Date) => d.toISOString().slice(0, 10);

  switch (f.range) {
    case 'thisMonth': {
      const s = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: startOfDay(s), end: startOfDay(today) };
    }
    case 'lastMonth': {
      const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: startOfDay(s), end: startOfDay(e) };
    }
    case 'last3Months': {
      const s = new Date(today.getFullYear(), today.getMonth() - 2, 1);
      return { start: startOfDay(s), end: startOfDay(today) };
    }
    case 'thisYear': {
      const s = new Date(today.getFullYear(), 0, 1);
      return { start: startOfDay(s), end: startOfDay(today) };
    }
    case 'custom':
      return { start: f.customStart || undefined, end: f.customEnd || undefined };
    default:
      return {};
  }
}

interface Props {
  visible: boolean;
  value: TransactionFilterState;
  categories: Category[];
  onChange: (next: TransactionFilterState) => void;
  onClose: () => void;
  onClear: () => void;
}

export function TransactionFilterSheet({ visible, value, categories, onChange, onClose, onClear }: Props) {
  const filteredCategories = categories.filter(
    (c) => value.type === 'all' || c.type === value.type,
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>필터</Text>
            <Pressable onPress={onClear}>
              <Text style={styles.clearText}>초기화</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <Text style={styles.label}>거래 종류</Text>
            <View style={styles.row}>
              {(['all', 'expense', 'income'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.chip, value.type === t && styles.chipActive]}
                  onPress={() =>
                    onChange({
                      ...value,
                      type: t,
                      categoryId:
                        t !== 'all' && value.categoryId
                          ? categories.find((c) => c.id === value.categoryId)?.type === t
                            ? value.categoryId
                            : null
                          : value.categoryId,
                    })
                  }
                >
                  <Text style={[styles.chipText, value.type === t && styles.chipTextActive]}>
                    {t === 'all' ? '전체' : t === 'expense' ? '지출' : '수입'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>기간</Text>
            <View style={styles.row}>
              {(Object.keys(RANGE_LABEL) as DateRangePreset[]).map((r) => (
                <Pressable
                  key={r}
                  style={[styles.chip, value.range === r && styles.chipActive]}
                  onPress={() => onChange({ ...value, range: r })}
                >
                  <Text style={[styles.chipText, value.range === r && styles.chipTextActive]}>
                    {RANGE_LABEL[r]}
                  </Text>
                </Pressable>
              ))}
            </View>

            {value.range === 'custom' && (
              <View style={styles.customDateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subLabel}>시작</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    autoCapitalize="none"
                    value={value.customStart}
                    onChangeText={(v) => onChange({ ...value, customStart: v })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subLabel}>끝</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    autoCapitalize="none"
                    value={value.customEnd}
                    onChangeText={(v) => onChange({ ...value, customEnd: v })}
                  />
                </View>
              </View>
            )}

            <Text style={styles.label}>카테고리</Text>
            <View style={styles.row}>
              <Pressable
                style={[styles.chip, value.categoryId === null && styles.chipActive]}
                onPress={() => onChange({ ...value, categoryId: null })}
              >
                <Text style={[styles.chipText, value.categoryId === null && styles.chipTextActive]}>
                  전체
                </Text>
              </Pressable>
              {filteredCategories.map((c) => (
                <Pressable
                  key={c.id}
                  style={[
                    styles.chip,
                    { borderColor: c.color, borderWidth: 1.5 },
                    value.categoryId === c.id && { backgroundColor: c.color, borderColor: c.color },
                  ]}
                  onPress={() => onChange({ ...value, categoryId: value.categoryId === c.id ? null : c.id })}
                >
                  <Text
                    style={[styles.chipText, value.categoryId === c.id && styles.chipTextActive]}
                  >
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <Pressable style={styles.applyButton} onPress={onClose}>
            <Text style={styles.applyText}>적용</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '700' },
  clearText: { color: '#6B7280', fontWeight: '600' },
  label: { fontSize: 13, color: '#6B7280', marginTop: 16, marginBottom: 8, fontWeight: '700' },
  subLabel: { fontSize: 12, color: '#6B7280', marginBottom: 4, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  chipActive: { backgroundColor: '#1F2937' },
  chipText: { fontWeight: '600', color: '#6B7280' },
  chipTextActive: { color: '#fff' },
  customDateRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#F9FAFB',
  },
  applyButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  applyText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
