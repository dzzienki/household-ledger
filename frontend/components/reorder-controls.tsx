import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ReorderArrows({
  canUp,
  canDown,
  onUp,
  onDown,
}: {
  canUp: boolean;
  canDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <View style={styles.arrows}>
      <Pressable style={[styles.arrow, !canUp && styles.arrowOff]} onPress={onUp} disabled={!canUp} hitSlop={4}>
        <Text style={styles.arrowText}>▲</Text>
      </Pressable>
      <Pressable style={[styles.arrow, !canDown && styles.arrowOff]} onPress={onDown} disabled={!canDown} hitSlop={4}>
        <Text style={styles.arrowText}>▼</Text>
      </Pressable>
    </View>
  );
}

export function ReorderBar({
  editing,
  onToggle,
  onReset,
}: {
  editing: boolean;
  onToggle: () => void;
  onReset: () => void;
}) {
  return (
    <View style={styles.bar}>
      {editing ? (
        <Pressable onPress={onReset} hitSlop={6}>
          <Text style={styles.reset}>납부일순으로 되돌리기</Text>
        </Pressable>
      ) : (
        <View />
      )}
      <Pressable style={[styles.toggle, editing && styles.toggleOn]} onPress={onToggle}>
        <Text style={[styles.toggleText, editing && styles.toggleTextOn]}>{editing ? '완료' : '↕ 순서 변경'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  arrows: { gap: 6, alignItems: 'center', justifyContent: 'center' },
  arrow: {
    width: 34,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowOff: { opacity: 0.3 },
  arrowText: { color: '#2563EB', fontSize: 13, fontWeight: '700' },

  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  toggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  toggleOn: { backgroundColor: '#3B82F6', borderColor: '#3B82F6' },
  toggleText: { fontSize: 12, fontWeight: '700', color: '#4B5563' },
  toggleTextOn: { color: '#fff' },
  reset: { fontSize: 12, color: '#6B7280', textDecorationLine: 'underline' },
});
