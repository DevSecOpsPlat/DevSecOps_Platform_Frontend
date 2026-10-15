/**
 * Fonctions PURES de construction des graphiques du dashboard DefectDojo,
 * extraites de security-dashboard.component.ts pour être partagées avec
 * managed-security-dashboard.component.ts (vue agrégée « toute l'app ») —
 * un seul endroit à corriger, un seul rendu visuel pour les deux écrans.
 *
 * Comme svg-chart-utils.ts : à précalculer dans le composant (recompute...()),
 * jamais à appeler depuis un template (*ngFor/*ngIf) sous peine de boucle de
 * détection de changements Angular.
 */
import { smoothPath, niceAxisTicks } from '../../shared/svg-chart-utils';
import {
  DefectDojoDashboardCharts,
  DefectDojoScanSnapshot
} from './defectdojo.service';
import {
  OpenSeverityGranularity,
  resolveSeverityChartSnapshots
} from './open-severity-evolution-chart.helper';
import {
  FluxBucket,
  FluxGranularity,
  buildBuckets
} from './treatment-flux-chart.helper';
import { cweDisplayLabel } from './cwe-labels';
import { severityColor } from './severity-palette';

const FLUX_COLORS = {
  down: '#16a34a',   // stock en baisse — ça s'améliore
  up: '#c2410c',     // stock en hausse
  flat: '#475569'    // stable
};

export interface AxisTick {
  value: number;
  y: number;
}

export interface FluxBarDatum {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  label: string;
  stock: number;
  nouvelles: number;
  resolues: number;
  /** Variation par rapport à la période précédente — pour l'affichage ▲/▼ à côté du nombre. */
  delta: number;
  trend: 'up' | 'down' | 'flat';
}

export interface FluxChart {
  bars: FluxBarDatum[];
  yTicks: AxisTick[];
}

/**
 * Barres SVG « Flux de traitement ». Le domaine Y n'est plus [0, max] (ce qui
 * écrasait visuellement des variations de stock du type 160↔203 en barres
 * quasi identiques, toutes à 71-90 % de la hauteur) mais [floor, max] où
 * `floor` est calé juste sous le minimum réel de la fenêtre visible : la même
 * variation occupe alors toute la hauteur disponible. On ajoute aussi de
 * vraies graduations (comme le graphique d'évolution), affichées en fond, et
 * un peu de marge en haut pour que la graduation la plus haute ne touche
 * jamais le sommet de la barre la plus haute.
 *
 * `plotX0` (mêmes unités 0-100 que les autres graphiques) réserve une petite
 * marge à gauche pour les chiffres de l'axe Y — sans ça, la première barre
 * commence à x=0 et les pastilles de graduation se retrouvent posées EN PLEIN
 * SUR la barre au lieu de la marge dédiée que les autres graphiques (Évolution,
 * Par outil de scan) réservent déjà.
 */
export function buildFluxChart(
  charts: DefectDojoDashboardCharts | null | undefined,
  granularity: FluxGranularity,
  plotX0 = 0
): FluxChart {
  const buckets: FluxBucket[] = buildBuckets(charts, granularity);
  const withDeltas = buckets.map((b, i) => ({
    label: b.label,
    stock: b.stock,
    nouvelles: i === 0 ? 0 : Math.max(0, b.stock - buckets[i - 1].stock),
    resolues: i === 0 ? 0 : Math.max(0, buckets[i - 1].stock - b.stock)
  })).slice(-14);

  if (!withDeltas.length) return { bars: [], yTicks: [] };

  const values = withDeltas.map(b => b.stock);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const range = Math.max(1, dataMax - dataMin);
  const rangeTicks = niceAxisTicks(range, 4);
  const step = rangeTicks.length > 1 ? rangeTicks[0] - rangeTicks[1] : Math.max(1, Math.round(dataMax / 10) || 1);

  let floor = Math.floor(dataMin / step) * step;
  if (floor >= dataMin) floor -= step;
  floor = Math.max(0, floor);
  let top = Math.max(floor + step, Math.ceil(dataMax / step) * step);
  if (top - dataMax < step * 0.25) top += step; // marge visuelle au-dessus de la barre la plus haute
  const domain = Math.max(1, top - floor);

  const yTicks: AxisTick[] = [];
  for (let v = top; v >= floor; v -= step) {
    yTicks.push({ value: Math.round(v), y: 96 - ((v - floor) / domain) * 92 });
  }

  const n = withDeltas.length;
  const gap = n > 1 ? 1.5 : 0;
  const barWidth = (100 - plotX0 - gap * (n - 1)) / n;

  const bars: FluxBarDatum[] = withDeltas.map((b, i) => {
    const height = Math.max(1, ((b.stock - floor) / domain) * 92);
    const delta = i === 0 ? 0 : b.stock - withDeltas[i - 1].stock;
    const trend: 'up' | 'down' | 'flat' = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const color = trend === 'down' ? FLUX_COLORS.down : trend === 'up' ? FLUX_COLORS.up : FLUX_COLORS.flat;
    return {
      x: plotX0 + i * (barWidth + gap),
      y: 96 - height,
      width: barWidth,
      height,
      color,
      label: b.label,
      stock: b.stock,
      nouvelles: b.nouvelles,
      resolues: b.resolues,
      delta,
      trend
    };
  });

  return { bars, yTicks };
}

