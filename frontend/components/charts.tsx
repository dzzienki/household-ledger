import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { formatCurrency } from '@/lib/format';

export interface MonthlyDatum {
  month: number;
  income: number;
  expense: number;
}

export function MonthlyBarChart({ data, currency = 'KRW' }: { data: MonthlyDatum[]; currency?: string }) {
  const [width, setWidth] = useState(0);
  const height = 200;
  const padding = { top: 16, right: 8, bottom: 28, left: 8 };

  const max = useMemo(
    () => Math.max(1, ...data.flatMap((d) => [d.income, d.expense])),
    [data],
  );

  const chartW = Math.max(0, width - padding.left - padding.right);
  const chartH = height - padding.top - padding.bottom;
  const groupWidth = data.length > 0 ? chartW / data.length : 0;
  const barWidth = Math.max(2, groupWidth * 0.32);

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={styles.container} onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={height}>
          {data.map((d, i) => {
            const groupX = padding.left + groupWidth * i;
            const incomeH = (d.income / max) * chartH;
            const expenseH = (d.expense / max) * chartH;
            const incomeX = groupX + groupWidth / 2 - barWidth - 1;
            const expenseX = groupX + groupWidth / 2 + 1;
            return (
              <G key={d.month}>
                <Rect
                  x={incomeX}
                  y={padding.top + chartH - incomeH}
                  width={barWidth}
                  height={incomeH}
                  rx={2}
                  fill="#22C55E"
                />
                <Rect
                  x={expenseX}
                  y={padding.top + chartH - expenseH}
                  width={barWidth}
                  height={expenseH}
                  rx={2}
                  fill="#EF4444"
                />
              </G>
            );
          })}
        </Svg>
      )}
      <View style={[styles.labels, { paddingHorizontal: padding.left }]}>
        {data.map((d) => (
          <Text key={d.month} style={[styles.label, { width: groupWidth }]}>
            {d.month}
          </Text>
        ))}
      </View>
      <View style={styles.legend}>
        <LegendDot color="#22C55E" label="수입" />
        <LegendDot color="#EF4444" label="지출" />
      </View>
      <Text style={styles.maxLabel}>최대값: {formatCurrency(max, currency)}</Text>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

export interface PieDatum {
  id: string;
  label: string;
  color: string;
  value: number;
}

export function CategoryPieChart({ data, currency = 'KRW' }: { data: PieDatum[]; currency?: string }) {
  const size = 200;
  const radius = size / 2;
  const innerRadius = radius * 0.55;
  const cx = radius;
  const cy = radius;

  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <View style={[styles.pieContainer, { height: size }]}>
        <Text style={styles.empty}>이 기간엔 거래가 없습니다</Text>
      </View>
    );
  }

  const segments: { d: string; color: string }[] = [];
  let startAngle = -Math.PI / 2;
  for (const datum of data) {
    const angle = (datum.value / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    segments.push({ d: donutPath(cx, cy, radius, innerRadius, startAngle, endAngle), color: datum.color });
    startAngle = endAngle;
  }

  return (
    <View style={styles.pieContainer}>
      <View style={styles.pieRow}>
        <Svg width={size} height={size}>
          {segments.length === 1 ? (
            <Circle
              cx={cx}
              cy={cy}
              r={radius - 1}
              stroke={segments[0].color}
              strokeWidth={radius - innerRadius}
              fill="none"
            />
          ) : (
            segments.map((s, i) => <Path key={i} d={s.d} fill={s.color} />)
          )}
        </Svg>
        <View style={styles.legendList}>
          {data.map((d) => {
            const pct = ((d.value / total) * 100).toFixed(1);
            return (
              <View key={d.id} style={styles.legendItemRow}>
                <View style={[styles.legendDot, { backgroundColor: d.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.legendName}>{d.label}</Text>
                  <Text style={styles.legendValue}>
                    {formatCurrency(d.value, currency)} ({pct}%)
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function donutPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): string {
  const large = end - start > Math.PI ? 1 : 0;
  const sx = cx + outer * Math.cos(start);
  const sy = cy + outer * Math.sin(start);
  const ex = cx + outer * Math.cos(end);
  const ey = cy + outer * Math.sin(end);
  const isx = cx + inner * Math.cos(end);
  const isy = cy + inner * Math.sin(end);
  const iex = cx + inner * Math.cos(start);
  const iey = cy + inner * Math.sin(start);
  return [
    `M ${sx} ${sy}`,
    `A ${outer} ${outer} 0 ${large} 1 ${ex} ${ey}`,
    `L ${isx} ${isy}`,
    `A ${inner} ${inner} 0 ${large} 0 ${iex} ${iey}`,
    'Z',
  ].join(' ');
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', paddingVertical: 8 },
  labels: { flexDirection: 'row', marginTop: 4 },
  label: { textAlign: 'center', fontSize: 11, color: '#6B7280' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: '#374151' },
  maxLabel: { textAlign: 'center', fontSize: 11, color: '#9CA3AF', marginTop: 4 },
  pieContainer: { alignItems: 'center', paddingVertical: 12 },
  pieRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  legendList: { flex: 1, gap: 8 },
  legendItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendName: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  legendValue: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  empty: { color: '#9CA3AF', textAlign: 'center', marginTop: 80 },
});
