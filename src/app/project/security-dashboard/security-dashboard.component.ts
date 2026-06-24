import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import Chart from 'chart.js/auto';
import { Subject } from 'rxjs';
import { distinctUntilChanged, finalize, map, takeUntil } from 'rxjs/operators';
import {
  DefectDojoDashboardResponse,
  DefectDojoDetailedMetrics,
  DefectDojoFindingItem,
  DefectDojoMetricCard,
  DefectDojoMetricCategory,
  DefectDojoService,
  DefectDojoTimeSeriesPoint
} from '../../services/defectdojo/defectdojo.service';
import { EnvironmentService } from '../../services/environment/environment.service';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';

const METRIC_META: Record<DefectDojoMetricCategory, { icon: string; tone: string }> = {
  verified: { icon: '✓', tone: 'verified' },
  open: { icon: '⚠', tone: 'open' },
  risk_accepted: { icon: '⚖', tone: 'risk' },
  closed: { icon: '✔', tone: 'closed' },
  false_positive: { icon: '⊘', tone: 'fp' },
  out_of_scope: { icon: '↗', tone: 'oos' },
  total: { icon: '∑', tone: 'total' },
  inactive: { icon: '○', tone: 'inactive' }
};

const THEME = {
  navy: '#0f172a',
  navyMid: '#1e293b',
  navyLight: '#334155',
  slate: '#475569',
  orange: '#f36c21',
  orangeDark: '#ea580c',
  orangeDeep: '#c2410c',
  orangeSoft: '#fb923c',
  green: '#22c55e',
  greenDark: '#16a34a'
};

const SEV_COLORS: Record<string, string> = {
  Critical: THEME.orangeDeep,
  High: THEME.orangeDark,
  Medium: THEME.orange,
  Low: THEME.slate,
  Info: THEME.navyLight
};

/** Couleurs DefectDojo pour le graphique Open Day/Hour to Day by Severity. */
const DD_SEV_LINE_COLORS: Record<string, string> = {
  Critical: '#dc3545',
  High: '#fd7e14',
  Medium: '#ffc107',
  Low: '#28a745',
  Info: '#17a2b8'
};

