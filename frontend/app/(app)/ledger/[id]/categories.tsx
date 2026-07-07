import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { confirmAsync, notify } from '@/lib/dialog';

import { ApiError, api } from '@/lib/api';
import { CATEGORY_COLOR_PALETTE } from '@/lib/colors';
import type { Category, TransactionType } from '@/lib/types';

type Editing = { mode: 'create'; type: TransactionType } | { mode: 'edit'; category: Category };

export default function CategoriesScreen() {
  const { id: ledgerId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: ['categories', ledgerId],
    queryFn: () => api<Category[]>(`/api/ledgers/${ledgerId}/categories`),
    enabled: !!ledgerId,
  });

  const [editing, setEditing] = useState<Editing | null>(null);

  const expense = (categoriesQuery.data ?? []).filter((c) => c.type === 'expense');
  const income = (categoriesQuery.data ?? []).filter((c) => c.type === 'income');

  const deleteMutation = useMutation({
    mutationFn: (categoryId: string) =>
      api(`/api/ledgers/${ledgerId}/categories/${categoryId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories', ledgerId] }),
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '삭제 실패';
      notify('오류', msg);
    },
  });

  async function confirmDelete(category: Category) {
    if (await confirmAsync('카테고리 삭제', `"${category.name}" 카테고리를 삭제할까요? 연결된 거래는 미분류로 남습니다.`, { confirmText: '삭제', destructive: true }))
      deleteMutation.mutate(category.id);
  }

  if (categoriesQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: '카테고리 관리' }} />

      <FlatList
        data={[]}
        renderItem={() => null}
        ListHeaderComponent={
          <>
            <Section
              title="지출"
              items={expense}
              onAdd={() => setEditing({ mode: 'create', type: 'expense' })}
              onEdit={(c) => setEditing({ mode: 'edit', category: c })}
              onDelete={confirmDelete}
            />
            <Section
              title="수입"
              items={income}
              onAdd={() => setEditing({ mode: 'create', type: 'income' })}
              onEdit={(c) => setEditing({ mode: 'edit', category: c })}
              onDelete={confirmDelete}
            />
          </>
        }
      />

      <CategoryEditor
        ledgerId={ledgerId!}
        editing={editing}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

function Section({
  title,
  items,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string;
  items: Category[];
  onAdd: () => void;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Pressable onPress={onAdd}>
          <Text style={styles.addText}>+ 추가</Text>
        </Pressable>
      </View>
      {items.length === 0 ? (
        <Text style={styles.empty}>카테고리가 없습니다</Text>
      ) : (
        items.map((c) => (
          <View key={c.id} style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => onEdit(c)}>
              <View style={[styles.colorDot, { backgroundColor: c.color }]} />
              <Text style={styles.rowName}>{c.name}</Text>
            </Pressable>
            <Pressable onPress={() => onDelete(c)} hitSlop={8}>
              <Text style={styles.deleteIcon}>🗑️</Text>
            </Pressable>
          </View>
        ))
      )}
    </View>
  );
}

function CategoryEditor({
  ledgerId,
  editing,
  onClose,
}: {
  ledgerId: string;
  editing: Editing | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = editing?.mode === 'edit';
  const initial = editing?.mode === 'edit' ? editing.category : null;

  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLOR_PALETTE[0]);

  const reset = () => {
    setName(initial?.name ?? '');
    setColor(initial?.color ?? CATEGORY_COLOR_PALETTE[0]);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (editing.mode === 'create') {
        await api(`/api/ledgers/${ledgerId}/categories`, {
          method: 'POST',
          body: { name, type: editing.type, color },
        });
      } else {
        await api(`/api/ledgers/${ledgerId}/categories/${editing.category.id}`, {
          method: 'PATCH',
          body: { name, color },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories', ledgerId] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? String(err.detail ?? err.message) : '저장 실패';
      notify('오류', msg);
    },
  });

  return (
    <Modal
      visible={!!editing}
      animationType="slide"
      transparent
      onShow={reset}
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>
            {isEdit ? '카테고리 수정' : `${editing?.mode === 'create' && editing.type === 'expense' ? '지출' : '수입'} 카테고리 추가`}
          </Text>

          <Text style={styles.label}>이름</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="예: 식비"
          />

          <Text style={styles.label}>색상</Text>
          <View style={styles.palette}>
            {CATEGORY_COLOR_PALETTE.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  color === c && styles.swatchSelected,
                ]}
              />
            ))}
          </View>

          <View style={styles.modalActions}>
            <Pressable style={[styles.modalButton, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable
              style={[styles.modalButton, styles.saveButton, mutation.isPending && { opacity: 0.6 }]}
              disabled={mutation.isPending || !name.trim()}
              onPress={() => mutation.mutate()}
            >
              {mutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>{isEdit ? '저장' : '추가'}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  section: { padding: 16, borderBottomWidth: 8, borderBottomColor: '#F3F4F6' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  addText: { color: '#3B82F6', fontWeight: '600' },
  empty: { color: '#9CA3AF', paddingVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  rowName: { fontSize: 16 },
  deleteIcon: { fontSize: 18, paddingHorizontal: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 13, color: '#6B7280', marginTop: 12, marginBottom: 6, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9FAFB',
  },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#1F2937',
  },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  cancelButton: { backgroundColor: '#F3F4F6' },
  cancelText: { color: '#6B7280', fontWeight: '600' },
  saveButton: { backgroundColor: '#3B82F6' },
  saveText: { color: '#fff', fontWeight: '700' },
});
