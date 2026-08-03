import Chart from 'chart.js/auto';
import {
  DefectDojoDashboardCharts,
  DefectDojoScanSnapshot,
  DefectDojoTimeSeriesPoint
} from './defectdojo.service';

export type OpenSeverityGranularity = 'hour' | 'day' | 'week' | 'month';

export const OPEN_SEV_BAR_COLORS: Record<string, string> = {
  Critical: '#EF4444',
  High: '#F97316',
  Medium: '#EAB308',
  Low: '#3B82F6',
  Info: '#94A3B8'
};

export const OPEN_SEV_LINE_COLORS: Record<string, string> = {
  Critical: '#dc3545',
  High: '#fd7e14',
  Medium: '#ffc107',
  Low: '#28a745',
  Info: '#17a2b8'
};

const DEFAULT_SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];

export function hasOpenSeverityChartData(charts?: DefectDojoDashboardCharts | null): boolean {
  return (charts?.scanSnapshots?.length ?? 0) > 0
    || (charts?.detailedMetrics?.openDayToDayBySeverity?.length ?? 0) > 0;
}

export function openSeverityChartSubtitle(
  granularity: OpenSeverityGranularity,
  branchLabel?: string
): string {
  const branchSuffix = branchLabel?.trim() ? ` · branche ${branchLabel.trim()}` : '';
  switch (granularity) {
    case 'hour':
      return `Open by Severity · dernier scan connu par heure${branchSuffix}`;
    case 'day':
      return branchLabel?.trim()
        ? `Open Day to Day · branche sélectionnée · un point par jour${branchSuffix}`
        : 'Open Day to Day · branche sélectionnée · un point par jour';
    case 'week':
      return `Open by Severity · dernier état connu par semaine${branchSuffix}`;
    case 'month':
      return `Open by Severity · dernier état connu par mois${branchSuffix}`;
    default:
      return `Évolution des vulnérabilités ouvertes par sévérité${branchSuffix}`;
  }
}

export function renderOpenSeverityEvolutionChart(
  canvas: HTMLCanvasElement,
  charts: DefectDojoDashboardCharts | null | undefined,
  granularity: OpenSeverityGranularity,
  severities: string[] = DEFAULT_SEVERITIES,
  existingChart?: Chart
): Chart | undefined {
  const snapshots = charts?.scanSnapshots ?? [];
  const dayToDay = charts?.detailedMetrics?.openDayToDayBySeverity;
  const hasData = snapshots.length > 0 || (dayToDay?.length ?? 0) > 0;
  if (!hasData) return undefined;

  const wrap = canvas.parentElement;
  if (!wrap || wrap.clientWidth === 0) return undefined;

  existingChart?.destroy();
  Chart.getChart(canvas)?.destroy();

  canvas.width = wrap.clientWidth;
  canvas.height = 280;

  const sorted = resolveSeverityChartSnapshots(snapshots, charts, granularity, severities);
  const labels = sorted.map(s => formatSeverityChartLabel(s, granularity));
  const maxTicks = granularity === 'hour' ? 24 : granularity === 'day' ? 18 : 10;
  const yMax = Math.max(
    ...sorted.flatMap(s => severities.map(sev => s.bySeverity?.[sev] || 0)),
    1
  );
  const yStep = niceChartStepSize(yMax);

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: severities.map(sev => ({
        label: sev,
        data: sorted.map(s => s.bySeverity?.[sev] || 0),
        borderColor: OPEN_SEV_LINE_COLORS[sev] ?? '#64748b',
        backgroundColor: OPEN_SEV_LINE_COLORS[sev] ?? '#64748b',
        tension: 0.1,
        pointRadius: granularity === 'day' ? 4 : 5,
        pointHoverRadius: 7,
        borderWidth: 2,
        fill: false
      }))
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: { boxWidth: 12, padding: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            title: items => {
              const idx = items[0]?.dataIndex ?? 0;
              const snap = sorted[idx];
              if (!snap) return '';
              if (granularity === 'day') {
                const day = snapshotDayKey(snap);
                return day ? formatDayLabel(day) : (snap.label || '');
              }
              return formatSeverityChartLabel(snap, granularity);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: granularity === 'day' ? 0 : 45,
            autoSkip: true,
            maxTicksLimit: maxTicks,
            font: { size: 10 }
          }
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: yStep, font: { size: 10 } },
          grid: { color: 'rgba(15,23,42,0.08)' }
        }
      }
    }
  });
}

