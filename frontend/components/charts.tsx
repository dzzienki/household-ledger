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
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
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
  const size = 180;
  const padding = 8;
  const radius = (size - padding * 2) / 2; // 82
  const innerRadius = radius * 0.62; // ~50.8
  const cx = size / 2; // 90
  const cy = size / 2; // 90

  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0 || data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.empty}>이 기간엔 거래 내역이 없습니다</Text>
      </View>
    );
  }

  const segments: { d: string; color: string }[] = [];
  let startAngle = -Math.PI / 2;
  for (const datum of data) {
    if (datum.value <= 0) continue;
    const angle = (datum.value / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    segments.push({
      d: donutPath(cx, cy, radius, innerRadius, startAngle, endAngle),
      color: datum.color || '#9CA3AF',
    });
    startAngle = endAngle;
  }

  const singleSegment = segments.length === 1;
  const strokeWidth = radius - innerRadius;
  const strokeRadius = innerRadius + strokeWidth / 2;

  return (
    <View style={styles.pieContainer}>
      {/* 1. 상단 원형 차트 영역 */}
      <View style={styles.chartWrapper}>
        <View style={{ width: size, height: size, position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {singleSegment ? (
              <Circle
                cx={cx}
                cy={cy}
                r={strokeRadius}
                stroke={segments[0].color}
                strokeWidth={strokeWidth}
                fill="none"
              />
            ) : (
              segments.map((s, i) => <Path key={i} d={s.d} fill={s.color} />)
            )}
          </Svg>
          {/* 도넛 중앙 요약 텍스트 */}
          <View style={styles.donutCenter}>
            <Text style={styles.donutCenterLabel}>합계</Text>
            <Text style={styles.donutCenterValue} numberOfLines={1} ellipsizeMode="tail">
              {formatCurrency(total, currency)}
            </Text>
          </View>
        </View>
      </View>

      {/* 2. 하단 카테고리별 상세 리스트 */}
      <View style={styles.categoryList}>
        {data
          .filter((d) => d.value > 0)
          .map((d) => {
            const pct = ((d.value / total) * 100).toFixed(1);
            const barPct = Math.min(100, Math.max(0, (d.value / total) * 100));
            return (
              <View key={d.id} style={styles.categoryItem}>
                <View style={styles.categoryHeader}>
                  <View style={styles.categoryLeft}>
                    <View style={[styles.categoryDot, { backgroundColor: d.color || '#9CA3AF' }]} />
                    <Text style={styles.categoryName} numberOfLines={1}>
                      {d.label}
                    </Text>
                  </View>
                  <View style={styles.categoryRight}>
                    <Text style={styles.categoryAmount}>{formatCurrency(d.value, currency)}</Text>
                    <Text style={styles.categoryPercent}>{pct}%</Text>
                  </View>
                </View>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: `${barPct}%`, backgroundColor: d.color || '#9CA3AF' },
                    ]}
                  />
                </View>
              </View>
            );
          })}
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
  // If almost full circle (e.g. 99.999%), cap end angle slightly to prevent SVG arc zero-length artifact
  const diff = end - start;
  const isFullCircle = diff >= Math.PI * 1.9999;
  const actualEnd = isFullCircle ? start + Math.PI * 1.9999 : end;

  const large = actualEnd - start > Math.PI ? 1 : 0;
  const sx = cx + outer * Math.cos(start);
  const sy = cy + outer * Math.sin(start);
  const ex = cx + outer * Math.cos(actualEnd);
  const ey = cy + outer * Math.sin(actualEnd);
  const isx = cx + inner * Math.cos(actualEnd);
  const isy = cy + inner * Math.sin(actualEnd);
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

  pieContainer: { width: '100%', paddingVertical: 12 },
  chartWrapper: { alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  donutCenter: {
    position: 'absolute',
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  donutCenterLabel: { fontSize: 11, color: '#6B7280', fontWeight: '500', marginBottom: 2 },
  donutCenterValue: { fontSize: 12, color: '#111827', fontWeight: '700', textAlign: 'center' },

  categoryList: { width: '100%', gap: 12 },
  categoryItem: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, marginRight: 8 },
  categoryDot: { width: 10, height: 10, borderRadius: 5 },
  categoryName: { fontSize: 14, fontWeight: '600', color: '#1F2937', flexShrink: 1 },
  categoryRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryAmount: { fontSize: 14, fontWeight: '700', color: '#111827' },
  categoryPercent: { fontSize: 12, color: '#6B7280', fontWeight: '600', minWidth: 42, textAlign: 'right' },
  progressBarBg: { height: 5, backgroundColor: '#E5E7EB', borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%', borderRadius: 3 },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  empty: { color: '#9CA3AF', fontSize: 14, textAlign: 'center' },
});
