import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, combineLatest, forkJoin, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, switchMap, takeUntil, timeout } from 'rxjs/operators';
import { ApplicationService, DeploymentMetrics } from '../../services/application/application.service';
import { EnvironmentService } from '../../services/environment/environment.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { FindingsService } from '../../services/findings/findings.service';
import { ApplicationResponse } from '../../models/application/application-response';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';
import {
  ActivityItem,
  DashboardEnvironmentItem,
  DashboardPipelineItem
} from '../../models/dashboard/dashboard.models';
import {
  DefectDojoDashboard2Response,
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

@Component({
  selector: 'app-dashboard2',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard2.component.html',
  styleUrls: ['./dashboard2.component.css', '../overview/project-overview.component.css']
})
export class Dashboard2Component implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly securityReload$ = new Subject<{ appId: string; branch: string }>();

  readonly globalBranch = GLOBAL_BRANCH;
  readonly severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];

  appId: string | null = null;
  selectedBranch = GLOBAL_BRANCH;
  branches: string[] = [];
  toolList: { key: string; value: number }[] = [];

  loading = false;
  error: string | null = null;
  infoMessage: string | null = null;
  dashboard: DefectDojoDashboard2Response | null = null;

  appName = '';
  appDetails: ApplicationResponse | null = null;
  latestDeployment: DeploymentHistoryItem | null = null;
  deployments: DeploymentHistoryItem[] = [];
  environmentsForApp: EnvironmentSummaryResponse[] = [];
  selectedEnvironmentId: string | null = null;
  recentActivities: ActivityItem[] = [];
  recentPipelines: DashboardPipelineItem[] = [];
  activeEnvironments: DashboardEnvironmentItem[] = [];
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
    private findingsService: FindingsService
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
        this.loading = true;
        this.error = null;
        this.infoMessage = null;
        return this.defectDojoService.getDashboard2(appId, branch).pipe(
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
      },
      error: err => {
        this.error = err.message || 'Impossible de charger le centre de sécurité';
        this.dashboard = null;
        this.toolList = [];
        this.loading = false;
      }
    });

    appId$.pipe(takeUntil(this.destroy$)).subscribe(id => {
      this.appId = id;
      if (!id) return;

      const qpEnv = this.route.snapshot.queryParamMap.get('env');
      const stored = localStorage.getItem(`selectedEnv:${id}`);
      this.selectedEnvironmentId = qpEnv || stored || null;
      this.loadOverview();
    });

    combineLatest([appId$, branch$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([id, branch]) => {
        if (!id) return;
        this.selectedBranch = branch;
        this.requestSecurityReload(id, branch);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get isGlobalView(): boolean {
    return this.selectedBranch === GLOBAL_BRANCH;
  }

  get scopeLabel(): string {
    return this.isGlobalView
      ? 'Toutes les branches (vue globale)'
      : `Branche : ${this.selectedBranch}`;
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

  severityBarColor(sev: string): string {
    return SEV_BAR[sev] ?? '#64748b';
  }

  gradeColor(grade?: string): string {
    return GRADE_COLORS[grade ?? ''] ?? '#64748b';
  }

  refreshAll(): void {
    if (this.appId) {
      this.loadOverview();
      this.requestSecurityReload(this.appId, this.isGlobalView ? GLOBAL_BRANCH : this.selectedBranch);
    }
  }

  onBranchChange(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { branch: this.selectedBranch },
      queryParamsHandling: 'merge'
    });
  }

  private requestSecurityReload(appId: string, branch: string): void {
    this.securityReload$.next({ appId, branch });
  }

  private buildToolList(d: DefectDojoDashboard2Response): { key: string; value: number }[] {
    const tools = d.byTool ?? {};
    return Object.entries(tools)
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
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
        const ids = new Set(this.environmentsForApp.map(e => e.id));
        if (!this.selectedEnvironmentId || !ids.has(this.selectedEnvironmentId)) {
          const running = this.environmentsForApp.find(e => (e.status || '').toUpperCase() === 'RUNNING');
          this.selectedEnvironmentId = running?.id || this.environmentsForApp[0]?.id || null;
          if (this.selectedEnvironmentId && this.appId) {
            localStorage.setItem(`selectedEnv:${this.appId}`, this.selectedEnvironmentId);
          }
        }

        this.activeEnvironments = this.environmentsForApp
          .filter(e => e.status === 'RUNNING')
          .map(e => ({
            id: e.id,
            name: e.environmentName,
            appName: this.appName,
            status: e.status,
            createdAt: e.createdAt,
            expiresAt: e.expiresAt,
            branch: e.gitBranch,
            timeRemaining: this.calculateTimeRemaining(e.expiresAt)
          }));

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

        if (this.selectedEnvironmentId) {
          const byEnv = this.deployments.filter(d => d.environmentId === this.selectedEnvironmentId);
          this.latestDeployment = byEnv.length > 0 ? byEnv[0] : (this.deployments[0] ?? null);
        } else {
          this.latestDeployment = this.deployments.length > 0 ? this.deployments[0] : null;
        }

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

  onEnvironmentSelected(envId: string): void {
    if (!envId || !this.appId) return;
    this.selectedEnvironmentId = envId;
    localStorage.setItem(`selectedEnv:${this.appId}`, envId);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { env: envId },
      queryParamsHandling: 'merge'
    });

    const byEnv = this.deployments.filter(d => d.environmentId === envId);
    this.latestDeployment = byEnv.length > 0 ? byEnv[0] : null;
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

  viewPipeline(envId: string): void {
    this.router.navigate(['/pipeline', envId], { queryParams: { appId: this.appId } });
  }

  viewEnvironment(envId: string): void {
    this.router.navigate(['/environment', envId], { queryParams: { appId: this.appId } });
  }

  viewAllPipelines(): void {
    this.router.navigate(['/project', this.appId, 'pipelines']);
  }

  viewAllEnvironments(): void {
    this.router.navigate(['/project', this.appId, 'deployments']);
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