function resolveSeverityChartSnapshots(
  snapshots: DefectDojoScanSnapshot[],
  charts: DefectDojoDashboardCharts | null | undefined,
  granularity: OpenSeverityGranularity,
  severities: string[]
): DefectDojoScanSnapshot[] {
  const sorted = [...snapshots].sort((a, b) =>
    (a.timestamp || a.date || '').localeCompare(b.timestamp || b.date || '')
  );

  if (granularity === 'week') {
    const fromMetrics = charts?.detailedMetrics?.weekToWeekBySeverity;
    if (fromMetrics?.length) {
      return fromMetrics.map(p => ({
        testId: 0,
        scanType: 'Semaine',
        label: formatWeekPeriodLabel(p.period),
        bySeverity: p.bySeverity ?? {},
        totalOpen: Object.values(p.bySeverity ?? {}).reduce((s, n) => s + (n || 0), 0)
      }));
    }
    return aggregateSnapshotsByWeek(sorted);
  }

  if (granularity === 'month') {
    const fromMetrics = charts?.detailedMetrics?.openDayToDayBySeverity;
    if (fromMetrics?.length) {
      return aggregateDayMetricsByMonth(fromMetrics);
    }
    return aggregateSnapshotsByMonth(sorted);
  }

  if (granularity === 'hour') {
    return aggregateSnapshotsByHour(sorted);
  }

  if (granularity === 'day') {
    const fromMetrics = charts?.detailedMetrics?.openDayToDayBySeverity;
    if (fromMetrics?.length) {
      return prependZeroBaselineDay(mapDayToDayMetricsToSnapshots(fromMetrics, severities), severities);
    }
    return prependZeroBaselineDay(
      fillAllDaysForward(aggregateSnapshotsByDay(sorted), severities),
      severities
    );
  }

  return sorted;
}

function formatSeverityChartLabel(s: DefectDojoScanSnapshot, granularity: OpenSeverityGranularity): string {
  if (granularity === 'week' || granularity === 'month') {
    return s.label || '—';
  }
  if (granularity === 'hour') {
    const hourKey = snapshotHourKey(s);
    return hourKey ? formatHourLabel(hourKey) : (s.label || '—');
  }
  const day = snapshotDayKey(s);
  return day ? formatDayLabel(day) : (s.label || '—');
}

function niceChartStepSize(maxValue: number): number {
  if (maxValue <= 10) return 1;
  if (maxValue <= 25) return 5;
  if (maxValue <= 150) return 25;
  return Math.ceil(maxValue / 5 / 10) * 10;
}

function formatDayLabel(isoDay: string): string {
  const p = isoDay.split('-');
  return p.length === 3 ? `${p[0]}/${p[1]}/${p[2]}` : isoDay;
}

function formatHourLabel(isoHour: string): string {
  const [datePart, hourPart] = isoHour.split('T');
  if (!datePart || hourPart == null) return isoHour;
  const p = datePart.split('-');
  if (p.length !== 3) return isoHour;
  return `${p[0]}/${p[1]}/${p[2]} ${hourPart}:00`;
}

function prependZeroBaselineDay(
  snapshots: DefectDojoScanSnapshot[],
  severities: string[]
): DefectDojoScanSnapshot[] {
  if (!snapshots.length) return snapshots;
  const firstDay = snapshotDayKey(snapshots[0]) || snapshots[0].date?.slice(0, 10);
  if (!firstDay) return snapshots;
  const prevDay = addDaysIso(firstDay, -1);
  if (snapshots.some(s => snapshotDayKey(s) === prevDay)) {
    return snapshots;
  }
  return [buildZeroDaySnapshot(prevDay, severities), ...snapshots];
}

