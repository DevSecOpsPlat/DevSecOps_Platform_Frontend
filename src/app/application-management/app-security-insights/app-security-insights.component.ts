import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, finalize, takeUntil, timeout } from 'rxjs/operators';
import {
  AppServiceModel,
  SecurityPostureResponse
} from '../../models/application-management/application-management.models';
import {
  DefectDojoDashboardCharts,
  DefectDojoDashboardResponse,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';
import {
  AxisTick,
  buildScanToolBarRows,
  buildScanToolRows,
  buildSeverityEvolution,
  mergeDashboardCharts,
  mergeScanToolRows,
  ScanToolBarRow,
  SeverityEvolutionSeries
} from '../../services/defectdojo/dashboard-chart-builders';
import {
  hasOpenSeverityChartData,
  openSeverityChartSubtitle,
  OpenSeverityGranularity
} from '../../services/defectdojo/open-severity-evolution-chart.helper';
import { severityColor } from '../../services/defectdojo/severity-palette';
import { VerdictTone, verdictLabelFr, verdictTone } from '../shared/verdict.util';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];

const SEVERITY_FR: Record<string, string> = {
  Critical: 'Critique',
  High: 'Élevée',
  Medium: 'Moyenne',
  Low: 'Faible',
  Info: 'Info'
};

interface ScannerDef {
  id: string;
  name: string;
  type: string;
  icon: string;
  matchers: string[];
}

/** Outils de la chaîne CI (même liste que la vue d'ensemble d'un service). */
const SCANNERS: ScannerDef[] = [
  { id: 'gitleaks', name: 'Gitleaks', type: 'Secrets', icon: 'assets/scanners/gitleaks.svg', matchers: ['gitleaks'] },
  { id: 'semgrep', name: 'Semgrep', type: 'SAST', icon: 'assets/scanners/semgrep.svg', matchers: ['semgrep'] },
  { id: 'trivy', name: 'Trivy', type: 'SCA', icon: 'assets/scanners/trivy.svg', matchers: ['trivy'] },
  { id: 'grype', name: 'Grype', type: 'Conteneur', icon: 'assets/scanners/grype.svg', matchers: ['grype', 'anchore'] },
  { id: 'checkov', name: 'Checkov', type: 'IaC', icon: 'assets/scanners/checkov.svg', matchers: ['checkov'] },
  { id: 'hadolint', name: 'Hadolint', type: 'Dockerfile', icon: 'assets/scanners/hadolint.svg', matchers: ['hadolint'] },
  { id: 'zap', name: 'OWASP ZAP', type: 'DAST', icon: 'assets/scanners/zap.svg', matchers: ['zap'] }
];

interface ScannerRow extends ScannerDef {
  active: boolean;
  total: number;
  segments: ScanToolBarRow['segments'];
  pct: number;
}

/**
 * Tableau de bord de l'application : « Évolution par sévérité » (tous services confondus) et
 * « Score et outils » — les deux blocs présents sur la vue d'ensemble d'un service.
 * Les séries proviennent des tableaux de bord DefectDojo de chaque service, fusionnés avec les
 * mêmes fonctions pures que l'onglet DefectDojo de l'application.
 */
@Component({
  selector: 'app-security-insights',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app-security-insights.component.html',
  styleUrls: ['./app-security-insights.component.css']
})
export class AppSecurityInsightsComponent implements OnChanges, OnDestroy {
  @Input() services: AppServiceModel[] = [];
  @Input() posture: SecurityPostureResponse | null = null;
  @Input() refreshTick = 0;

  @Output() openQualityGate = new EventEmitter<void>();
  @Output() openVulnerabilities = new EventEmitter<void>();

  readonly severities = SEVERITIES;
  readonly plotX0 = 2;

  loading = false;
  error: string | null = null;
  granularity: OpenSeverityGranularity = 'day';

  private charts: DefectDojoDashboardCharts | null = null;
  private engagedCount = 0;
  hasChart = false;
  series: SeverityEvolutionSeries[] = [];
  yTicks: AxisTick[] = [{ value: 1, y: 4 }, { value: 0, y: 96 }];
  labels: string[] = [];
  scannerRows: ScannerRow[] = [];
  otherToolRows: ScanToolBarRow[] = [];

