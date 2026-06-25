import { CommonModule } from '@angular/common';
import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import Chart from 'chart.js/auto';
import { Subject, combineLatest, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, delay, distinctUntilChanged, map, switchMap, takeUntil, timeout } from 'rxjs/operators';
import { ApplicationService, DeploymentMetrics } from '../../services/application/application.service';
import { EnvironmentService } from '../../services/environment/environment.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { FindingsService } from '../../services/findings/findings.service';
import { ApplicationResponse } from '../../models/application/application-response';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';
import {
  ActivityItem,
  DashboardPipelineItem
} from '../../models/dashboard/dashboard.models';
import {
  DefectDojoDashboard2Response,
  DefectDojoScanSnapshot,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';

export const GLOBAL_BRANCH = '__all__';

const SEV_BAR: Record<string, string> = {
  Critical: '#dc3545',
  High: '#fd7e14',
  Medium: '#ffc107',
  Low: '#28a745',
  Info: '#17a2b8',
  Total: '#343a40'
};

const GRADE_COLORS: Record<string, string> = {
  A: '#16a34a',
  B: '#22c55e',
  C: '#f59e0b',
  D: '#f97316',
  F: '#dc2626'
};

const SECURITY_REQUEST_TIMEOUT_MS = 90_000;

const DD_SEV_LINE_COLORS: Record<string, string> = {
  Critical: '#dc3545',
  High: '#fd7e14',
  Medium: '#ffc107',
  Low: '#28a745',
  Info: '#17a2b8'
};

const TOOL_HINTS: [string, string][] = [
  ['trivy', 'Analyse des dépendances, fichiers et images (SCA / container)'],
  ['semgrep', 'Analyse statique du code source (SAST)'],
  ['gitleaks', 'Détection de secrets et credentials dans le dépôt'],
  ['checkov', 'Analyse de sécurité Infrastructure-as-Code (IaC)'],
  ['hadolint', 'Bonnes pratiques et vulnérabilités dans les Dockerfiles'],
  ['zap', 'Tests de sécurité dynamiques sur l\'application (DAST)'],
  ['grype', 'Analyse des vulnérabilités des images conteneurs'],
  ['bandit', 'Analyse statique Python (SAST)'],
  ['dependency-check', 'Analyse des dépendances OWASP (SCA)']
];

@Component({
  selector: 'app-dashboard2',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard2.component.html',
  styleUrls: ['./dashboard2.component.css', '../overview/project-overview.component.css', '../security-dashboard/security-dashboard.component.css']
})
export class Dashboard2Component implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly securityReload$ = new Subject<{ appId: string; branch: string }>();
  private daySeverityChart?: Chart;
  private chartRenderTimer?: ReturnType<typeof setTimeout>;

  @ViewChild('daySeverityCanvas') daySeverityCanvas?: ElementRef<HTMLCanvasElement>;

  readonly globalBranch = GLOBAL_BRANCH;
  readonly severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];
  readonly quickNav = [
    { id: 'd2-environments', label: 'Environnements', icon: '🌍', action: 'scroll' as const },
    { id: 'd2-security', label: 'Sécurité', icon: '🛡️', action: 'scroll' as const },
    { id: 'deployments', label: 'Déploiements', icon: '📦', action: 'route' as const, route: 'deployments' },
    { id: 'pipelines', label: 'Pipelines', icon: '⚙️', action: 'route' as const, route: 'pipelines' },
    { id: 'security-dashboard', label: 'Dashboard sécurité', icon: '📊', action: 'route' as const, route: 'security-dashboard' },
    { id: 'd2-activity', label: 'Activité', icon: '📋', action: 'scroll' as const }
  ];

  appId: string | null = null;
  selectedBranch = GLOBAL_BRANCH;
  branches: string[] = [];
  toolList: { key: string; value: number }[] = [];
  hasOpenSeverityChart = false;
  openSeverityGranularity: 'day' | 'hour' = 'day';

  loading = false;
  error: string | null = null;
  infoMessage: string | null = null;
  dashboard: DefectDojoDashboard2Response | null = null;

  appName = '';
  appDetails: ApplicationResponse | null = null;
  latestDeployment: DeploymentHistoryItem | null = null;
  deployments: DeploymentHistoryItem[] = [];
  environmentsForApp: EnvironmentSummaryResponse[] = [];
  envVulnCounts: Record<string, number> = {};
  envCountsLoading = false;
  recentActivities: ActivityItem[] = [];
  recentPipelines: DashboardPipelineItem[] = [];
  totalDeployments = 0;
  successfulDeployments = 0;
  failedDeployments = 0;
  pendingDeployments = 0;
  skippedDeployments = 0;
  totalOpenVulnerabilities = 0;
  highCriticalVulnerabilityCount = 0;
  vulnerabilityStatsBySeverity: Record<string, number> = {};
  overviewLoading = true;
  overviewError: string | null = null;
  loadingSlow = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private defectDojoService: DefectDojoService,
    private applicationService: ApplicationService,
    private environmentService: EnvironmentService,
    private pipelineService: PipelineService,
    private findingsService: FindingsService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    const appId$ = this.route.parent!.paramMap.pipe(
      map(p => p.get('appId')),
      distinctUntilChanged()
    );
    const branch$ = this.route.queryParamMap.pipe(
      map(qp => qp.get('branch') ?? GLOBAL_BRANCH),
      distinctUntilChanged()
    );

    this.securityReload$.pipe(
      switchMap(({ appId, branch }) => {
        const apiBranch = this.toApiBranch(branch);
        this.loading = true;
        this.destroyOpenSeverityChart();
        this.error = null;
        this.infoMessage = null;
        this.hasOpenSeverityChart = false;

        return this.defectDojoService.getDashboard2(appId, apiBranch).pipe(
          timeout(SECURITY_REQUEST_TIMEOUT_MS),
          catchError(err => {
            const msg = err?.name === 'TimeoutError'
              ? 'Le chargement DefectDojo a dépassé 90 s — vérifiez la connexion ngrok.'
              : (err.error?.message || 'Impossible de charger le centre de sécurité');
            throw { message: msg };
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: d => {
        this.dashboard = d;
        if (d.message) {
          this.infoMessage = d.message;
        }
        if (d.branches?.length) {
          this.branches = d.branches;
        }
        this.toolList = this.buildToolList(d);
        this.loading = false;
        const showChart = (d.charts?.scanSnapshots?.length ?? 0) > 0;
        this.hasOpenSeverityChart = showChart;
        // Différer le rendu Chart.js pour éviter NG0100 / boucle de change detection
        setTimeout(() => {
          if (showChart) {
            this.scheduleOpenSeverityChartRender();
          } else {
            this.destroyOpenSeverityChart();
          }
        }, 0);
      },
      error: err => {
        this.error = err.message || 'Impossible de charger le centre de sécurité';
        this.dashboard = null;
        this.toolList = [];
        this.hasOpenSeverityChart = false;
        this.loading = false;
        this.destroyOpenSeverityChart();
      }
    });

    appId$.pipe(takeUntil(this.destroy$)).subscribe(id => {
      this.appId = id;
      if (!id) return;
      this.loadOverview();
    });

    combineLatest([appId$, branch$])
      .pipe(
        debounceTime(400),
        distinctUntilChanged((a, b) => a[0] === b[0] && a[1] === b[1]),
        delay(800),
        takeUntil(this.destroy$)
      )
      .subscribe(([id, branch]) => {
        if (!id) return;
        this.selectedBranch = branch;
        this.requestSecurityReload(id, branch);
      });
  }

  ngOnDestroy(): void {
    this.destroyOpenSeverityChart();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get hasToolCounts(): boolean {
    return this.toolList.some(t => (t.value ?? 0) > 0);
  }

  get isGlobalView(): boolean {
    return this.selectedBranch === GLOBAL_BRANCH;
  }

  get scopeLabel(): string {
    return this.isGlobalView
      ? 'Toutes les branches (vue globale)'
      : `Branche : ${this.selectedBranch}`;
  }

  get activeEnvironmentCards(): Array<{
    id: string;
    name: string;
    branch: string;
    timeRemaining: string;
    vulnCount: number | null;
  }> {
    return (this.environmentsForApp || [])
      .filter(e => (e.status || '').toUpperCase() === 'RUNNING')
      .slice(0, 4)
      .map(e => ({
        id: e.id,
        name: e.environmentName || 'Environnement',
        branch: e.gitBranch || '—',
        timeRemaining: this.calculateTimeRemaining(e.expiresAt),
        vulnCount: this.envCountsLoading ? null : (this.envVulnCounts[e.id] ?? 0)
      }));
  }

  get toolListMax(): number {
    if (!this.toolList.length) return 1;
    return Math.max(...this.toolList.map(t => t.value), 1);
  }

  get totalFindings(): number {
    const s = this.dashboard?.bySeverity;
    if (!s) return 0;
    return this.severities.reduce((sum, sev) => sum + (s[sev] || 0), 0);
  }

  get stats(): Array<{
    label: string;
    value: number | string;
    icon: string;
    color: string;
    iconBg: string;
    trend?: string;
  }> {
    const depPending = this.loadingSlow;
    return [
      {
        label: 'Déploiements',
        value: depPending ? '…' : this.totalDeployments,
        icon: '📦',
        color: '#3b82f6',
        iconBg: 'rgba(59, 130, 246, 0.2)'
      },
      {
        label: 'Réussis',
        value: depPending ? '…' : this.successfulDeployments,
        icon: '✅',
        color: '#22c55e',
        iconBg: 'rgba(34, 197, 94, 0.2)',
        trend: depPending
          ? '…'
          : (this.totalDeployments ? `${Math.round(this.successfulDeployments / this.totalDeployments * 100)}%` : '0%')
      },
      {
        label: 'En attente',
        value: depPending ? '…' : this.pendingDeployments,
        icon: '⏳',
        color: '#f97316',
        iconBg: 'rgba(249, 115, 22, 0.2)'
      },
      {
        label: 'Échoués',
        value: depPending ? '…' : this.failedDeployments,
        icon: '❌',
        color: '#ef4444',
        iconBg: 'rgba(239, 68, 68, 0.2)'
      },
      {
        label: 'Vulnérabilités (ouvertes)',
        value: this.totalOpenVulnerabilities,
        icon: '🛡️',
        color: '#8b5cf6',
        iconBg: 'rgba(139, 92, 246, 0.2)',
        trend:
          this.highCriticalVulnerabilityCount > 0
            ? `Crit./Élevées: ${this.highCriticalVulnerabilityCount}`
            : undefined
      }
    ];
  }

  severityCount(sev: string): number {
    return this.dashboard?.bySeverity?.[sev] || 0;
  }

  severityCssClass(sev: string): string {
    const map: Record<string, string> = {
      Critical: 'sev-critical',
      High: 'sev-high',
      Medium: 'sev-medium',
      Low: 'sev-low',
      Info: 'sev-info'
    };
    return map[sev] ?? 'sev-info';
  }

  severityBarColor(sev: string): string {
    return SEV_BAR[sev] ?? '#64748b';
  }

  formatToolName(key: string): string {
    if (!key || key === 'Unknown') return 'Autre';
    const normalized = key.replace(/\s*\(generic findings import\)\s*/gi, '').trim();
    const lower = normalized.toLowerCase();
    const aliases: [string, string][] = [
      ['anchore grype', 'Anchore Grype'],
      ['grype', 'Anchore Grype'],
      ['checkov', 'Checkov Scan'],
      ['gitleaks', 'Gitleaks Scan'],
      ['hadolint', 'Hadolint Dockerfile check'],
      ['semgrep', 'Semgrep JSON Report'],
      ['trivy', 'Trivy Scan'],
      ['zap', 'ZAP Scan'],
      ['dependency-check', 'OWASP Dependency-Check'],
      ['npm audit', 'NPM Audit'],
      ['bandit', 'Bandit Scan']
    ];
    for (const [needle, label] of aliases) {
      if (lower.includes(needle)) return label;
    }
    if (/^\d+$/.test(key)) return `Scanner #${key}`;
    return normalized;
  }

  toolBarWidth(value: number): number {
    return Math.round((value / this.toolListMax) * 100);
  }

  toolDescription(key: string): string {
    const lower = (key || '').toLowerCase();
    for (const [needle, hint] of TOOL_HINTS) {
      if (lower.includes(needle)) return hint;
    }
    return 'Scanner de sécurité alimenté par le pipeline CI/CD via DefectDojo.';
  }

  selectBranch(branch: string): void {
    if (this.selectedBranch === branch || this.loading) return;
    this.destroyOpenSeverityChart();
    this.selectedBranch = branch;
    this.onBranchChange();
  }

  setOpenSeverityGranularity(granularity: 'day' | 'hour'): void {
    if (this.openSeverityGranularity === granularity) return;
    this.openSeverityGranularity = granularity;
    this.ngZone.runOutsideAngular(() => this.renderOpenSeverityChart());
  }

  private getScanSnapshots(): DefectDojoScanSnapshot[] {
    return this.dashboard?.charts?.scanSnapshots ?? [];
  }

  private scheduleOpenSeverityChartRender(): void {
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
    }
    this.chartRenderTimer = setTimeout(() => {
      this.ngZone.runOutsideAngular(() => this.renderOpenSeverityChart());
    }, 120);
  }

  private destroyOpenSeverityChart(): void {
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
      this.chartRenderTimer = undefined;
    }
    this.ngZone.runOutsideAngular(() => {
      if (this.daySeverityChart) {
        this.daySeverityChart.destroy();
        this.daySeverityChart = undefined;
      }
      const canvas = this.daySeverityCanvas?.nativeElement;
      if (canvas) {
        const orphan = Chart.getChart(canvas);
        if (orphan) {
          orphan.destroy();
        }
      }
    });
  }

  private renderOpenSeverityChart(): void {
    const canvas = this.daySeverityCanvas?.nativeElement;
    const snapshots = this.getScanSnapshots();
    if (!canvas || !snapshots?.length || this.loading) {
      return;
    }

    const wrap = canvas.parentElement;
    if (!wrap || wrap.clientWidth === 0) {
      return;
    }

    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
      existingChart.destroy();
    }
    if (this.daySeverityChart) {
      this.daySeverityChart.destroy();
      this.daySeverityChart = undefined;
    }

    canvas.width = wrap.clientWidth;
    canvas.height = 280;

    const sorted = [...snapshots].sort((a, b) =>
      (a.timestamp || a.date || '').localeCompare(b.timestamp || b.date || '')
    );

    const isHour = this.openSeverityGranularity === 'hour';
    const labels = sorted.map(s => {
      if (isHour && s.timestamp) {
        const hour = s.timestamp.length >= 13 ? s.timestamp.substring(0, 13) : s.timestamp;
        return `${s.scanType} · ${this.formatHourLabel(hour)}`;
      }
      return s.label || (s.date
        ? `${s.scanType} · ${this.formatDayLabel(s.date)}`
        : `${s.scanType} #${s.testId}`);
    });

    this.daySeverityChart = new Chart(canvas, {
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
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
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

  scrollTo(sectionId: string): void {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  onQuickNav(item: typeof this.quickNav[number]): void {
    if (item.action === 'scroll') {
      this.scrollTo(item.id);
      return;
    }
    if (!this.appId) return;
    if (item.route === 'security-dashboard') {
      this.viewSecurityDashboard();
      return;
    }
    this.router.navigate(['/project', this.appId, item.route!]);
  }

  viewSecurityDashboard(): void {
    if (!this.appId) return;
    const queryParams = this.isGlobalView ? {} : { branch: this.selectedBranch };
    this.router.navigate(['/project', this.appId, 'security-dashboard'], { queryParams });
  }

  gradeColor(grade?: string): string {
    return GRADE_COLORS[grade ?? ''] ?? '#64748b';
  }

  refreshAll(): void {
    if (this.appId) {
      this.loadOverview();
      this.loadEnvironmentVulnCounts();
      this.requestSecurityReload(this.appId, this.isGlobalView ? GLOBAL_BRANCH : this.selectedBranch);
    }
  }

  onBranchChange(): void {
    const queryParams = this.isGlobalView
      ? { branch: null }
      : { branch: this.selectedBranch };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge'
    });
  }

  private toApiBranch(branch: string): string | undefined {
    return branch === GLOBAL_BRANCH ? undefined : branch;
  }

  private requestSecurityReload(appId: string, branch: string): void {
    this.securityReload$.next({ appId, branch });
  }

  private buildToolList(d: DefectDojoDashboard2Response): { key: string; value: number }[] {
    const tools = d.byTool ?? {};
    const entries = Object.entries(tools)
      .map(([key, value]) => ({ key, value: value ?? 0 }))
      .filter(t => t.key && t.key !== 'Unknown')
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));

    const seen = new Set<string>();
    return entries.filter(t => {
      const label = this.formatToolName(t.key);
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    }).slice(0, 12);
  }

  loadOverview(): void {
    if (!this.appId) return;

    this.overviewLoading = true;
    this.overviewError = null;
    this.applicationService.clearDeploymentsCache(this.appId);

    forkJoin({
      appInfo: this.applicationService.getApplicationById(this.appId).pipe(catchError(() => of(null))),
      environments: this.environmentService.getMyEnvironments(this.appId).pipe(catchError(() => of([]))),
      findingStats: this.findingsService.getStatsByApplication(this.appId, 'OPEN').pipe(catchError(() => of(null)))
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: quickData => {
        if (quickData.appInfo) {
          this.appDetails = quickData.appInfo;
          this.appName = quickData.appInfo.name;
        }

        this.environmentsForApp = quickData.environments || [];

        const fs = quickData.findingStats;
        this.vulnerabilityStatsBySeverity = fs?.bySeverity ? { ...fs.bySeverity } : {};
        this.totalOpenVulnerabilities =
          fs?.openDistinctTotal ??
          Object.values(this.vulnerabilityStatsBySeverity).reduce((s, n) => s + (n || 0), 0);
        this.highCriticalVulnerabilityCount =
          (this.vulnerabilityStatsBySeverity['CRITICAL'] ?? 0) +
          (this.vulnerabilityStatsBySeverity['HIGH'] ?? 0);

        this.overviewLoading = false;
        this.loadDeploymentsAndPipelines();
        setTimeout(() => this.loadEnvironmentVulnCounts(), 2500);
      },
      error: () => {
        this.overviewLoading = false;
        this.overviewError = 'Erreur lors du chargement du projet';
        this.loadDeploymentsAndPipelines();
      }
    });
  }

  private loadDeploymentsAndPipelines(): void {
    if (!this.appId) return;

    this.loadingSlow = true;

    forkJoin({
      deployments: this.applicationService.getDeploymentHistory(this.appId, 0, 10).pipe(catchError(() => of([]))),
      deploymentMetrics: this.applicationService.getDeploymentMetrics(this.appId).pipe(catchError(() => of(null))),
      pipelines: this.pipelineService.listPipelines(0, 10).pipe(catchError(() => of([])))
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: slowData => {
        this.deployments = slowData.deployments || [];
        this.latestDeployment = this.deployments.length > 0 ? this.deployments[0] : null;

        const envIdsForApp = new Set<string>();
        this.environmentsForApp.forEach(e => envIdsForApp.add(String(e.id)));
        this.deployments.forEach(d => {
          if (d?.environmentId) envIdsForApp.add(String(d.environmentId));
        });

        const rawPipelines = (slowData.pipelines || []).filter((p: { environmentId?: string }) =>
          p?.environmentId && envIdsForApp.has(String(p.environmentId))
        );

        this.recentPipelines = rawPipelines
          .sort((a: { createdAt?: unknown }, b: { createdAt?: unknown }) => {
            const dateA = this.safeParseDate(a.createdAt)?.getTime() || 0;
            const dateB = this.safeParseDate(b.createdAt)?.getTime() || 0;
            return dateB - dateA;
          })
          .slice(0, 5)
          .map((p: {
            pipelineId?: string | number;
            gitBranch?: string;
            ref?: string;
            status?: string;
            pipelineStatus?: string;
            createdAt?: unknown;
            startedAt?: unknown;
            finishedAt?: unknown;
            environmentId?: string;
            environmentName?: string;
            createdByUsername?: string;
          }) => ({
            id: p.pipelineId,
            name: `Pipeline #${p.pipelineId}`,
            branch: p.gitBranch || p.ref || 'main',
            status: p.status || p.pipelineStatus || 'UNKNOWN',
            createdAt: this.safeParseDate(p.createdAt)?.toISOString() ||
              this.safeParseDate(p.startedAt)?.toISOString() ||
              this.safeParseDate(p.finishedAt)?.toISOString() ||
              new Date().toISOString(),
            environmentId: p.environmentId!,
            environmentName: p.environmentName,
            triggeredBy: p.createdByUsername
          }));

        const m: DeploymentMetrics | null = slowData.deploymentMetrics;
        if (m != null && typeof m.total === 'number') {
          this.totalDeployments = m.total;
          this.successfulDeployments = m.success ?? 0;
          this.failedDeployments = (m.failed ?? 0) + (m.canceled ?? 0);
          this.pendingDeployments = (m.pending ?? 0) + (m.running ?? 0);
          this.skippedDeployments = m.skipped ?? 0;
        } else {
          this.totalDeployments = this.deployments.length;
          this.successfulDeployments = this.deployments.filter(d =>
            d.pipelineStatus?.toUpperCase() === 'SUCCESS'
          ).length;
          this.failedDeployments = this.deployments.filter(d =>
            ['FAILED', 'CANCELED'].includes(d.pipelineStatus?.toUpperCase() || '')
          ).length;
          this.pendingDeployments = this.deployments.filter(d =>
            ['PENDING', 'RUNNING'].includes(d.pipelineStatus?.toUpperCase() || '')
          ).length;
          this.skippedDeployments = this.deployments.filter(d =>
            d.pipelineStatus?.toUpperCase() === 'SKIPPED'
          ).length;
        }

        this.buildRecentActivities();
        this.loadingSlow = false;
      },
      error: () => {
        this.loadingSlow = false;
      }
    });
  }

  loadEnvironmentVulnCounts(): void {
    if (!this.appId) return;
    this.envCountsLoading = true;
    this.defectDojoService.getEnvironmentOpenCounts(this.appId).pipe(
      catchError(() => of({})),
      takeUntil(this.destroy$)
    ).subscribe({
      next: counts => {
        this.envVulnCounts = counts || {};
        this.envCountsLoading = false;
      },
      error: () => {
        this.envVulnCounts = {};
        this.envCountsLoading = false;
      }
    });
  }

  viewDetailedAnalysis(): void {
    this.viewSecurityDashboard();
  }

  viewEnvSecurityAnalysis(env: { id: string; branch: string }): void {
    if (!this.appId) return;
    this.router.navigate(['/project', this.appId, 'security-dashboard'], {
      queryParams: { branch: env.branch, envId: env.id }
    });
  }

  viewPipeline(envId: string): void {
    this.router.navigate(['/pipeline', envId], { queryParams: { appId: this.appId } });
  }

  viewEnvironment(envId: string): void {
    this.router.navigate(['/environment', envId], { queryParams: { appId: this.appId } });
  }

  private buildRecentActivities(): void {
    const activities: ActivityItem[] = [];

    this.deployments.slice(0, 3).forEach(d => {
      activities.push({
        id: d.environmentId,
        type: 'deployment',
        title: 'Nouveau déploiement',
        description: `Environnement ${d.environmentName} créé`,
        timestamp: d.createdAt,
        status: d.pipelineStatus || 'UNKNOWN',
        icon: this.getStatusIcon(d.pipelineStatus),
        link: `/pipeline/${d.environmentId}?appId=${this.appId}`
      });
    });

    this.recentPipelines.slice(0, 3).forEach(p => {
      activities.push({
        id: String(p.id || ''),
        type: 'pipeline',
        title: 'Pipeline exécuté',
        description: `Pipeline #${p.id} pour ${p.environmentName}`,
        timestamp: p.createdAt || new Date().toISOString(),
        status: p.status,
        icon: '⚙️',
        link: `/pipeline/${p.environmentId}?appId=${this.appId}`
      });
    });

    const envByDate = [...this.environmentsForApp].sort((a, b) => {
      const ta = this.safeParseDate(a.createdAt)?.getTime() || 0;
      const tb = this.safeParseDate(b.createdAt)?.getTime() || 0;
      return tb - ta;
    });

    envByDate.slice(0, 4).forEach(e => {
      const { title, description } = this.environmentActivityCopy(e);
      const st = (e.status || '').toUpperCase();
      const preview = st === 'RUNNING' && (e.previewUrl || '').trim() ? (e.previewUrl as string).trim() : undefined;
      activities.push({
        id: e.id,
        type: 'environment',
        title,
        description,
        timestamp: e.createdAt,
        status: e.status,
        icon: this.getEnvironmentActivityIcon(e.status),
        link: `/pipeline/${e.id}?appId=${this.appId ?? ''}`,
        previewUrl: preview
      });
    });

    this.recentActivities = activities
      .sort((a, b) => {
        const dateA = this.safeParseDate(a.timestamp)?.getTime() || 0;
        const dateB = this.safeParseDate(b.timestamp)?.getTime() || 0;
        return dateB - dateA;
      })
      .slice(0, 5);
  }

  getRepoDisplayName(url: string | undefined): string {
    if (!url) return '—';
    try {
      const path = url.replace(/^https?:\/\//, '').replace(/\.git$/, '').trim();
      const parts = path.split('/').filter(Boolean);
      return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : path;
    } catch {
      return url;
    }
  }

  getAppCreatedAt(): string {
    if (!this.appDetails?.createdAt) return 'Date non disponible';
    return this.formatFullDate(this.appDetails.createdAt);
  }

  formatFullDate(dateValue: unknown): string {
    const date = this.safeParseDate(dateValue);
    if (!date) return 'Date non disponible';
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatTimeAgo(iso: unknown): string {
    const date = this.safeParseDate(iso);
    if (!date) return '—';
    const now = new Date();
    const sec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (sec < 30) return 'à l\'instant';
    if (sec < 60) return `il y a ${sec} secondes`;
    if (sec < 3600) {
      const min = Math.floor(sec / 60);
      return `il y a ${min} minute${min > 1 ? 's' : ''}`;
    }
    if (sec < 86400) {
      const h = Math.floor(sec / 3600);
      return `il y a ${h} heure${h > 1 ? 's' : ''}`;
    }
    if (sec < 604800) {
      const d = Math.floor(sec / 86400);
      return `il y a ${d} jour${d > 1 ? 's' : ''}`;
    }
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  getActivityTimeAgo(activity: ActivityItem): string {
    return this.formatTimeAgo(activity.timestamp);
  }

  getPipelineTimeAgo(pipeline: DashboardPipelineItem): string {
    return this.formatTimeAgo(pipeline.createdAt);
  }

  activityKindLabel(type: ActivityItem['type']): string {
    switch (type) {
      case 'deployment': return 'Déploiement';
      case 'pipeline': return 'Pipeline';
      case 'environment': return 'Environnement';
      default: return '';
    }
  }

  statusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status-success';
    if (s === 'FAILED' || s === 'CANCELED') return 'status-danger';
    if (s === 'RUNNING' || s === 'PENDING' || s === 'BUILDING') return 'status-warning';
    if (s === 'DESTROYED' || s === 'EXPIRED') return 'status-muted';
    return 'status-muted';
  }

  calculateTimeRemaining(expiresAt: unknown): string {
    const expiryMs = this.parseBackendInstantMs(expiresAt);
    if (expiryMs == null) return '—';
    const nowMs = Date.now();
    if (expiryMs <= nowMs) return 'Expiré';
    const diffMs = expiryMs - nowMs;
    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return diffHrs > 0 ? `${diffHrs}h ${diffMins}m` : `${diffMins} min`;
  }

  viewAllPipelines(): void {
    if (!this.appId) return;
    this.router.navigate(['/project', this.appId, 'pipelines']);
  }

  viewAllEnvironments(): void {
    if (!this.appId) return;
    this.router.navigate(['/project', this.appId, 'deployments']);
  }

  navigateActivity(activity: ActivityItem): void {
    if (activity.link) {
      this.router.navigateByUrl(activity.link);
      return;
    }
    if (activity.type === 'environment' && activity.id) {
      this.viewEnvironment(String(activity.id));
    } else if (activity.type === 'pipeline' && activity.id) {
      const envId = this.recentPipelines.find(p => String(p.id) === String(activity.id))?.environmentId;
      if (envId) this.viewPipeline(envId);
    }
  }

  createNewEnvironment(): void {
    this.router.navigate(['/environment-create'], { queryParams: { appId: this.appId } });
  }

  private safeParseDate(dateValue: unknown): Date | null {
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

  private parseBackendInstantMs(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const t = new Date(value).getTime();
      return Number.isNaN(t) ? null : t;
    }
    if (Array.isArray(value) && value.length >= 3) {
      const [y, mo, d, h = 0, mi = 0, s = 0] = value as number[];
      const t = new Date(y, mo - 1, d, h, mi, s).getTime();
      return Number.isNaN(t) ? null : t;
    }
    return null;
  }

  private getStatusIcon(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return '✅';
    if (s === 'FAILED') return '❌';
    if (s === 'CANCELED') return '⛔';
    if (s === 'RUNNING') return '🔄';
    if (s === 'PENDING') return '⏳';
    return '•';
  }

  private environmentActivityCopy(env: EnvironmentSummaryResponse): { title: string; description: string } {
    const name = env.environmentName || 'Environnement';
    const branch = env.gitBranch || '—';
    const st = (env.status || '').toUpperCase();
    switch (st) {
      case 'RUNNING': return { title: 'Environnement actif', description: `${name} — branche ${branch}` };
      case 'PENDING': return { title: 'Environnement en attente', description: `${name} — branche ${branch}` };
      case 'BUILDING': return { title: 'Environnement en construction', description: `${name} — branche ${branch}` };
      case 'FAILED': return { title: 'Environnement en échec', description: `${name} — branche ${branch}` };
      case 'DESTROYED': return { title: 'Environnement détruit', description: `${name} — branche ${branch}` };
      case 'EXPIRED': return { title: 'Environnement expiré', description: `${name} — branche ${branch}` };
      default: return { title: 'Environnement', description: `${name} — branche ${branch} (${st || '?'})` };
    }
  }

  private getEnvironmentActivityIcon(status: string | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'RUNNING') return '🌍';
    if (s === 'BUILDING') return '🔧';
    if (s === 'PENDING') return '⏳';
    if (s === 'FAILED') return '⚠️';
    if (s === 'DESTROYED' || s === 'EXPIRED') return '🗑️';
    return '🌍';
  }
}