export interface ScanToolRow {
  label: string;
  bySeverity: Record<string, number>;
  totalOpen: number;
  testId: number;
}

/** Un import (le plus récent) par outil, trié par volume décroissant. */
export function buildScanToolRows(charts: DefectDojoDashboardCharts | null | undefined): ScanToolRow[] {
  const snapshots = charts?.scanSnapshots ?? [];
  if (!snapshots.length) return [];
  const latestByTool = new Map<string, DefectDojoScanSnapshot>();
  for (const s of snapshots) {
    const key = s.scanType || String(s.testId);
    const prev = latestByTool.get(key);
    if (!prev || (s.timestamp || s.date || '') > (prev.timestamp || prev.date || '')) {
      latestByTool.set(key, s);
    }
  }
  return [...latestByTool.values()]
    .sort((a, b) => (b.totalOpen || 0) - (a.totalOpen || 0))
    .map(s => ({
      label: s.scanType || s.label || `Test #${s.testId}`,
      bySeverity: s.bySeverity || {},
      totalOpen: s.totalOpen || 0,
      testId: s.testId
    }));
}

export interface ScanToolBarSegment {
  sev: string;
  value: number;
  pct: number; // part du total de CETTE ligne (pour l'empilement horizontal)
  color: string;
}

export interface ScanToolBarRow {
  testId: number;
  label: string;
  total: number;
  /** Largeur de la ligne en % du plus gros outil — plancher à 2 % si total > 0 pour rester visible. */
  pct: number;
  segments: ScanToolBarSegment[];
}

/**
 * Somme plusieurs listes de ScanToolRow (une par service) par nom d'outil —
 * pour la vue agrégée « toute l'app » : chaque service a déjà sa propre ligne
 * correcte par outil (dernier import, cf. buildScanToolRows), on les cumule
 * ensuite par nom d'outil. `testId` perd son sens à ce niveau (plusieurs
 * imports différents partagent le même nom d'outil) : mis à 0, les lignes
 * agrégées ne sont donc pas cliquables (cf. onScanToolRowClick des deux
 * composants, qui ignore un testId à 0).
 */
export function mergeScanToolRows(rowsList: ScanToolRow[][]): ScanToolRow[] {
  const byLabel = new Map<string, ScanToolRow>();
  for (const rows of rowsList) {
    for (const row of rows) {
      const prev = byLabel.get(row.label);
      if (!prev) {
        byLabel.set(row.label, { label: row.label, bySeverity: { ...row.bySeverity }, totalOpen: row.totalOpen, testId: 0 });
        continue;
      }
      prev.totalOpen += row.totalOpen;
      for (const [sev, v] of Object.entries(row.bySeverity)) {
        prev.bySeverity[sev] = (prev.bySeverity[sev] || 0) + (v || 0);
      }
    }
  }
  return [...byLabel.values()].sort((a, b) => b.totalOpen - a.totalOpen);
}

/**
 * « Par outil de scan » en liste de lignes horizontales (même famille que
 * Top CWE / Âge des findings) au lieu d'un graphique en barres verticales à
 * échelle linéaire partagée : un outil dominant (ex. Anchore Grype à 174)
 * n'y écrase plus les autres (ZAP 12, Trivy 2…) au point de les rendre
 * invisibles, et les noms longs d'outils ne sont plus coupés en bas d'un
 * graphique — chaque ligne garde son étiquette et sa valeur toujours lisibles
 * quelle que soit l'échelle. Prend directement des ScanToolRow (pas `charts`)
 * pour être réutilisable telle quelle avec des lignes déjà fusionnées entre
 * plusieurs services (cf. mergeScanToolRows).
 */