@Component({
  selector: 'app-security-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './security-dashboard.component.html',
  styleUrls: [
    '../vulnerabilities-dashboard/vulnerabilities-dashboard.component.css',
    './security-dashboard.component.css'
  ]
})
export class SecurityDashboardComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private chartInstances: Chart[] = [];
  private openSeverityChart?: Chart;
  private trendChart?: Chart;

  @ViewChild('severityCanvas') severityCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('resolutionCanvas') resolutionCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('toolsCanvas') toolsCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('analysisCanvas') analysisCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('statusCanvas') statusCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('scanCanvas') scanCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('daySeverityCanvas') daySeverityCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('trendCanvas') trendCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('weekStatusCanvas') weekStatusCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('weekSeverityCanvas') weekSeverityCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('criticalWeekCanvas') criticalWeekCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('highWeekCanvas') highWeekCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('mediumWeekCanvas') mediumWeekCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('findingAgeCanvas') findingAgeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('weeklyActivityCanvas') weeklyActivityCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('openCweCanvas') openCweCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('totalCweCanvas') totalCweCanvas?: ElementRef<HTMLCanvasElement>;

  @ViewChildren('overviewChart') overviewCharts!: QueryList<ElementRef<HTMLCanvasElement>>;

  appId: string | null = null;
  selectedBranch = '';
  branches: string[] = [];
  environments: EnvironmentSummaryResponse[] = [];

  loading = false;
  listLoading = false;
  error: string | null = null;
  dashboard: DefectDojoDashboardResponse | null = null;

  selectedCategory: DefectDojoMetricCategory = 'open';
  findings: DefectDojoFindingItem[] = [];
  page = 0;
  readonly size = 25;
  totalElements = 0;

  filterSeverity = '';
  searchQuery = '';
  showFindingsTable = false;
  openSeverityGranularity: 'day' | 'hour' = 'day';

  readonly severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private defectDojoService: DefectDojoService,
    private environmentService: EnvironmentService
  ) {}

  ngOnInit(): void {
    this.route.parent?.paramMap.pipe(
      map(p => p.get('appId')),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(id => {
      this.appId = id;
      if (this.appId) {
        this.loadBranches();
        this.loadEnvironments();
      }
    });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(qp => {
      const branch = qp.get('branch') ?? '';
      const cat = (qp.get('category') ?? 'open') as DefectDojoMetricCategory;
      if (branch && branch !== this.selectedBranch) this.selectedBranch = branch;
      if (cat && cat !== this.selectedCategory) this.selectedCategory = cat;
      if (this.appId && this.selectedBranch) this.reload();
    });
  }

  ngOnDestroy(): void {
    this.destroyCharts();
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadBranches(): void {
    if (!this.appId) return;
    this.defectDojoService.getBranches(this.appId).subscribe({
      next: list => {
        this.branches = list?.length ? list : ['main'];
        if (!this.selectedBranch) {
          this.selectedBranch = this.branches[0];
          this.syncQueryParams();
        }
      },
      error: () => {
        this.branches = ['main'];
        if (!this.selectedBranch) {
          this.selectedBranch = 'main';
          this.syncQueryParams();
        }
      }
    });
  }

  loadEnvironments(): void {
    if (!this.appId) return;
    this.environmentService.getMyEnvironments(this.appId).subscribe({
      next: envs => (this.environments = envs || [])
    });
  }

  onBranchChange(): void {
    this.page = 0;
    this.syncQueryParams();
    this.reload();
  }

  selectCategory(card: DefectDojoMetricCard): void {
    this.selectedCategory = card.key;
    this.page = 0;
    this.showFindingsTable = true;
    this.syncQueryParams();
    this.loadFindings();
    setTimeout(() => document.getElementById('dd-findings-table')?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  isCategoryActive(key: DefectDojoMetricCategory): boolean {
    return this.selectedCategory === key;
  }

  metricMeta(key: DefectDojoMetricCategory) {
    return METRIC_META[key] ?? { icon: '•', tone: 'default' };
  }

  severityBarWidth(card: DefectDojoMetricCard, sev: string): number {
    const total = card.total || 0;
    if (!total) return 0;
    return ((card.bySeverity?.[sev] || 0) / total) * 100;
  }

  severityColor(sev: string): string {
    return SEV_COLORS[sev] ?? '#64748b';
  }

  setOpenSeverityGranularity(granularity: 'day' | 'hour'): void {
    if (this.openSeverityGranularity === granularity) return;
    this.openSeverityGranularity = granularity;
    this.renderOpenSeverityChart();
  }

  reload(): void {
    if (!this.appId || !this.selectedBranch) return;
    this.loading = true;
    this.error = null;
    this.destroyCharts();
    this.defectDojoService
      .getDashboard(this.appId, this.selectedBranch)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: d => {
          this.dashboard = d;
          if (d.engagementId) {
            if (this.showFindingsTable) this.loadFindings();
            setTimeout(() => this.renderCharts(), 80);
          }
        },
        error: err => {
          this.dashboard = null;
          this.error = err?.error?.message || 'Impossible de charger le dashboard sécurité.';
        }
      });
  }

  loadFindings(): void {
    if (!this.appId || !this.selectedBranch || !this.dashboard?.engagementId) return;
    this.listLoading = true;
    this.defectDojoService
      .getFindings(this.appId, this.selectedBranch, this.selectedCategory, this.page, this.size, this.filterSeverity || undefined)
      .pipe(finalize(() => (this.listLoading = false)))
      .subscribe({
        next: p => {
          this.findings = p.content ?? [];
          this.totalElements = p.totalElements ?? 0;
        },
        error: () => {
          this.findings = [];
          this.totalElements = 0;
        }
      });
  }

  onListFiltersChanged(): void {
    this.page = 0;
    this.loadFindings();
  }

  clearFilters(): void {
    this.filterSeverity = '';
    this.searchQuery = '';
    this.page = 0;
    this.loadFindings();
  }

  prevPage(): void {
    if (this.page <= 0) return;
    this.page--;
    this.loadFindings();
  }

  nextPage(): void {
    if ((this.page + 1) * this.size >= this.totalElements) return;
    this.page++;
    this.loadFindings();
  }

  openDetail(f: DefectDojoFindingItem): void {
    if (!this.appId || !f?.id) return;
    this.router.navigate(['/project', this.appId, 'security-dashboard', 'finding', f.id], {
      queryParams: { branch: this.selectedBranch, category: this.selectedCategory }
    });
  }

  get displayedFindings(): DefectDojoFindingItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.findings;
    return this.findings.filter(f => {
      const blob = [f.title, f.description, f.cve, f.cwe, f.filePath, f.componentName, f.scanType]
        .filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });
  }

  get selectedCategoryLabel(): string {
    return this.dashboard?.metricCards?.find(c => c.key === this.selectedCategory)?.label || this.selectedCategory;
  }

  get charts() {
    return this.dashboard?.charts;
  }

  get severityTotal(): number {
    return this.severities.reduce((sum, s) => sum + this.severityCount(s), 0);
  }

  get scanTestCount(): number {
    return this.charts?.scanSnapshots?.length ?? 0;
  }

  severityCount(sev: string): number {
    return this.charts?.bySeverity?.[sev] || 0;
  }

  envCountForBranch(branch: string): number {
    return this.environments.filter(e => e.gitBranch === branch).length;
  }

  mapEntries(m?: Record<string, number>): { key: string; value: number }[] {
    if (!m) return [];
    return Object.entries(m)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, value }));
  }

  private syncQueryParams(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        branch: this.selectedBranch,
        category: this.selectedCategory
      },
      queryParamsHandling: 'merge'
    });
  }

  private destroyCharts(): void {
    this.openSeverityChart?.destroy();
    this.openSeverityChart = undefined;
    this.trendChart?.destroy();
    this.trendChart = undefined;
    this.chartInstances.forEach(c => c.destroy());
    this.chartInstances = [];
  }

  private renderCharts(): void {
    this.destroyCharts();
    const c = this.dashboard?.charts;
    if (!c) return;

    this.renderOverviewCharts();
    this.renderDetailedCharts(c.detailedMetrics);
    this.renderSeverityChart(c);
    this.renderResolutionChart(c);
    this.renderToolsChart(c);
    this.renderAnalysisChart(c);
    this.renderStatusChart(c);
    this.renderScanChart(c);
  }

  private renderOverviewCharts(): void {
    const cards = this.dashboard?.metricCards ?? [];
    const canvases = this.overviewCharts?.toArray() ?? [];
    cards.forEach((card, index) => {
      const canvas = canvases[index]?.nativeElement;
      if (!canvas) return;
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: this.severities,
          datasets: [{
            data: this.severities.map(s => card.bySeverity?.[s] || 0),
            backgroundColor: this.severities.map(s => this.severityColor(s)),
            borderRadius: 3
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { font: { size: 8 }, color: THEME.slate }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 8 } }, grid: { color: 'rgba(15,23,42,0.06)' } }
          }
        }
      });
      this.chartInstances.push(chart);
    });
  }

  private renderDetailedCharts(dm?: DefectDojoDetailedMetrics): void {
    if (!dm) return;

    this.renderOpenSeverityChart();
    this.renderTrendChart();
    this.renderWeekStatusChart(dm);
    this.renderMultiSeverityLine(this.weekSeverityCanvas?.nativeElement, dm.weekToWeekBySeverity);
    this.renderSingleSeverityWeekLine(this.criticalWeekCanvas?.nativeElement, dm.weekToWeekBySeverity, 'Critical');
    this.renderSingleSeverityWeekLine(this.highWeekCanvas?.nativeElement, dm.weekToWeekBySeverity, 'High');
    this.renderSingleSeverityWeekLine(this.mediumWeekCanvas?.nativeElement, dm.weekToWeekBySeverity, 'Medium');
    this.renderFindingAgeChart(dm);
    this.renderWeeklyActivityChart(dm);
    this.renderCweChart(this.openCweCanvas?.nativeElement, dm.openCwe, 'CWE ouverts');
    this.renderCweChart(this.totalCweCanvas?.nativeElement, dm.totalCwe, 'CWE total');
  }

  private renderOpenSeverityChart(): void {
    const canvas = this.daySeverityCanvas?.nativeElement;
    const snapshots = this.charts?.scanSnapshots;
    if (!canvas || !snapshots?.length) return;

    this.openSeverityChart?.destroy();
    this.openSeverityChart = undefined;

    const sorted = [...snapshots].sort((a, b) =>
      (a.timestamp || a.date || '').localeCompare(b.timestamp || b.date || '')
    );

    const isHour = this.openSeverityGranularity === 'hour';
    const labels = sorted.map(s => {
      if (isHour && s.timestamp) {
        const hour = s.timestamp.length >= 13 ? s.timestamp.substring(0, 13) : s.timestamp;
        return `${s.scanType} · ${this.formatHourLabel(hour)}`;
      }
      return s.label || (s.date ? `${s.scanType} · ${this.formatDayLabel(s.date)}` : `${s.scanType} #${s.testId}`);
    });

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: this.severities.map(sev => ({
          label: sev,
          data: sorted.map(s => s.bySeverity?.[sev] || 0),
          borderColor: DD_SEV_LINE_COLORS[sev] ?? '#64748b',
          backgroundColor: DD_SEV_LINE_COLORS[sev] ?? '#64748b',
          tension: 0.1,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
          fill: false
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'start',
            labels: { boxWidth: 12, padding: 12, font: { size: 11 } }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: isHour ? 24 : 12,
              font: { size: 10 }
            }
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 10 } },
            grid: { color: 'rgba(15,23,42,0.08)' }
          }
        }
      }
    });
    this.openSeverityChart = chart;
  }

  private renderTrendChart(): void {
    const canvas = this.trendCanvas?.nativeElement;
    const snapshots = this.charts?.scanSnapshots;
    if (!canvas || !snapshots?.length) return;

    this.trendChart?.destroy();
    this.trendChart = undefined;

    const sorted = [...snapshots].sort((a, b) =>
      (a.timestamp || a.date || '').localeCompare(b.timestamp || b.date || '')
    );
    const labels = sorted.map(s =>
      s.label || s.date || `Scan #${s.testId}`
    );
    const openData = sorted.map(s => s.totalOpen);
    const newData = sorted.map((s, i) => {
      if (i === 0) return 0;
      const diff = s.totalOpen - sorted[i - 1].totalOpen;
      return Math.max(0, diff);
    });
    const resolvedData = sorted.map((s, i) => {
      if (i === 0) return 0;
      const diff = sorted[i - 1].totalOpen - s.totalOpen;
      return Math.max(0, diff);
    });

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ouvertes (stock)',
            data: openData,
            borderColor: THEME.orange,
            backgroundColor: 'rgba(243,108,33,0.1)',
            fill: true,
            tension: 0.1,
            pointRadius: 5,
            borderWidth: 2
          },
          {
            label: 'Nouvelles (période)',
            data: newData,
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220,38,38,0.1)',
            fill: true,
            tension: 0.1,
            borderDash: [5, 5],
            pointRadius: 4,
            borderWidth: 2
          },
          {
            label: 'Résolues (période)',
            data: resolvedData,
            borderColor: '#059669',
            backgroundColor: 'rgba(5,150,105,0.1)',
            fill: true,
            tension: 0.1,
            borderDash: [5, 5],
            pointRadius: 4,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
    this.trendChart = chart;
  }

  private renderMultiSeverityLine(
    canvas: HTMLCanvasElement | undefined,
    points: DefectDojoTimeSeriesPoint[] | undefined,
    formatLabel?: (period: string) => string
  ): void {
    if (!canvas || !points?.length) return;
    const labels = points.map(p => (formatLabel ? formatLabel(p.period) : p.period));
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: this.severities.map(sev => ({
          label: sev,
          data: points.map(p => p.bySeverity?.[sev] || 0),
          borderColor: this.severityColor(sev),
          backgroundColor: this.severityColor(sev),
          tension: 0.25,
          pointRadius: 4,
          borderWidth: 2
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderSingleSeverityWeekLine(
    canvas: HTMLCanvasElement | undefined,
    points: DefectDojoTimeSeriesPoint[] | undefined,
    severity: string
  ): void {
    if (!canvas || !points?.length) return;
    const color = this.severityColor(severity);
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map(p => p.period),
        datasets: [{
          label: severity,
          data: points.map(p => p.bySeverity?.[severity] || 0),
          borderColor: color,
          backgroundColor: color,
          tension: 0.25,
          pointRadius: 4,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderWeekStatusChart(dm: DefectDojoDetailedMetrics): void {
    if (!this.weekStatusCanvas?.nativeElement || !dm.weekToWeekStatus?.length) return;
    const points = dm.weekToWeekStatus;
    const chart = new Chart(this.weekStatusCanvas.nativeElement, {
      type: 'line',
      data: {
        labels: points.map(p => p.week),
        datasets: [
          { label: 'Ouvertes', data: points.map(p => p.opened), borderColor: THEME.orangeDark, tension: 0.25, pointRadius: 4 },
          { label: 'Fermées', data: points.map(p => p.closed), borderColor: THEME.orangeSoft, tension: 0.25, pointRadius: 4 },
          { label: 'Risk accepted', data: points.map(p => p.riskAccepted), borderColor: THEME.navyLight, tension: 0.25, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderFindingAgeChart(dm: DefectDojoDetailedMetrics): void {
    if (!this.findingAgeCanvas?.nativeElement || !dm.findingAgeBuckets) return;
    const entries = Object.entries(dm.findingAgeBuckets);
    if (!entries.some(([, v]) => v > 0)) return;
    const chart = new Chart(this.findingAgeCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: THEME.navyMid,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          title: { display: true, text: `Âge de ${dm.openFindingsForAge} finding(s) ouvert(s)`, font: { size: 11 } }
        },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderWeeklyActivityChart(dm: DefectDojoDetailedMetrics): void {
    if (!this.weeklyActivityCanvas?.nativeElement || !dm.weeklyActivity?.length) return;
    const weeks = [...new Set(dm.weeklyActivity.map(a => a.week))];
    const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const datasets = dayLabels.map((label, dow) => ({
      label,
      data: weeks.map(w => dm.weeklyActivity.find(a => a.week === w && a.dayOfWeek === dow)?.count || 0),
      backgroundColor: dow === 0 || dow === 6 ? THEME.slate : THEME.orange
    }));
    const chart = new Chart(this.weeklyActivityCanvas.nativeElement, {
      type: 'bar',
      data: { labels: weeks, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderCweChart(canvas: HTMLCanvasElement | undefined, data: Record<string, number> | undefined, title: string): void {
    if (!canvas || !data) return;
    const entries = this.mapEntries(data);
    if (!entries.length) return;
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.key),
        datasets: [{
          label: title,
          data: entries.map(e => e.value),
          backgroundColor: THEME.orangeSoft,
          borderColor: THEME.orangeDark,
          borderWidth: 1
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    this.chartInstances.push(chart);
  }

  private formatDayLabel(isoDay: string): string {
    const p = isoDay.split('-');
    return p.length === 3 ? `${p[0]}/${p[1]}/${p[2]}` : isoDay;
  }

  private formatHourLabel(isoHour: string): string {
    const [datePart, hourPart] = isoHour.split('T');
    if (!datePart || hourPart == null) return isoHour;
    const p = datePart.split('-');
    if (p.length !== 3) return isoHour;
    return `${p[0]}/${p[1]}/${p[2]} ${hourPart}:00`;
  }

  private renderSeverityChart(c: NonNullable<DefectDojoDashboardResponse['charts']>): void {
    if (!this.severityCanvas?.nativeElement) return;
    const entries = this.severities.map(s => ({ s, v: c.bySeverity?.[s] || 0 })).filter(x => x.v > 0);
    if (!entries.length) return;
    const chart = new Chart(this.severityCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: entries.map(e => e.s),
        datasets: [{ data: entries.map(e => e.v), backgroundColor: entries.map(e => this.severityColor(e.s)) }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
    this.chartInstances.push(chart);
  }

  private renderResolutionChart(c: NonNullable<DefectDojoDashboardResponse['charts']>): void {
    if (!this.resolutionCanvas?.nativeElement) return;
    const chart = new Chart(this.resolutionCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['Non résolues', 'Résolues'],
        datasets: [{
          data: [c.openCount, c.closedCount],
          backgroundColor: [THEME.orange, THEME.navyMid],
          borderColor: '#fff',
          borderWidth: 2
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
    this.chartInstances.push(chart);
  }

  private renderToolsChart(c: NonNullable<DefectDojoDashboardResponse['charts']>): void {
    if (!this.toolsCanvas?.nativeElement) return;
    const entries = this.mapEntries(c.byTool).slice(0, 8);
    if (!entries.length) return;
    const palette = [THEME.orange, THEME.orangeDark, THEME.orangeSoft, THEME.navyLight, THEME.navyMid, THEME.slate];
    const chart = new Chart(this.toolsCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.key),
        datasets: [{
          label: 'Findings',
          data: entries.map(e => e.value),
          backgroundColor: entries.map((_, i) => palette[i % palette.length])
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true } }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderAnalysisChart(c: NonNullable<DefectDojoDashboardResponse['charts']>): void {
    if (!this.analysisCanvas?.nativeElement) return;
    const entries = this.mapEntries(c.byAnalysisType);
    if (!entries.length) return;
    const chart = new Chart(this.analysisCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: entries.map(e => e.key),
        datasets: [{
          label: 'Findings',
          data: entries.map(e => e.value),
          backgroundColor: THEME.navyMid,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderStatusChart(c: NonNullable<DefectDojoDashboardResponse['charts']>): void {
    if (!this.statusCanvas?.nativeElement || !c.byStatus) return;
    const labels = ['Actives', 'Mitigées', 'Vérifiées', 'Faux positifs', 'Doublons'];
    const keys = ['active', 'mitigated', 'verified', 'falsePositive', 'duplicate'];
    const data = keys.map(k => c.byStatus[k] || 0);
    if (data.every(v => v === 0)) return;
    const chart = new Chart(this.statusCanvas.nativeElement, {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: [THEME.orange, THEME.green, THEME.navyLight, THEME.slate, THEME.orangeSoft]
        }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
    this.chartInstances.push(chart);
  }

  private renderScanChart(c: NonNullable<DefectDojoDashboardResponse['charts']>): void {
    if (!this.scanCanvas?.nativeElement || !c.scanSnapshots?.length) return;
    const snapshots = c.scanSnapshots;
    const chart = new Chart(this.scanCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: snapshots.map(s => s.label),
        datasets: this.severities.map(sev => ({
          label: sev,
          data: snapshots.map(s => s.bySeverity?.[sev] || 0),
          backgroundColor: this.severityColor(sev)
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
      }
    });
    this.chartInstances.push(chart);
  }
}