function buildZeroDaySnapshot(day: string, severities: string[]): DefectDojoScanSnapshot {
  const bySeverity = Object.fromEntries(severities.map(sev => [sev, 0]));
  return {
    testId: 0,
    scanType: 'Jour',
    label: formatDayLabel(day),
    date: day,
    timestamp: day,
    totalOpen: 0,
    bySeverity
  };
}

function addDaysIso(isoDay: string, delta: number): string {
  const d = safeParseDate(isoDay);
  if (!d) return isoDay;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + delta);
  return formatLocalDay(next);
}

function mapDayToDayMetricsToSnapshots(
  points: DefectDojoTimeSeriesPoint[],
  severities: string[]
): DefectDojoScanSnapshot[] {
  return points.map(p => ({
    testId: 0,
    scanType: 'Jour',
    label: formatDayLabel(p.period),
    date: p.period,
    timestamp: p.period,
    totalOpen: severities.reduce((s, sev) => s + (p.bySeverity?.[sev] ?? 0), 0),
    bySeverity: { ...(p.bySeverity ?? {}) }
  }));
}

function fillAllDaysForward(
  snapshots: DefectDojoScanSnapshot[],
  severities: string[]
): DefectDojoScanSnapshot[] {
  if (!snapshots.length) return snapshots;

  const byDay = new Map<string, DefectDojoScanSnapshot>();
  for (const s of snapshots) {
    const key = snapshotDayKey(s);
    if (key) byDay.set(key, s);
  }

  const sortedKeys = [...byDay.keys()].sort();
  const firstDay = sortedKeys[0];
  const today = formatLocalDay(new Date());
  const timeline = expandDayRange(firstDay, today);

  const emptySeverity = (): Record<string, number> =>
    Object.fromEntries(severities.map(sev => [sev, 0]));

  let last: DefectDojoScanSnapshot | null = null;
  return timeline.map(day => {
    const snap = byDay.get(day);
    if (snap) last = snap;
    const bySeverity = last?.bySeverity ?? emptySeverity();
    return {
      testId: 0,
      scanType: 'Jour',
      label: formatDayLabel(day),
      date: day,
      timestamp: day,
      totalOpen: severities.reduce((s, sev) => s + (bySeverity[sev] ?? 0), 0),
      bySeverity: { ...bySeverity }
    };
  });
}

function formatLocalDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function expandDayRange(startDay: string, endDay: string): string[] {
  const start = safeParseDate(startDay);
  const end = safeParseDate(endDay);
  if (!start || !end) return [startDay];

  const from = start.getTime() <= end.getTime() ? new Date(start) : new Date(end);
  const to = start.getTime() <= end.getTime() ? new Date(end) : new Date(start);
  const days: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const limit = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor.getTime() <= limit.getTime()) {
    days.push(formatLocalDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days.length ? days : [startDay];
}

function aggregateSnapshotsByDay(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
  const buckets = new Map<string, DefectDojoScanSnapshot>();
  for (const s of snapshots) {
    const key = snapshotDayKey(s);
    if (!key) continue;
    const prev = buckets.get(key);
    if (!prev || getSnapshotSortKey(s) > getSnapshotSortKey(prev)) {
      buckets.set(key, { ...s, date: key, label: formatDayLabel(key) });
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, snap]) => snap);
}

function aggregateSnapshotsByHour(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
  const buckets = new Map<string, DefectDojoScanSnapshot>();
  for (const s of snapshots) {
    const key = snapshotHourKey(s);
    if (!key) continue;
    const prev = buckets.get(key);
    if (!prev || getSnapshotSortKey(s) > getSnapshotSortKey(prev)) {
      buckets.set(key, {
        ...s,
        timestamp: `${key}:00:00`,
        label: formatHourLabel(key)
      });
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, snap]) => snap);
}