  animatedScore = 0;
  private rafId: number | null = null;
  private readonly destroy$ = new Subject<void>();
  private readonly cancel$ = new Subject<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['services'] || (changes['refreshTick'] && !changes['refreshTick'].firstChange)) {
      this.load();
    }
    if (changes['posture']) {
      this.animateScore(this.posture?.securityScore ?? 0);
    }
  }

  ngOnDestroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.cancel$.next();
    this.cancel$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Chargement ───────────────────────────────────────────────────────────

  private load(): void {
    const list = (this.services || []).filter(s => !!s.id);
    this.cancel$.next();
    if (!list.length) {
      this.reset();
      return;
    }
    this.loading = true;
    this.error = null;
    const calls = list.map(svc =>
      this.defectDojo.getDashboard(svc.id!, (svc.gitBranch || 'main').trim() || 'main', this.defectDojo.scanKindTag(), true)
        .pipe(timeout(60_000), catchError(() => of(null as DefectDojoDashboardResponse | null)))
    );
    forkJoin(calls).pipe(
      takeUntil(this.cancel$),
      takeUntil(this.destroy$),
      finalize(() => (this.loading = false))
    ).subscribe({
      next: dashboards => this.compute(dashboards),
      error: () => {
        this.error = 'Impossible de charger l\'évolution des vulnérabilités.';
        this.reset();
      }
    });
  }

  private reset(): void {
    this.charts = null;
    this.engagedCount = 0;
    this.hasChart = false;
    this.series = [];
    this.labels = [];
    this.scannerRows = this.buildScannerRows([]);
    this.otherToolRows = [];
  }

  private compute(dashboards: Array<DefectDojoDashboardResponse | null>): void {
    const engaged = dashboards.filter((d): d is DefectDojoDashboardResponse => !!d?.engagementId);
    this.engagedCount = engaged.length;
    this.charts = engaged.length === 1
      ? (engaged[0].charts ?? null)
      : (engaged.length ? mergeDashboardCharts(engaged.map(d => d.charts)) : null);
    this.hasChart = hasOpenSeverityChartData(this.charts);
    this.rebuildEvolution();
    const toolRows = buildScanToolBarRows(
      mergeScanToolRows(engaged.map(d => buildScanToolRows(d.charts))),
      SEVERITIES
    );
    this.scannerRows = this.buildScannerRows(toolRows);
    this.otherToolRows = toolRows.filter(r => !SCANNERS.some(s => this.matches(s, r.label)));
  }

  private rebuildEvolution(): void {
    const evo = buildSeverityEvolution(this.charts, this.granularity, SEVERITIES, this.plotX0);
    this.series = evo.series;
    this.yTicks = evo.yTicks;
    this.labels = evo.labels;
  }

  private matches(def: ScannerDef, label: string): boolean {
    const l = (label || '').toLowerCase();
    return def.matchers.some(m => l.includes(m));
  }

  private buildScannerRows(toolRows: ScanToolBarRow[]): ScannerRow[] {
    const max = Math.max(1, ...toolRows.map(r => r.total));
    return SCANNERS.map(def => {
      const rows = toolRows.filter(r => this.matches(def, r.label));
      const total = rows.reduce((n, r) => n + r.total, 0);
      const bySev: Record<string, number> = {};
      for (const r of rows) {
        for (const seg of r.segments) bySev[seg.sev] = (bySev[seg.sev] || 0) + seg.value;
      }
      return {
        ...def,
        active: rows.length > 0,
        total,
        pct: total > 0 ? Math.max(3, Math.round((total / max) * 100)) : 0,
        segments: SEVERITIES
          .filter(sev => (bySev[sev] || 0) > 0)
          .map(sev => ({ sev, value: bySev[sev], pct: total ? (bySev[sev] / total) * 100 : 0, color: severityColor(sev) }))
      };
    });
  }

  constructor(private defectDojo: DefectDojoService) {}

  // ── Évolution ────────────────────────────────────────────────────────────

  setGranularity(g: OpenSeverityGranularity): void {
    if (this.granularity === g) return;
    this.granularity = g;
    this.rebuildEvolution();
  }

  get subtitle(): string {
    const base = openSeverityChartSubtitle(this.granularity);
    return this.engagedCount > 1 ? `${base} · ${this.engagedCount} services` : base;
  }

  severityLabel(sev: string): string {
    return SEVERITY_FR[sev] || sev;
  }

  sevColor(sev: string): string {
    return severityColor(sev);
  }

  // ── Score ────────────────────────────────────────────────────────────────

  get hasScore(): boolean {
    return this.posture?.securityScore != null;
  }

  get tone(): VerdictTone {
    return verdictTone(this.posture?.verdict);
  }

  get verdictLabel(): string {
    return this.posture?.verdict ? verdictLabelFr(this.posture.verdict) : 'Aucun scan';
  }

  get grade(): string {
    const p = this.posture;
    if (!p || p.securityScore == null) return '—';
    if (p.grade) return p.grade;
    const s = p.securityScore;
    return s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'E';
  }

  get scoreColor(): string {
    const s = this.posture?.securityScore ?? 0;
    if (s >= 75) return '#22C55E';
    if (s >= 60) return '#EAB308';
    if (s >= 40) return '#F97316';
    return '#EF4444';
  }

  get weakestService(): string | null {
    return this.posture?.dimensioningService?.serviceName || null;
  }

  sevCount(key: string): number {
    const map = this.posture?.bySeverity || {};
    return map[key] ?? 0;
  }

  get activeScannerCount(): number {
    return this.scannerRows.filter(r => r.active).length;
  }

  private animateScore(target: number): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof requestAnimationFrame === 'undefined') {
      this.animatedScore = target;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 900);
      this.animatedScore = Math.round(target * (1 - Math.pow(1 - p, 3)));
      this.rafId = p < 1 ? requestAnimationFrame(step) : null;
    };
    this.rafId = requestAnimationFrame(step);
  }
}
