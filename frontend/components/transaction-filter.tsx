import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Category, Tag, TransactionType } from '@/lib/types';

export interface TransactionFilterState {
  type: TransactionType | 'all';
  categoryId: string | null;
  tagId: string | null;
}

export const DEFAULT_FILTER: TransactionFilterState = {
  type: 'all',
  categoryId: null,
  tagId: null,
};

export function isFilterActive(f: TransactionFilterState): boolean {
  return f.type !== 'all' || f.categoryId !== null || f.tagId !== null;
}

interface Props {
  visible: boolean;
  value: TransactionFilterState;
  categories: Category[];
  tags: Tag[];
  onChange: (next: TransactionFilterState) => void;
  onClose: () => void;
  onClear: () => void;
}

export function TransactionFilterSheet({ visible, value, categories, tags, onChange, onClose, onClear }: Props) {
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

            {tags.length > 0 && (
              <>
                <Text style={styles.label}>태그</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.chip, value.tagId === null && styles.chipActive]}
                    onPress={() => onChange({ ...value, tagId: null })}
                  >
                    <Text style={[styles.chipText, value.tagId === null && styles.chipTextActive]}>
                      전체
                    </Text>
                  </Pressable>
                  {tags.map((t) => (
                    <Pressable
                      key={t.id}
                      style={[
                        styles.chip,
                        { borderColor: t.color, borderWidth: 1.5 },
                        value.tagId === t.id && { backgroundColor: t.color, borderColor: t.color },
                      ]}
                      onPress={() => onChange({ ...value, tagId: value.tagId === t.id ? null : t.id })}
                    >
                      <Text style={[styles.chipText, value.tagId === t.id && styles.chipTextActive]}>
                        #{t.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
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
  applyButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
  },
  applyText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