export function buildScanToolBarRows(rows: ScanToolRow[], severities: string[]): ScanToolBarRow[] {
  if (!rows.length) return [];
  const max = Math.max(1, ...rows.map(r => r.totalOpen));
  return rows.map(r => ({
    testId: r.testId,
    label: r.label,
    total: r.totalOpen,
    pct: r.totalOpen > 0 ? Math.max(2, Math.round((r.totalOpen / max) * 100)) : 0,
    segments: severities
      .map(sev => {
        const value = r.bySeverity[sev] || 0;
        return {
          sev,
          value,
          pct: r.totalOpen > 0 ? (value / r.totalOpen) * 100 : 0,
          color: severityColor(sev)
        };
      })
      .filter(seg => seg.value > 0)
  }));
}

export interface CweRow {
  key: string;
  label: string;
  value: number;
  pct: number;
}

export function buildCweRows(charts: DefectDojoDashboardCharts | null | undefined): CweRow[] {
  const entries = mapEntries(charts?.detailedMetrics?.openCwe);
  const max = Math.max(1, ...entries.map(e => e.value));
  return entries.map(e => ({ key: e.key, label: cweDisplayLabel(e.key), value: e.value, pct: Math.round((e.value / max) * 100) }));
}

export interface FindingAgeRow {
  key: string;
  value: number;
  pct: number;
}

export function buildFindingAgeRows(charts: DefectDojoDashboardCharts | null | undefined): FindingAgeRow[] {
  const data = charts?.detailedMetrics?.findingAgeBuckets;
  if (!data) return [];
  const entries = Object.entries(data).map(([key, value]) => ({ key, value: value || 0 }));
  if (!entries.some(e => e.value > 0)) return [];
  const max = Math.max(1, ...entries.map(e => e.value));
  return entries.map(e => ({ key: e.key, value: e.value, pct: Math.round((e.value / max) * 100) }));
}

export interface SeverityEvolutionSeries {
  sev: string;
  color: string;
  path: string;
}

export interface SeverityEvolutionChart {
  series: SeverityEvolutionSeries[];
  yTicks: AxisTick[];
  max: number;
  labels: string[];
}

const EMPTY_EVOLUTION: SeverityEvolutionChart = {
  series: [],
  yTicks: [{ value: 1, y: 4 }, { value: 0, y: 96 }],
  max: 1,
  labels: []
};

export function buildSeverityEvolution(
  charts: DefectDojoDashboardCharts | null | undefined,
  granularity: OpenSeverityGranularity,
  severities: string[],
  plotX0: number
): SeverityEvolutionChart {
  const snaps = resolveSeverityChartSnapshots(
    charts?.scanSnapshots ?? [],
    charts,
    granularity,
    severities
  ).slice(-24);
  if (!snaps.length) return { ...EMPTY_EVOLUTION, series: [], labels: [] };

  const rawMax = Math.max(1, ...snaps.flatMap(s => severities.map(sev => s.bySeverity?.[sev] || 0)));
  const ticks = niceAxisTicks(rawMax, 5);
  const max = ticks[0];
  const yTicks = ticks.map(value => ({ value, y: 96 - (value / max) * 92 }));
  const n = snaps.length;
  const series = severities.map(sev => {
    const coords = snaps.map((s, i) => ({
      x: n === 1 ? (plotX0 + 100) / 2 : plotX0 + (i / (n - 1)) * (100 - plotX0),
      y: 96 - ((s.bySeverity?.[sev] || 0) / max) * 92
    }));
    return { sev, color: severityColor(sev), path: smoothPath(coords) };
  });
  const labels = snaps.length < 2
    ? snaps.map(s => s.label || '—')
    : [snaps[0], snaps[Math.floor((snaps.length - 1) / 2)], snaps[snaps.length - 1]].map(s => s.label || '—');

  return { series, yTicks, max, labels };
}

function mapEntries(m?: Record<string, number>): { key: string; value: number }[] {
  if (!m) return [];
  return Object.entries(m)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, value }));
}

