import {
  DefectDojoDashboardCharts,
  DefectDojoScanSnapshot,
  DefectDojoTimeSeriesPoint
} from './defectdojo.service';

/**
 * Flux de traitement : stock de findings ouverts + nouvelles/résolues par période.
 * Remplace « Évolution entre analyses » (qui comparait des OUTILS, pas du temps)
 * et « Open, Closed & Risk Accepted Week to Week » (vide avec < 2 semaines).
 *
 * Point clé : un run de pipeline importe ~6 tests (un par outil) à la même minute.
 * Le stock d'une période = SOMME des totalOpen du dernier import de CHAQUE outil
 * dans la période — jamais une comparaison outil à outil.
 */
export type FluxGranularity = 'run' | 'day' | 'week' | 'month';

const COLORS = {
  stock: '#f36c21',
  stockFill: 'rgba(243, 108, 33, 0.10)',
  nouvelles: '#dc2626',
  resolues: '#059669'
};

export function fluxChartSubtitle(g: FluxGranularity, bucketCount: number): string {
  const per = { run: 'par exécution de pipeline', day: 'par jour', week: 'par semaine', month: 'par mois' }[g];
  const approx = 'nouvelles/résolues estimées par variation du stock entre périodes';
  if (bucketCount < 2) {
    return `Une seule période disponible (${per}) — les flux apparaîtront dès la prochaine analyse.`;
  }
  return `Stock ouvert et flux ${per} — ${approx}.`;
}

export function hasFluxChartData(charts?: DefectDojoDashboardCharts | null): boolean {
  return !!charts?.scanSnapshots?.length || !!charts?.detailedMetrics?.openDayToDayBySeverity?.length;
}

export interface FluxBucket {
  key: string;
  label: string;
  stock: number;
}

export function buildBuckets(
  charts: DefectDojoDashboardCharts | null | undefined,
  granularity: FluxGranularity
): FluxBucket[] {
  const dayMetrics = charts?.detailedMetrics?.openDayToDayBySeverity ?? [];
  if (granularity === 'day' && dayMetrics.length) {
    return dayMetrics.map(p => dayPointToBucket(p));
  }
  if (granularity === 'month' && dayMetrics.length) {
    return lastPerKey(dayMetrics.map(p => ({ ...dayPointToBucket(p), key: p.period.slice(0, 7) })))
      .map(b => ({ ...b, label: formatMonth(b.key) }));
  }

  const snaps = [...(charts?.scanSnapshots ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  if (!snaps.length) return [];

  const keyOf = (s: DefectDojoScanSnapshot): string | null => {
    const d = parseDate(s);
    if (!d) return null;
    switch (granularity) {
      case 'run':   return runKey(d);
      case 'day':   return localDay(d);
      case 'week':  return localDay(startOfWeek(d));
      case 'month': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    }
  };

  const periods = new Map<string, Map<string, DefectDojoScanSnapshot>>();
  for (const s of snaps) {
    const key = keyOf(s);
    if (!key) continue;
    const toolKey = s.scanType || String(s.testId);
    const byTool = periods.get(key) ?? new Map<string, DefectDojoScanSnapshot>();
    const prev = byTool.get(toolKey);
    if (!prev || sortKey(s) > sortKey(prev)) byTool.set(toolKey, s);
    periods.set(key, byTool);
  }

  return [...periods.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, byTool]) => ({
      key,
      label: formatKey(key, granularity),
      stock: [...byTool.values()].reduce((sum, s) => sum + (s.totalOpen || 0), 0)
    }));
}

function dayPointToBucket(p: DefectDojoTimeSeriesPoint): FluxBucket {
  const stock = Object.values(p.bySeverity ?? {}).reduce((s, n) => s + (n || 0), 0);
  return { key: p.period, label: formatDay(p.period), stock };
}

function lastPerKey(items: FluxBucket[]): FluxBucket[] {
  const m = new Map<string, FluxBucket>();
  for (const it of items) m.set(it.key, it);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

function runKey(d: Date): string {
  const slot = Math.floor(d.getMinutes() / 10) * 10;
  return `${localDay(d)}T${pad(d.getHours())}:${pad(slot)}`;
}

function formatKey(key: string, g: FluxGranularity): string {
  switch (g) {
    case 'run': {
      const [day, hm] = key.split('T');
      return `${formatDay(day)} ${hm}`;
    }
    case 'day':   return formatDay(key);
    case 'week':  return `Sem. du ${formatDay(key)}`;
    case 'month': return formatMonth(key);
  }
}

function formatDay(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

function formatMonth(key: string): string {
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const [y, m] = key.split('-');
  return `${months[Number(m) - 1] ?? m} ${y}`;
}

function parseDate(s: DefectDojoScanSnapshot): Date | null {
  const raw = s.timestamp || s.date;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sortKey(s: DefectDojoScanSnapshot): string {
  return s.timestamp || s.date || '';
}

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - day);
  out.setHours(0, 0, 0, 0);
  return out;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function niceStep(max: number): number {
  if (max <= 10) return 1;
  if (max <= 50) return 5;
  if (max <= 100) return 10;
  return Math.ceil(max / 10 / 10) * 10;
}