function snapshotDayKey(s: DefectDojoScanSnapshot): string | null {
  if (s.date && /^\d{4}-\d{2}-\d{2}/.test(s.date)) {
    return s.date.slice(0, 10);
  }
  const d = parseSnapshotDate(s);
  if (!d) return null;
  return formatLocalDay(d);
}

function snapshotHourKey(s: DefectDojoScanSnapshot): string | null {
  const raw = s.timestamp || s.date;
  if (!raw) return null;
  if (raw.length >= 13 && raw.includes('T')) {
    return raw.substring(0, 13);
  }
  const d = parseSnapshotDate(s);
  if (!d) return null;
  const day = snapshotDayKey(s);
  if (!day) return null;
  return `${day}T${String(d.getHours()).padStart(2, '0')}`;
}

function aggregateSnapshotsByWeek(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
  const buckets = new Map<string, DefectDojoScanSnapshot>();
  for (const s of snapshots) {
    const d = parseSnapshotDate(s);
    if (!d) continue;
    const key = startOfWeek(d).toISOString().slice(0, 10);
    const prev = buckets.get(key);
    if (!prev || getSnapshotSortKey(s) > getSnapshotSortKey(prev)) {
      buckets.set(key, s);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, s]) => ({ ...s, label: formatWeekPeriodLabel(key) }));
}

function aggregateSnapshotsByMonth(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
  const buckets = new Map<string, DefectDojoScanSnapshot>();
  for (const s of snapshots) {
    const d = parseSnapshotDate(s);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const prev = buckets.get(key);
    if (!prev || getSnapshotSortKey(s) > getSnapshotSortKey(prev)) {
      buckets.set(key, s);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, s]) => ({ ...s, label: formatMonthPeriodLabel(key) }));
}

function aggregateDayMetricsByMonth(points: DefectDojoTimeSeriesPoint[]): DefectDojoScanSnapshot[] {
  const buckets = new Map<string, DefectDojoTimeSeriesPoint>();
  for (const p of points) {
    const d = safeParseDate(p.period);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const prev = buckets.get(key);
    if (!prev || p.period.localeCompare(prev.period) > 0) {
      buckets.set(key, p);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, p]) => ({
      testId: 0,
      scanType: 'Mois',
      label: formatMonthPeriodLabel(key),
      bySeverity: p.bySeverity ?? {},
      totalOpen: Object.values(p.bySeverity ?? {}).reduce((s, n) => s + (n || 0), 0)
    }));
}

function parseSnapshotDate(s: DefectDojoScanSnapshot): Date | null {
  const raw = s.timestamp || s.date;
  return raw ? safeParseDate(raw) : null;
}

function getSnapshotSortKey(s: DefectDojoScanSnapshot): string {
  return s.timestamp || s.date || '';
}

function formatWeekPeriodLabel(period: string): string {
  const d = safeParseDate(period.length === 10 ? period : period.slice(0, 10));
  if (!d) return period;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `Sem. ${day}/${month}`;
}

function formatMonthPeriodLabel(key: string): string {
  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const [year, month] = key.split('-');
  const idx = Number(month) - 1;
  if (!year || idx < 0 || idx > 11) return key;
  return `${monthNames[idx]} ${year}`;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = d.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - daysFromMonday);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function safeParseDate(dateValue: unknown): Date | null {
  if (!dateValue) return null;
  try {
    if (typeof dateValue === 'number') {
      const date = new Date(dateValue);
      return isNaN(date.getTime()) ? null : date;
    }
    if (typeof dateValue === 'string') {
      const date = new Date(dateValue);
      return isNaN(date.getTime()) ? null : date;
    }
    if (Array.isArray(dateValue) && dateValue.length >= 3) {
      const [year, month, day, hour = 0, minute = 0, second = 0] = dateValue as number[];
      const date = new Date(year, month - 1, day, hour, minute, second);
      return isNaN(date.getTime()) ? null : date;
    }
    return null;
  } catch {
    return null;
  }
}