/**
 * Fusionne les `charts` DefectDojo de plusieurs services (vue agrégée « toute
 * l'app ») en un seul objet additif. Sûr pour tous les compteurs — ce sont des
 * totaux déjà agrégés par outil au niveau de chaque service, donc les sommer
 * entre services ne mélange rien.
 *
 * `scanSnapshots` n'est PAS fusionné : dans buildBuckets/buildScanToolRows, le
 * dédoublonnage « un import par outil » se fait par nom d'outil — concaténer
 * les snapshots de deux services ferait collisionner deux « Anchore Grype »
 * distincts et n'en garderait qu'un au lieu de sommer les deux.
 *
 * Conséquence sur les granularités du Flux de traitement (treatment-flux-chart.helper.ts) :
 * « Jour » et « Mois » lisent detailedMetrics.openDayToDayBySeverity (fusionné ci-dessous,
 * donc sûrs) ; « Run » ET « Semaine » n'ont, dans buildBuckets, pas d'équivalent pré-agrégé
 * et retombent sur scanSnapshots — vide ici, donc pas proposés sur l'agrégat multi-services
 * (cf. le garde `multiServiceActive`/masquage des boutons Run/Semaine dans les deux
 * composants). Pour l'Évolution par sévérité (open-severity-evolution-chart.helper.ts),
 * seule « Heure » dépend de scanSnapshots — Jour/Semaine/Mois restent tous disponibles
 * (weekToWeekBySeverity et openDayToDayBySeverity sont fusionnés ci-dessous).
 */
export function mergeDashboardCharts(chartsList: (DefectDojoDashboardCharts | null | undefined)[]): DefectDojoDashboardCharts {
  const list = chartsList.filter((c): c is DefectDojoDashboardCharts => !!c);

  const bySeverity = sumRecords(list.map(c => c.bySeverity));
  const byTool = sumRecords(list.map(c => c.byTool));
  const byAnalysisType = sumRecords(list.map(c => c.byAnalysisType));
  const byStatus = sumRecords(list.map(c => c.byStatus));

  const openCwe = sumRecords(list.map(c => c.detailedMetrics?.openCwe));
  const totalCwe = sumRecords(list.map(c => c.detailedMetrics?.totalCwe));
  const findingAgeBuckets = sumRecords(list.map(c => c.detailedMetrics?.findingAgeBuckets));
  const openFindingsForAge = list.reduce((sum, c) => sum + (c.detailedMetrics?.openFindingsForAge || 0), 0);

  const openDayToDayBySeverity = mergeTimeSeriesByPeriod(list.map(c => c.detailedMetrics?.openDayToDayBySeverity));
  const weekToWeekBySeverity = mergeTimeSeriesByPeriod(list.map(c => c.detailedMetrics?.weekToWeekBySeverity));
  const openHourToHourBySeverity = mergeTimeSeriesByPeriod(list.map(c => c.detailedMetrics?.openHourToHourBySeverity));

  const lastScanDate = list
    .map(c => c.lastScanDate)
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  return {
    openCount: list.reduce((s, c) => s + (c.openCount || 0), 0),
    closedCount: list.reduce((s, c) => s + (c.closedCount || 0), 0),
    totalCount: list.reduce((s, c) => s + (c.totalCount || 0), 0),
    bySeverity,
    byTool,
    byAnalysisType,
    byStatus,
    scanSnapshots: [],
    detailedMetrics: {
      openDayToDayBySeverity,
      openHourToHourBySeverity,
      weekToWeekStatus: [],
      weekToWeekBySeverity,
      findingAgeBuckets,
      openFindingsForAge,
      weeklyActivity: [],
      openCwe,
      totalCwe
    },
    lastScanDate
  };
}

function sumRecords(records: (Record<string, number> | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    if (!r) continue;
    for (const [k, v] of Object.entries(r)) {
      out[k] = (out[k] || 0) + (v || 0);
    }
  }
  return out;
}

function mergeTimeSeriesByPeriod(
  series: ({ period: string; bySeverity: Record<string, number> }[] | undefined)[]
): { period: string; bySeverity: Record<string, number> }[] {
  const byPeriod = new Map<string, Record<string, number>>();
  for (const points of series) {
    for (const p of points ?? []) {
      const prev = byPeriod.get(p.period) ?? {};
      for (const [sev, v] of Object.entries(p.bySeverity ?? {})) {
        prev[sev] = (prev[sev] || 0) + (v || 0);
      }
      byPeriod.set(p.period, prev);
    }
  }
  return [...byPeriod.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, bySeverity]) => ({ period, bySeverity }));
}
