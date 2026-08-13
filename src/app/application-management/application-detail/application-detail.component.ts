import { Component, ElementRef, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, interval, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, switchMap, takeUntil, takeWhile } from 'rxjs/operators';
import Chart from 'chart.js/auto';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { ApplicationService } from '../../services/application/application.service';
import {
  AppDatabaseModel,
  AppDeployment,
  AppServiceModel,
  DeployPreview,
  DeploymentAlertsResponse,
  DeploymentMonitorAlert,
  ManagedApp,
  ServiceCardStats,
  SecurityPostureResponse,
  TopBlockingFinding,
  ScanBatchState,
  ScanBatchServiceState,
  ServicePostureSummary,
  QualityGateItem
} from '../../models/application-management/application-management.models';
import { ServiceFormComponent } from '../service-form/service-form.component';
import { DatabaseFormComponent } from '../database-form/database-form.component';
import { DeploymentStatusComponent } from '../deployment-status/deployment-status.component';
import { MonitoringDashboardComponent } from '../monitoring-dashboard/monitoring-dashboard.component';
import { DeployRunModalComponent, DeployRunParams } from '../deploy-run-modal/deploy-run-modal.component';
import {
  ProjectDeployModalComponent,
  ProjectDeployParams
} from '../project-deploy-modal/project-deploy-modal.component';
import { AppScanModalComponent, AppScanParams } from '../app-scan-modal/app-scan-modal.component';
import { ManagedAppStateService } from '../managed-app-state.service';
import { ManagedSecurityDashboardComponent } from '../managed-security-dashboard/managed-security-dashboard.component';
import { ManagedAppHistoryComponent } from '../managed-app-history/managed-app-history.component';
import { isHardBlocked, verdictLabelFr, verdictTone } from '../shared/verdict.util';
import { PipelineJobInfo, PipelineScanResponse } from '../../models/pipeline/pipeline-scan-response';
import { PipelineListItem } from '../../models/pipeline/pipeline-list-item';
import { AuthService } from '../../services/auth/auth.service';

type AppSection = 'dashboard' | 'services' | 'databases' | 'monitoring' | 'history' | 'alerts' | 'deployments' | 'pipelines' | 'security' | 'defectdojo' | 'quality-gate';
type DeployStatusFilter = 'ALL' | 'RUNNING' | 'DEPLOYING' | 'FAILED' | 'STOPPED';
type PipelineKindFilter = 'ALL' | 'SCAN' | 'DEPLOY';
type PipelineStatusFilter = 'ALL' | 'SUCCESS' | 'FAILED' | 'RUNNING';

interface AlertNameAgg {
  name: string;
  total: number;
  live: number;
  history: number;
  errors: number;
  warnings: number;
  category: 'k8s' | 'health' | 'pod';
  severity: 'error' | 'warn';
  samples: DeploymentMonitorAlert[];
}

@Component({
  selector: 'app-managed-application-detail',
  standalone: true,
  imports: [
    CommonModule,
    ServiceFormComponent,
    DatabaseFormComponent,
    DeploymentStatusComponent,
    MonitoringDashboardComponent,
    DeployRunModalComponent,
    ProjectDeployModalComponent,
    AppScanModalComponent,
    ManagedSecurityDashboardComponent,
    ManagedAppHistoryComponent
  ],
  templateUrl: './application-detail.component.html',
  styleUrls: ['../shared/app-management.shared.css', './application-detail.component.css']
})
export class ApplicationDetailComponent implements OnInit, OnDestroy {
  appId!: string;
  app: ManagedApp | null = null;
  loading = true;
  error: string | null = null;
  /** Section du dashboard app (sidebar). */
  activeTab: AppSection = 'dashboard';

  showServiceForm = false;
  editingService: AppServiceModel | null = null;
  showDatabaseForm = false;
  editingDatabase: AppDatabaseModel | null = null;

  saving = false;
  formError: string | null = null;
  deploying = false;
  deployError: string | null = null;
  syncMessage: string | null = null;
  syncingServiceId: string | null = null;
  customHostnameDraft = '';
  savingHostname = false;
  hostnameMessage: string | null = null;
  hostnameError: string | null = null;

  /** Modale scan (branche, pas de TTL). */
  showScanModal = false;
  scanningService: AppServiceModel | null = null;
  scanRunning = false;
  scanError: string | null = null;

  /** Modale déploiement projet. */
  showDeployModal = false;
  deployPreview: DeployPreview | null = null;
  deployPreviewLoading = false;
  private previewTrigger$ = new Subject<{
    branch: string;
    sessionDurationHours: number;
    serviceIds: string[];
  }>();

  /** Stats cartes service (best-effort). */
  serviceStats: Record<string, ServiceCardStats> = {};

  /** Historique / déploiements (onglet). */
  history: AppDeployment[] = [];
  historyLoading = false;
  historyError: string | null = null;
  selectedHistoryId: string | null = null;
  deployStatusFilter: DeployStatusFilter = 'ALL';
  deployBranchFilter = '';
  /** Sections pliables — page Runtime & environnements unifiée. */
  runtimeSectionOpen = true;
  historySectionOpen = true;
  /** Détails techniques (section séparée). */
  opsSectionOpen = true;
  /** @deprecated remplacé par opsSectionOpen */
  activeOpsOpen = false;

  /** Courbe succès / échec historique environnements. */
  @ViewChild('envHistoryChart') set envHistoryChartEl(el: ElementRef<HTMLCanvasElement> | undefined) {
    this.envHistoryCanvas = el?.nativeElement || null;
    if (this.envHistoryCanvas && this.history.length) {
      this.scheduleEnvHistoryChart();
    }
  }
  private envHistoryCanvas: HTMLCanvasElement | null = null;
  private envHistoryChart?: Chart;
  private envHistoryChartTimer?: ReturnType<typeof setTimeout>;
  hasEnvHistoryChart = false;

  /** Lots de scan — polling batch actif (dashboard), pas la timeline Historique. */

  /** Pipelines agrégés (tous services). */
  appPipelines: PipelineListItem[] = [];
  appPipelinesLoading = false;
  appPipelinesError: string | null = null;
  pipelineKindFilter: PipelineKindFilter = 'ALL';
  pipelineStatusFilter: PipelineStatusFilter = 'ALL';
  pipelineServiceFilter = 'ALL';
  /** Filtre drill-down depuis Historique (?pipelineId=). */
  pipelineIdFilter: number | null = null;
  pipelineCancelingId: number | null = null;
  /** Carte pipeline dépliée (détails jobs inline) — clé pipelineId|applicationId */
  expandedPipelineKey: string | null = null;

  /** Alertes runtime (onglet). */
  alertsData: DeploymentAlertsResponse | null = null;
  alertsLoading = false;
  alertsError: string | null = null;
  alertsLastRefresh: Date | null = null;
  /** Filtre principal : all | error | warn | k8s | health | pod | reason:<name> */
  alertsFilter: string = 'all';
  alertsSearch = '';
  alertsScope: 'live' | 'history' | 'all' = 'all';
  /** Vue liste plate ou regroupée par nom d'erreur/warning. */
  alertsViewMode: 'grouped' | 'list' = 'grouped';
  private alertsPollSub?: Subscription;
  private static readonly ALERTS_POLL_MS = 10000;

  /** Posture sécurité app (Option A — rollup DefectDojo). */
  posture: SecurityPostureResponse | null = null;
  postureLoading = false;
  postureError: string | null = null;
  /** Incrémente pour forcer le reload live du dashboard Dojo. */
  dojoRefreshTick = 0;

  /** Scan application (lot multi-services). */
  showAppScanModal = false;
  appScanRunning = false;
  appScanError: string | null = null;
  activeBatch: ScanBatchState | null = null;
  scanPipeline: PipelineScanResponse | null = null;
  scanPipelineLoading = false;
  private batchPollSub?: Subscription;
  private pipelinePollSub?: Subscription;

  private destroy$ = new Subject<void>();

  /** Stages scan (alignés GitLab CI multi-service). */
  private readonly scanStageTemplate = [
    'setup', 'code-analysis', 'sca', 'sast', 'secrets-iac', 'reporting', 'security-validation'
  ];
  private readonly stageLabels: Record<string, string> = {
    setup: 'Setup / clone',
    'code-analysis': 'Code Analysis',
    sca: 'SCA',
    sast: 'SAST',
    'secrets-iac': 'Secrets / IaC',
    reporting: 'Reporting',
    'security-validation': 'Security Validation'
  };

  constructor(
    private api: ApplicationManagementService,
    private pipelineApi: PipelineService,
    private applicationApi: ApplicationService,
    private appState: ManagedAppStateService,
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private ngZone: NgZone
  ) {}

  get currentUsername(): string {
    return this.auth.getCurrentUser()?.username
      || this.app?.createdByUsername
      || 'Utilisateur';
  }

  get currentUserInitials(): string {
    const name = (this.currentUsername || 'U').trim();
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  ngOnInit(): void {
    this.appId =
      this.route.parent?.snapshot.paramMap.get('id') ||
      this.route.snapshot.paramMap.get('id') ||
      '';
    this.previewTrigger$
      .pipe(debounceTime(250), takeUntil(this.destroy$))
      .subscribe((sel) => this.fetchDeployPreview(sel));

    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const raw = (params.get('section') || 'dashboard').toLowerCase();
      if (raw === 'services' || raw === 'databases') {
        this.router.navigate(['/projects', this.appId, 'dashboard'], { replaceUrl: true });
        return;
      }
      if (raw === 'security') {
        this.router.navigate(['/projects', this.appId, 'defectdojo'], { replaceUrl: true });
        return;
      }
      const allowed: AppSection[] = [
        'dashboard', 'defectdojo', 'quality-gate', 'monitoring', 'alerts',
        'deployments', 'history', 'pipelines'
      ];
      const section = (allowed.includes(raw as AppSection) ? raw : 'dashboard') as AppSection;
      this.applySection(section);
    });

    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((qp) => {
      const raw = qp.get('pipelineId');
      const n = raw != null && raw !== '' ? Number(raw) : NaN;
      this.pipelineIdFilter = Number.isFinite(n) ? n : null;
      const kind = (qp.get('kind') || '').toUpperCase();
      if (kind === 'SCAN' || kind === 'DEPLOY') {
        this.pipelineKindFilter = kind as PipelineKindFilter;
      }
      if (this.activeTab === 'pipelines') {
        this.loadAppPipelines();
      }
    });

    this.load(false);
  }

  ngOnDestroy(): void {
    this.batchPollSub?.unsubscribe();
    this.pipelinePollSub?.unsubscribe();
    this.stopAlertsPoll();
    this.destroyEnvHistoryChart();
    if (this.envHistoryChartTimer) clearTimeout(this.envHistoryChartTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(force = true): void {
    this.loading = !this.app || force;
    this.appState.load(this.appId, force).subscribe({
      next: (app) => {
        this.syncApp(app);
        this.customHostnameDraft = app.customHostname || '';
        this.loading = false;
        this.loadServiceStats(app.services || []);
        this.loadSecurityPosture();
        this.refreshActiveBatch();
        if (this.activeTab === 'deployments') this.loadHistory();
        if (this.activeTab === 'alerts') {
          this.loadAlerts();
          this.startAlertsPoll();
        }
        if (this.activeTab === 'pipelines') this.loadAppPipelines();
      },
      error: () => {
        this.error = 'Application introuvable.';
        this.loading = false;
      }
    });
  }

  /** Après mutation locale : synchronise le cache sidebar. */
  private syncApp(app: ManagedApp): void {
    this.app = app;
    this.appState.patch(app);
  }

  back(): void {
    this.router.navigate(['/projects']);
  }

  goSection(section: AppSection, queryParams?: Record<string, string>): void {
    this.router.navigate(['/projects', this.appId, section], {
      queryParams: queryParams || {}
    });
  }

  // ---------- Services ----------

  openDashboard(svc: AppServiceModel): void {
    this.openServiceSection(svc, 'overview');
  }

  /** Zoom service en préservant une sous-route logique (Dojo, QG…). */
  openServiceSection(svc: AppServiceModel, servicePath: string): void {
    if (!svc.id) return;
    try {
      localStorage.setItem('envirotest-last-managed-app-id', this.appId);
      if (this.app?.name) {
        localStorage.setItem('envirotest-last-managed-app-name', this.app.name);
      }
    } catch { /* ignore */ }
    this.router.navigate(['/project', svc.id, servicePath]);
  }

  /** CTA primaire du dashboard : Déployer si GO, sinon Scanner. */
  get dashboardPrimaryAction(): 'deploy' | 'scan' {
    const rec = this.appDeployRecommendation;
    if (rec?.canDeploy) return 'deploy';
    return 'scan';
  }

  runDashboardPrimary(): void {
    if (this.dashboardPrimaryAction === 'deploy') {
      this.openDeployModal();
    } else {
      this.openAppScanModal();
    }
  }

  loadSecurityPosture(): void {
    if (!this.appId) return;
    this.postureLoading = true;
    this.postureError = null;
    this.api.getSecurityPosture(this.appId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (p) => {
        this.posture = p;
        this.postureLoading = false;
      },
      error: (e) => {
        this.posture = null;
        this.postureLoading = false;
        this.postureError = e?.error?.message || 'Impossible de charger la posture sécurité.';
      }
    });
  }

  bumpDojoRefresh(): void {
    this.dojoRefreshTick++;
  }

  openBlockingFinding(f: TopBlockingFinding): void {
    if (!f?.serviceId || f.findingId == null) return;
    try {
      localStorage.setItem('envirotest-last-managed-app-id', this.appId);
      if (this.app?.name) {
        localStorage.setItem('envirotest-last-managed-app-name', this.app.name);
      }
    } catch { /* ignore */ }
    this.router.navigate(['/project', f.serviceId, 'security-dashboard', 'finding', String(f.findingId)]);
  }

  verdictClass(verdict: string | null | undefined): string {
    return 'ad-verdict-' + verdictTone(verdict);
  }

  verdictTone(verdict: string | null | undefined): string {
    return verdictTone(verdict);
  }

  verdictLabel(verdict: string | null | undefined): string {
    return verdictLabelFr(verdict);
  }

  isBlocked(verdict: string | null | undefined): boolean {
    return isHardBlocked(verdict);
  }

  severityCount(key: string): number {
    return this.posture?.bySeverity?.[key] ?? 0;
  }

  get dojoOpenTotal(): number {
    return ['critical', 'high', 'medium', 'low', 'info']
      .reduce((sum, k) => sum + this.severityCount(k), 0);
  }

  /**
   * Recommandation de déploiement de l'application complète
   * (verdict agrégé D5 + rollup DefectDojo).
   */
  get appDeployRecommendation(): {
    tone: ReturnType<typeof verdictTone>;
    title: string;
    detail: string;
    canDeploy: boolean;
    hasData: boolean;
  } | null {
    if (this.activeBatchRunning) {
      return {
        tone: 'unknown',
        title: 'Scan en cours',
        detail: 'Attends la fin du lot pour obtenir la recommandation de déploiement de l\'application.',
        canDeploy: false,
        hasData: false
      };
    }
    if (!this.posture || this.showEmptyScan) {
      return {
        tone: 'unknown',
        title: 'Recommandation indisponible',
        detail: 'Aucun scan applicatif — lance un scan de tous les services pour savoir si tu peux déployer.',
        canDeploy: false,
        hasData: false
      };
    }

    const tone = verdictTone(this.posture.verdict);
    const title = verdictLabelFr(this.posture.verdict);
    const critical = this.severityCount('critical');
    const high = this.severityCount('high');
    const finished = this.posture.finishedServiceCount ?? 0;
    const expected = this.posture.expectedServiceCount ?? 0;
    const dim = this.posture.dimensioningService;
    const blockedSvc = (this.posture.services || []).filter(s => isHardBlocked(s.verdict));
    const parts: string[] = [];

    if (this.posture.batchStatus && !this.posture.hasCompleteBatch) {
      parts.push(`Lot ${this.posture.batchStatus} (${finished}/${expected} services).`);
    } else if (expected > 0) {
      parts.push(`Verdict agrégé sur ${finished || expected} service(s).`);
    }

    if (tone === 'ok') {
      parts.push(
        critical + high === 0
          ? 'Aucun finding Critical/High ouvert sur le rollup DefectDojo.'
          : `${critical} Critical · ${high} High — sous les hard gates.`
      );
      if (dim?.serviceName) {
        parts.push(
          `Score dimensionné par « ${dim.serviceName} »`
          + (dim.securityScore != null ? ` (${dim.securityScore}${dim.grade ? ' · ' + dim.grade : ''}).` : '.')
        );
      } else if (this.posture.securityScore != null) {
        parts.push(`Score application ${this.posture.securityScore}${this.posture.grade ? ' · ' + this.posture.grade : ''}.`);
      }
      parts.push('Tu peux déployer l\'application complète en environnement de test.');
    } else if (tone === 'warn') {
      parts.push(`${critical} Critical · ${high} High sur le rollup app.`);
      if (dim?.serviceName) {
        parts.push(`Service le plus faible : « ${dim.serviceName} ».`);
      }
      parts.push('Déploiement éphémère possible — corrige les réserves avant une mise en production.');
    } else if (tone === 'bad') {
      if (critical > 0) {
        parts.push(
          `${critical} vulnérabilité(s) Critical open (DefectDojo) — hard gate, tolérance zéro.`
        );
      }
      if (blockedSvc.length) {
        parts.push(
          `Services concernés : ${blockedSvc.map(s => s.serviceName || s.serviceId).join(', ')}.`
        );
      }
      parts.push(
        'SonarQube en échec/absent n\'explique pas ce blocage seul : '
        + 'il rendrait le verdict INCOMPLET, pas « non recommandé ».'
      );
      if (this.posture.topBlockingFindings?.length) {
        parts.push(`${this.posture.topBlockingFindings.length} finding(s) bloquant(s) à traiter.`);
      }
    } else {
      parts.push(
        this.posture.message
          || 'Au moins un service a un verdict incomplet (ex. Sonar indisponible) — recommandation indéterminée.'
      );
    }

    if (this.posture.obsolete) {
      parts.push('Attention : au moins un service a avancé sur HEAD depuis le scan (verdict obsolète).');
    }

    return {
      tone,
      title,
      detail: parts.join(' '),
      canDeploy: tone === 'ok' || tone === 'warn',
      hasData: true
    };
  }

  serviceSeverityCount(svcSummary: ServicePostureSummary | undefined, key: string): number {
    return svcSummary?.bySeverity?.[key] ?? 0;
  }

  get qualityGates(): QualityGateItem[] {
    return this.posture?.qualityGates || [];
  }

  qualityGateStatusLabel(status: string | null | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'FAIL') return 'Échec';
    if (s === 'PASS') return 'OK';
    if (s === 'WARN') return 'Attention';
    return 'Inconnu';
  }

  serviceBarLabel(s: ServicePostureSummary): string {
    if (s.hardGateViolated || this.isBlocked(s.verdict)) {
      const ids = s.hardGateIds || [];
      if (ids.includes('dd_critical')) return 'Hard gate · Critical';
      if (ids.includes('secrets')) return 'Hard gate · Secrets';
      if (ids.includes('sonar_qg') || ids.includes('sonar_blocker')) return 'Hard gate · Sonar';
      return 'Hard gate';
    }
    if (s.indeterminate || this.verdictTone(s.verdict) === 'unknown') {
      return 'Incomplet';
    }
    if (s.securityScore != null) {
      return `${s.grade || '—'} · ${s.securityScore}`;
    }
    return 'jamais scanné';
  }

  hardGateLabel(id: string): string {
    switch (id) {
      case 'dd_critical': return 'Critical DefectDojo';
      case 'secrets': return 'Secrets Gitleaks';
      case 'sonar_blocker': return 'Sonar Blocker';
      case 'sonar_qg': return 'Sonar Quality Gate';
      default: return id;
    }
  }

  serviceHardGateLabels(s: ServicePostureSummary): string {
    return (s.hardGateIds || []).map(id => this.hardGateLabel(id)).join(', ');
  }

  openServiceDojo(svc: { serviceId?: string; id?: string }): void {
    const id = svc.serviceId || svc.id;
    if (!id) return;
    try {
      localStorage.setItem('envirotest-last-managed-app-id', this.appId);
      if (this.app?.name) {
        localStorage.setItem('envirotest-last-managed-app-name', this.app.name);
      }
    } catch { /* ignore */ }
    this.router.navigate(['/project', id, 'security-dashboard']);
  }

  get sectionTitle(): string {
    const map: Record<string, string> = {
      dashboard: "Vue d'ensemble",
      services: 'Services',
      databases: 'Bases de données',
      monitoring: 'Monitoring',
      alerts: 'Alertes',
      history: 'Historique',
      deployments: 'Runtime & environnements',
      pipelines: 'Pipelines',
      security: 'DefectDojo',
      defectdojo: 'DefectDojo',
      'quality-gate': 'Quality Gate'
    };
    return map[this.activeTab] || 'Application';
  }

  /** Premier service = source des métadonnées overview (repo / dockerfile / token). */
  get primaryService(): AppServiceModel | null {
    return this.app?.services?.[0] ?? null;
  }

  get uniqueBranches(): string[] {
    const set = new Set<string>();
    for (const s of this.app?.services || []) {
      const b = (s.gitBranch || '').trim();
      if (b) set.add(b);
    }
    return [...set];
  }

  get branchPathLabel(): string {
    const branches = this.uniqueBranches;
    if (branches.length === 0) return 'main';
    if (branches.length === 1) return branches[0];
    if (branches.length <= 3) return branches.join(' · ');
    return `${branches.length} branches`;
  }

  get compositionLabel(): string {
    if (!this.app) return '';
    const parts: string[] = [];
    const fe = this.app.services.filter(s => s.role === 'FRONTEND').length;
    const be = this.app.services.filter(s => s.role === 'BACKEND').length;
    const wk = this.app.services.filter(s => s.role === 'WORKER').length;
    if (fe) parts.push(`${fe} frontend`);
    if (be) parts.push(`${be} backend`);
    if (wk) parts.push(`${wk} worker`);
    const dbEngines = [...new Set(this.app.databases.map(d => d.engine))];
    if (dbEngines.length) parts.push(dbEngines.join(', '));
    return parts.join(' · ');
  }

  get appStack(): string {
    const roles = new Set((this.app?.services || []).map(s => s.role));
    if (roles.has('FRONTEND') && roles.has('BACKEND')) return 'fullstack';
    if (roles.has('FRONTEND')) return 'frontend';
    if (roles.has('BACKEND')) return 'backend';
    if (roles.has('WORKER')) return 'worker';
    return 'generic';
  }

  get appStackIcon(): string {
    switch (this.appStack) {
      case 'fullstack': return '◇';
      case 'frontend': return '◻';
      case 'backend': return '▣';
      case 'worker': return '⚙';
      default: return '◇';
    }
  }

  get envActiveCount(): number {
    const st = (this.app?.lastDeployment?.status || '').toUpperCase();
    return st === 'RUNNING' || st === 'DEPLOYING' ? 1 : 0;
  }

  get envPathLabel(): string {
    return `${this.envActiveCount} actif(s)`;
  }

  get securityPathLabel(): string {
    if (this.posture?.verdict) return this.verdictLabel(this.posture.verdict);
    return 'Analyse complète';
  }

  repoDisplayName(url: string | null | undefined): string {
    if (!url) return '—';
    try {
      const cleaned = url.replace(/\.git$/i, '').replace(/\/$/, '');
      const parts = cleaned.split('/');
      const repo = parts.pop() || '';
      const owner = parts.pop() || '';
      return owner ? `${owner}/${repo}` : repo || cleaned;
    } catch {
      return url;
    }
  }

  get activeBatchRunning(): boolean {
    const s = (this.activeBatch?.status || '').toUpperCase();
    return s === 'PENDING' || s === 'RUNNING';
  }

  /** Affiche un résultat (COMPLETE, PARTIAL, FAILED avec batchId). */
  get showPostureResult(): boolean {
    if (!this.posture) return false;
    if (this.posture.hasCompleteBatch) return true;
    const st = (this.posture.batchStatus || '').toUpperCase();
    if (st === 'PARTIAL' || st === 'FAILED') return true;
    return !!this.posture.batchId && st !== 'PENDING' && st !== 'RUNNING' && st !== '';
  }

  /** Vrai vide : pas de lot terminal ni en cours. */
  get showEmptyScan(): boolean {
    if (this.postureLoading) return false;
    if (!this.posture) return true;
    if (this.posture.hasCompleteBatch) return false;
    const st = (this.posture.batchStatus || '').toUpperCase();
    if (st === 'PARTIAL' || st === 'FAILED' || st === 'COMPLETE') return false;
    if (st === 'PENDING' || st === 'RUNNING') return false;
    return !this.posture.batchId;
  }

  get batchProgressPct(): number {
    const exp = this.activeBatch?.expectedServiceCount || this.app?.services?.length || 1;
    const fin = this.activeBatch?.finishedServiceCount || 0;
    return Math.min(100, Math.round((fin / Math.max(exp, 1)) * 100));
  }

  servicePosture(svc: AppServiceModel): ServicePostureSummary | undefined {
    if (!svc?.id || !this.posture?.services) return undefined;
    return this.posture.services.find(s => s.serviceId === svc.id);
  }

  serviceGrade(svc: AppServiceModel): string | null {
    const p = this.servicePosture(svc);
    if (!p) return null;
    if (this.isBlocked(p.verdict)) return 'X';
    return p.grade || null;
  }

  serviceCardState(svc: AppServiceModel): string {
    const p = this.servicePosture(svc);
    const branch = (svc.gitBranch || 'main').trim() || 'main';
    if (!p || (!p.verdict && p.securityScore == null)) {
      return `jamais scanné · ${branch}`;
    }
    if (this.isBlocked(p.verdict)) {
      return `bloqué · ${branch}`;
    }
    const grade = p.grade ? `${p.grade}` : '';
    const score = p.securityScore != null ? `${p.securityScore}` : '';
    const bits = [grade && score ? `${grade} · ${score}` : (grade || score), branch].filter(Boolean);
    return bits.join(' · ');
  }

  openAppScanModal(): void {
    this.appScanError = null;
    this.appScanRunning = false;
    this.showAppScanModal = true;
  }

  closeAppScanModal(): void {
    if (this.appScanRunning) return;
    this.showAppScanModal = false;
    this.appScanError = null;
  }

  confirmAppScan(params: AppScanParams): void {
    this.appScanRunning = true;
    this.appScanError = null;
    this.api.scanApplication(this.appId, {
      branch: params.branch,
      serviceIds: params.serviceIds
    }).subscribe({
      next: (batch) => {
        this.appScanRunning = false;
        this.showAppScanModal = false;
        this.activeBatch = batch;
        this.syncMessage = `Scan lancé — ${params.serviceIds.length} service(s).`;
        this.startBatchPolling();
        this.refreshScanPipeline();
        const pid = batch?.gitlabPipelineId;
        if (pid) {
          try {
            localStorage.setItem('envirotest-last-pipeline-id', String(pid));
            localStorage.setItem(`envirotest-last-pipeline-id:${this.appId}`, String(pid));
            localStorage.setItem('envirotest-last-pipeline-kind', 'SCAN');
          } catch { /* ignore */ }
          this.router.navigate(['/projects', this.appId, 'pipeline-detail', String(pid)], {
            queryParams: { kind: 'SCAN' }
          });
        } else {
          this.router.navigate(['/projects', this.appId, 'pipeline-detail'], {
            queryParams: { kind: 'SCAN' }
          });
        }
      },
      error: (e) => {
        this.appScanRunning = false;
        this.appScanError = e?.error?.message || 'Impossible de lancer le scan application.';
      }
    });
  }

  get batchServices(): ScanBatchServiceState[] {
    return this.activeBatch?.services || [];
  }

  /** Service actuellement scanné = premier non terminé, sinon dernier. */
  get currentScanningService(): ScanBatchServiceState | null {
    const list = this.batchServices;
    if (!list.length) return null;
    const active = list.find(s => {
      const st = (s.status || '').toUpperCase();
      return !s.finished && (st === 'RUNNING' || st === 'PENDING' || st === 'CREATED' || !st);
    });
    return active || list.find(s => !s.finished) || null;
  }

  get scanStages(): Array<{ name: string; status: 'done' | 'active' | 'pending' | 'failed' }> {
    const jobs = this.scanPipeline?.jobs || [];
    const byStage = new Map<string, PipelineJobInfo[]>();
    for (const job of jobs) {
      const stage = (job.stage || job.name || 'unknown').toLowerCase();
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage)!.push(job);
    }
    return this.scanStageTemplate.map(stageName => {
      const stageJobs = byStage.get(stageName) || [];
      return {
        name: this.stageLabels[stageName] || stageName,
        status: this.statusFromStageJobs(stageJobs)
      };
    });
  }

  serviceScanStatusLabel(s: ScanBatchServiceState): string {
    if (s.finished) {
      const st = (s.status || '').toUpperCase();
      if (st === 'FAILED' || st === 'CANCELED') return 'Échec';
      return 'Terminé';
    }
    if (this.currentScanningService?.serviceId === s.serviceId) return 'En cours';
    const st = (s.status || '').toUpperCase();
    if (st === 'RUNNING') return 'En cours';
    if (st === 'FAILED') return 'Échec';
    return 'En attente';
  }

  serviceScanStatusClass(s: ScanBatchServiceState): string {
    const label = this.serviceScanStatusLabel(s);
    if (label === 'Terminé') return 'ad-scan-svc--done';
    if (label === 'En cours') return 'ad-scan-svc--active';
    if (label === 'Échec') return 'ad-scan-svc--failed';
    return 'ad-scan-svc--pending';
  }

  refreshActiveBatch(): void {
    this.api.listScanBatches(this.appId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (batches) => {
        const running = (batches || []).find(b => {
          const s = (b.status || '').toUpperCase();
          return s === 'PENDING' || s === 'RUNNING';
        });
        this.activeBatch = running || null;
        if (running) {
          this.startBatchPolling();
          this.refreshScanPipeline();
        }
      },
      error: () => { /* ignore */ }
    });
  }

  private startBatchPolling(): void {
    this.batchPollSub?.unsubscribe();
    this.pipelinePollSub?.unsubscribe();
    if (!this.activeBatchRunning) return;

    const batchId = this.activeBatch?.batchId;
    this.batchPollSub = interval(4000)
      .pipe(
        switchMap(() => {
          if (batchId) {
            return this.api.getScanBatch(this.appId, batchId).pipe(
              catchError(() => this.api.listScanBatches(this.appId).pipe(
                switchMap(list => {
                  const found = list.find(b => b.batchId === batchId) || list[0];
                  return found ? of(found) : of(null);
                })
              ))
            );
          }
          return this.api.listScanBatches(this.appId).pipe(
            switchMap(list => of(list.find(b => {
              const s = (b.status || '').toUpperCase();
              return s === 'PENDING' || s === 'RUNNING';
            }) || null))
          );
        }),
        takeWhile((batch) => {
          if (batch) this.activeBatch = batch;
          const s = (batch?.status || '').toUpperCase();
          return s === 'PENDING' || s === 'RUNNING';
        }, true),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          this.refreshScanPipeline();
          if (!this.activeBatchRunning) {
            this.loadSecurityPosture();
            this.pipelinePollSub?.unsubscribe();
          }
        },
        error: () => { /* ignore */ }
      });

    this.pipelinePollSub = interval(5000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refreshScanPipeline());
  }

  private refreshScanPipeline(): void {
    const pid = this.activeBatch?.gitlabPipelineId;
    if (!pid) {
      this.scanPipeline = null;
      return;
    }
    this.scanPipelineLoading = !this.scanPipeline;
    // Prefer first unfinished service id for applicationId context
    const svcId = this.currentScanningService?.serviceId
      || this.batchServices[0]?.serviceId
      || undefined;
    this.pipelineApi.getPipelineAndScanLiveById(pid, svcId || undefined)
      .pipe(
        catchError(() => this.pipelineApi.getPipelineById(pid)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          this.scanPipeline = res;
          this.scanPipelineLoading = false;
        },
        error: () => {
          this.scanPipelineLoading = false;
        }
      });
  }

  private statusFromStageJobs(jobs: PipelineJobInfo[]): 'done' | 'active' | 'pending' | 'failed' {
    if (!jobs.length) return 'pending';
    const statuses = jobs.map(j => (j.status || '').toLowerCase());
    if (statuses.some(s => s === 'failed' || s === 'canceled')) return 'failed';
    if (statuses.some(s => s === 'running' || s === 'pending' || s === 'created' || s === 'building')) {
      return 'active';
    }
    if (statuses.every(s => s === 'success' || s === 'passed' || s === 'manual' || s === 'skipped')) {
      if (statuses.every(s => s === 'skipped' || s === 'manual')) return 'pending';
      return 'done';
    }
    return 'pending';
  }

  openScanModal(svc: AppServiceModel): void {
    if (!svc.id) return;
    this.scanningService = svc;
    this.scanError = null;
    this.scanRunning = false;
    this.showScanModal = true;
  }

  closeScanModal(): void {
    if (this.scanRunning) return;
    this.showScanModal = false;
    this.scanningService = null;
    this.scanError = null;
  }

  confirmScan(params: DeployRunParams): void {
    if (!this.scanningService?.id) return;
    this.scanRunning = true;
    this.scanError = null;
    const serviceId = this.scanningService.id;
    this.api.scanService(serviceId, params.branch).subscribe({
      next: (res) => {
        this.scanRunning = false;
        this.showScanModal = false;
        const name = this.scanningService?.name || 'service';
        this.scanningService = null;
        this.syncMessage = res?.message
          || `Scan lancé pour « ${name} »`
            + (res?.gitlabPipelineId ? ` (pipeline #${res.gitlabPipelineId}).` : '.');
        if (this.app) this.loadServiceStats(this.app.services || []);
        const pid = res?.gitlabPipelineId;
        if (pid) {
          try {
            localStorage.setItem('envirotest-last-pipeline-id', String(pid));
            localStorage.setItem(`envirotest-last-pipeline-id:${this.appId}`, String(pid));
            localStorage.setItem('envirotest-last-pipeline-kind', 'SCAN');
          } catch { /* ignore */ }
          this.router.navigate(['/projects', this.appId, 'pipeline-detail', String(pid)], {
            queryParams: { kind: 'SCAN' }
          });
        } else {
          this.router.navigate(['/projects', this.appId, 'pipeline-detail'], {
            queryParams: { kind: 'SCAN' }
          });
        }
      },
      error: (e) => {
        this.scanRunning = false;
        this.scanError = e?.error?.message || 'Impossible de lancer le scan.';
      }
    });
  }

  openAddService(): void {
    this.editingService = null;
    this.formError = null;
    this.showServiceForm = true;
  }

  openEditService(svc: AppServiceModel): void {
    this.editingService = svc;
    this.formError = null;
    this.showServiceForm = true;
  }

  saveService(payload: AppServiceModel): void {
    this.saving = true;
    this.formError = null;
    this.syncMessage = null;
    const editingId = this.editingService?.id;
    const req = editingId
      ? this.api.updateService(this.appId, editingId, payload)
      : this.api.addService(this.appId, payload);
    req.subscribe({
      next: (saved) => {
        const serviceId = editingId || saved?.id;
        if (!serviceId || !editingId) {
          this.saving = false;
          this.showServiceForm = false;
          this.load();
          return;
        }
        this.api.syncServiceRuntime(this.appId, serviceId).subscribe({
          next: (sync) => {
            this.saving = false;
            this.showServiceForm = false;
            this.syncMessage = sync?.message || (sync?.synced
              ? 'Variables appliquées sur le cluster.'
              : 'Enregistré en base (pas d’env RUNNING à synchroniser).');
            this.load();
          },
          error: (e) => {
            this.saving = false;
            this.showServiceForm = false;
            this.syncMessage = e?.error?.message
              || 'Enregistré en base, mais sync cluster échouée.';
            this.load();
          }
        });
      },
      error: (e) => {
        this.formError = e?.error?.message || 'Enregistrement impossible.';
        this.saving = false;
      }
    });
  }

  syncServiceToCluster(svc: AppServiceModel): void {
    if (!svc.id) return;
    this.syncingServiceId = svc.id;
    this.syncMessage = null;
    this.api.syncServiceRuntime(this.appId, svc.id).subscribe({
      next: (sync) => {
        this.syncingServiceId = null;
        this.syncMessage = sync?.message || 'Sync terminée.';
      },
      error: (e) => {
        this.syncingServiceId = null;
        this.syncMessage = e?.error?.message || 'Sync cluster impossible.';
      }
    });
  }

  deleteService(svc: AppServiceModel): void {
    if (!svc.id || !confirm(`Supprimer le service « ${svc.name} » ?\nSes pods/ressources seront aussi retirés du cluster RUNNING.`)) return;
    this.syncMessage = null;
    this.api.deleteService(this.appId, svc.id).subscribe({
      next: (res) => {
        this.syncMessage = res?.message || 'Service supprimé.';
        this.load();
      },
      error: (e) => {
        this.syncMessage = e?.error?.message || 'Suppression impossible.';
      }
    });
  }

  // ---------- Databases ----------

  openAddDatabase(): void {
    this.editingDatabase = null;
    this.formError = null;
    this.showDatabaseForm = true;
  }

  openEditDatabase(db: AppDatabaseModel): void {
    this.editingDatabase = db;
    this.formError = null;
    this.showDatabaseForm = true;
  }

  saveDatabase(payload: AppDatabaseModel): void {
    this.saving = true;
    this.formError = null;
    const req = this.editingDatabase?.id
      ? this.api.updateDatabase(this.appId, this.editingDatabase.id, payload)
      : this.api.addDatabase(this.appId, payload);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showDatabaseForm = false;
        this.load();
      },
      error: (e) => {
        this.formError = e?.error?.message || 'Enregistrement impossible.';
        this.saving = false;
      }
    });
  }

  deleteDatabase(db: AppDatabaseModel): void {
    if (!db.id || !confirm(`Supprimer la base « ${db.name} » ?\nSes pods/PVC seront aussi retirés du cluster RUNNING.`)) return;
    this.syncMessage = null;
    this.api.deleteDatabase(this.appId, db.id).subscribe({
      next: (res) => {
        this.syncMessage = res?.message || 'Base supprimée.';
        this.load();
      },
      error: (e) => {
        this.syncMessage = e?.error?.message || 'Suppression impossible.';
      }
    });
  }

  // ---------- Deploy ----------

  openDeployModal(): void {
    if (!this.app?.services?.length) {
      this.deployError = 'Ajoutez au moins un service avant de déployer.';
      return;
    }
    this.deployError = null;
    this.deployPreview = null;
    this.showDeployModal = true;
  }

  closeDeployModal(): void {
    if (this.deploying) return;
    this.showDeployModal = false;
    this.deployPreview = null;
    this.deployError = null;
  }

  onDeploySelectionChange(sel: {
    branch: string;
    sessionDurationHours: number;
    serviceIds: string[];
  }): void {
    this.previewTrigger$.next(sel);
  }

  private fetchDeployPreview(sel: {
    branch: string;
    sessionDurationHours: number;
    serviceIds: string[];
  }): void {
    if (!this.showDeployModal) return;
    if (!sel.serviceIds.length) {
      this.deployPreview = null;
      this.deployPreviewLoading = false;
      return;
    }
    this.deployPreviewLoading = true;
    this.api.previewDeploy(this.appId, {
      branch: sel.branch,
      sessionDurationHours: sel.sessionDurationHours,
      serviceIds: sel.serviceIds
    }).subscribe({
      next: (preview) => {
        this.deployPreview = preview;
        this.deployPreviewLoading = false;
      },
      error: (e) => {
        this.deployPreviewLoading = false;
        this.deployError = e?.error?.message || 'Impossible d\'analyser la sélection.';
      }
    });
  }

  confirmDeploy(params: ProjectDeployParams): void {
    this.deploying = true;
    this.deployError = null;
    const host = (params.customHostname || '').trim() || null;
    const current = (this.app?.customHostname || '').trim() || null;
    const runDeploy = () => {
      this.api.deploy(this.appId, {
        branch: params.branch,
        sessionDurationHours: params.sessionDurationHours,
        serviceIds: params.serviceIds
      }).subscribe({
        next: (dep) => {
          this.deploying = false;
          this.showDeployModal = false;
          this.deployPreview = null;
          this.syncMessage = host
            ? `Déploiement lancé — domaine « ${host} ».`
            : 'Déploiement lancé.';
          this.load();
          if (this.activeTab === 'deployments') this.loadHistory();
          const pid = dep?.gitlabPipelineId;
          if (pid) {
            try {
              localStorage.setItem('envirotest-last-pipeline-id', String(pid));
              localStorage.setItem(`envirotest-last-pipeline-id:${this.appId}`, String(pid));
              localStorage.setItem('envirotest-last-pipeline-kind', 'DEPLOY');
            } catch { /* ignore */ }
            this.router.navigate(['/projects', this.appId, 'pipeline-detail', String(pid)], {
              queryParams: { kind: 'DEPLOY' }
            });
          } else {
            this.router.navigate(['/projects', this.appId, 'pipeline-detail'], {
              queryParams: { kind: 'DEPLOY' }
            });
          }
        },
        error: (e) => {
          this.deployError = e?.error?.message || 'Déploiement impossible.';
          this.deploying = false;
        }
      });
    };

    if (host === current || !this.app) {
      runDeploy();
      return;
    }
    // Enregistre le domaine optionnel avant de déclencher le pipeline.
    this.api.update(this.appId, {
      name: this.app.name,
      description: this.app.description,
      customHostname: host
    }).subscribe({
      next: (updated) => {
        this.syncApp(updated);
        this.customHostnameDraft = updated.customHostname || '';
        runDeploy();
      },
      error: (e) => {
        this.deployError = e?.error?.message || 'Impossible d\'enregistrer le domaine.';
        this.deploying = false;
      }
    });
  }

  teardown(): void {
    const dep = this.app?.lastDeployment;
    if (!dep || !confirm('Supprimer le déploiement (namespace K8s) ?\nLes pods et services cluster seront détruits.')) return;
    this.syncMessage = null;
    this.api.teardownDeployment(this.appId, dep.id).subscribe({
      next: () => {
        this.syncMessage = 'Déploiement arrêté — environnement STOPPED.';
        this.load();
        if (this.activeTab === 'deployments') this.loadHistory();
      },
      error: (e) => {
        this.syncMessage = e?.error?.message || 'Teardown impossible.';
        this.load();
      }
    });
  }

  deleteApp(): void {
    if (!confirm(`Supprimer l'application « ${this.app?.name} » et tout son contenu ?`)) return;
    this.api.delete(this.appId).subscribe({ next: () => this.back() });
  }

  saveCustomHostname(): void {
    if (!this.app) return;
    this.savingHostname = true;
    this.hostnameError = null;
    this.hostnameMessage = null;
    const host = (this.customHostnameDraft || '').trim() || null;
    this.api.update(this.appId, {
      name: this.app.name,
      description: this.app.description,
      customHostname: host
    }).subscribe({
      next: (updated) => {
        this.syncApp(updated);
        this.customHostnameDraft = updated.customHostname || '';
        this.savingHostname = false;
        this.hostnameMessage = host
          ? `Domaine « ${host} » enregistré — pointez le DNS vers l'IP Traefik.`
          : 'Domaine custom retiré — retour à nip.io.';
      },
      error: (e) => {
        this.savingHostname = false;
        this.hostnameError = e?.error?.message || 'Impossible d\'enregistrer le domaine.';
      }
    });
  }

  // ---------- Stats cartes ----------

  private loadServiceStats(services: AppServiceModel[]): void {
    for (const svc of services) {
      if (!svc.id) continue;
      const id = svc.id;
      this.serviceStats[id] = {
        scanCount: this.serviceStats[id]?.scanCount ?? 0,
        deployCount: this.serviceStats[id]?.deployCount ?? 0,
        lastScanAt: this.serviceStats[id]?.lastScanAt ?? null,
        loading: true
      };
      forkJoin({
        scans: this.pipelineApi.listPipelines(0, 50, id, 'SCAN').pipe(catchError(() => of([]))),
        metrics: this.applicationApi.getDeploymentMetrics(id).pipe(
          catchError(() => of({ total: 0, success: 0, failed: 0, canceled: 0, pending: 0, running: 0, skipped: 0 }))
        )
      }).subscribe({
        next: ({ scans, metrics }) => {
          const lastScan = scans?.length
            ? [...scans].sort((a, b) =>
                new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
              )[0]
            : null;
          this.serviceStats[id] = {
            scanCount: scans?.length ?? 0,
            deployCount: metrics?.total ?? 0,
            lastScanAt: lastScan?.createdAt || null,
            loading: false
          };
        },
        error: () => {
          this.serviceStats[id] = {
            scanCount: 0,
            deployCount: 0,
            lastScanAt: null,
            loading: false
          };
        }
      });
    }
  }

  statsFor(svc: AppServiceModel): ServiceCardStats {
    if (!svc.id) {
      return { scanCount: 0, deployCount: 0, lastScanAt: null, loading: false };
    }
    return this.serviceStats[svc.id] || {
      scanCount: 0,
      deployCount: 0,
      lastScanAt: null,
      loading: true
    };
  }

  // ---------- Historique / Alertes ----------

  setTab(tab: AppSection): void {
    this.goSection(tab);
  }

  private applySection(section: AppSection): void {
    this.activeTab = section;
    if (section === 'history') {
      this.loadSecurityPosture();
    }
    if (section === 'deployments') {
      this.loadHistory();
      this.loadSecurityPosture();
    }
    if (section === 'pipelines') {
      this.loadAppPipelines();
    }
    if (section === 'security' || section === 'defectdojo' || section === 'dashboard' || section === 'quality-gate') {
      this.loadSecurityPosture();
    }
    if (section === 'alerts') {
      this.loadAlerts();
      this.startAlertsPoll();
    } else {
      this.stopAlertsPoll();
    }
  }

  toggleRuntimeSection(): void {
    this.runtimeSectionOpen = !this.runtimeSectionOpen;
  }

  toggleHistorySection(): void {
    this.historySectionOpen = !this.historySectionOpen;
  }

  toggleActiveOps(): void {
    this.opsSectionOpen = !this.opsSectionOpen;
    this.activeOpsOpen = this.opsSectionOpen;
  }

  toggleOpsSection(): void {
    this.opsSectionOpen = !this.opsSectionOpen;
  }

  focusActiveEnvironment(): void {
    this.runtimeSectionOpen = true;
    this.selectedHistoryId = null;
    const el = document.getElementById('ad-rt-active');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  focusOpsSection(): void {
    this.opsSectionOpen = true;
    const el = document.getElementById('ad-rt-ops');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  loadHistoryTimeline(): void {
    /* Conservé pour compat éventuelle — la timeline est dans managed-app-history. */
    this.loadHistory();
  }

  openHistoryDeployment(deploymentId: string): void {
    this.goSection('deployments');
    if (deploymentId) {
      this.selectedHistoryId = deploymentId;
      setTimeout(() => this.scrollToHistoryDetail(), 120);
    }
  }

  clearPipelineIdFilter(): void {
    this.router.navigate(['/projects', this.appId, 'pipelines'], {
      queryParams: this.pipelineKindFilter !== 'ALL' ? { kind: this.pipelineKindFilter } : {}
    });
  }

  clearPipelineKindFilter(): void {
    this.pipelineKindFilter = 'ALL';
    this.router.navigate(['/projects', this.appId, 'pipelines'], {
      queryParams: this.pipelineIdFilter != null ? { pipelineId: String(this.pipelineIdFilter) } : {}
    });
  }

  clearAllPipelineFilters(): void {
    this.pipelineKindFilter = 'ALL';
    this.pipelineIdFilter = null;
    this.router.navigate(['/projects', this.appId, 'pipelines'], { queryParams: {} });
    this.loadAppPipelines();
  }

  openServiceQualityGate(serviceId: string | null | undefined): void {
    if (!serviceId) return;
    try {
      localStorage.setItem('envirotest-last-managed-app-id', this.appId);
      if (this.app?.name) {
        localStorage.setItem('envirotest-last-managed-app-name', this.app.name);
      }
    } catch { /* ignore */ }
    this.router.navigate(['/project', serviceId, 'quality-gate']);
  }

  loadHistory(): void {
    this.historyLoading = true;
    this.historyError = null;
    this.api.listDeployments(this.appId).subscribe({
      next: (list) => {
        this.history = list || [];
        this.historyLoading = false;
        // Ne pas auto-sélectionner : évite le doublon env actif en panneau détail.
        if (this.selectedHistoryId && !this.history.some(d => d.id === this.selectedHistoryId)) {
          this.selectedHistoryId = null;
        }
        this.scheduleEnvHistoryChart();
      },
      error: (e) => {
        this.historyError = e?.error?.message || 'Impossible de charger l\'historique.';
        this.historyLoading = false;
        this.destroyEnvHistoryChart();
      }
    });
  }

  loadAlerts(silent = false): void {
    const depId = this.app?.lastDeployment?.id;
    if (!depId) {
      this.alertsData = null;
      this.alertsError = null;
      this.stopAlertsPoll();
      return;
    }
    if (!silent) {
      this.alertsLoading = true;
    }
    this.alertsError = null;
    this.api.getDeploymentAlerts(this.appId, depId).subscribe({
      next: (res) => {
        this.alertsData = res;
        this.alertsLoading = false;
        this.alertsLastRefresh = new Date();
      },
      error: (e) => {
        if (!silent) {
          this.alertsError = e?.error?.message || 'Impossible de charger les alertes.';
        }
        this.alertsLoading = false;
      }
    });
  }

  private startAlertsPoll(): void {
    this.stopAlertsPoll();
    if (!this.app?.lastDeployment?.id) return;
    this.alertsPollSub = interval(ApplicationDetailComponent.ALERTS_POLL_MS)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.activeTab === 'alerts') {
          this.loadAlerts(true);
        }
      });
  }

  private stopAlertsPoll(): void {
    this.alertsPollSub?.unsubscribe();
    this.alertsPollSub = undefined;
  }

  get filteredLiveAlerts(): DeploymentMonitorAlert[] {
    return this.filterAlerts(this.alertsData?.live || []);
  }

  get filteredHistoryAlerts(): DeploymentMonitorAlert[] {
    return this.filterAlerts(this.alertsData?.history || []);
  }

  get showLiveSection(): boolean {
    return this.alertsScope === 'all' || this.alertsScope === 'live';
  }

  get showHistorySection(): boolean {
    return this.alertsScope === 'all' || this.alertsScope === 'history';
  }

  get alertsErrorCount(): number {
    return (this.alertsData?.live || []).filter(a => a.severity === 'error').length;
  }

  get alertsWarnCount(): number {
    return (this.alertsData?.live || []).filter(a => a.severity === 'warn').length;
  }

  get alertsK8sCount(): number {
    return (this.alertsData?.live || []).filter(a => this.alertCategory(a) === 'k8s').length;
  }

  get alertsHealthCount(): number {
    return (this.alertsData?.live || []).filter(a => this.alertCategory(a) === 'health').length;
  }

  get alertsPodCount(): number {
    return (this.alertsData?.live || []).filter(a => this.alertCategory(a) === 'pod').length;
  }

  get selectedReasonName(): string | null {
    return this.alertsFilter.startsWith('reason:')
      ? this.alertsFilter.slice('reason:'.length)
      : null;
  }

  /**
   * Agrégation par nom d'erreur/warning (FailedCreate, CrashLoopBackOff…).
   * Respecte search + scope + filtres catégorie/sévérité (sauf reason:).
   */
  get alertAggregations(): AlertNameAgg[] {
    const live = this.alertsInScope(this.alertsData?.live || [], 'live');
    const history = this.alertsInScope(this.alertsData?.history || [], 'history');
    const base = this.applyNonReasonFilters([...live, ...history]);

    const map = new Map<string, AlertNameAgg>();
    for (const a of base) {
      const name = this.alertReasonLabel(a);
      if (!name) continue;
      let row = map.get(name);
      if (!row) {
        row = {
          name,
          total: 0,
          live: 0,
          history: 0,
          errors: 0,
          warnings: 0,
          category: this.alertCategory(a),
          severity: a.severity === 'error' ? 'error' : 'warn',
          samples: []
        };
        map.set(name, row);
      }
      row.total++;
      if (a.source === 'history') row.history++;
      else row.live++;
      if (a.severity === 'error') {
        row.errors++;
        row.severity = 'error';
      } else {
        row.warnings++;
      }
      if (row.samples.length < 3) {
        row.samples.push(a);
      }
    }

    return [...map.values()].sort((a, b) =>
      b.total - a.total
      || b.errors - a.errors
      || a.name.localeCompare(b.name)
    );
  }

  get filteredAggregations(): AlertNameAgg[] {
    const q = this.alertsSearch.trim().toLowerCase();
    let list = this.alertAggregations;
    if (this.alertsFilter === 'error') {
      list = list.filter(g => g.errors > 0);
    } else if (this.alertsFilter === 'warn') {
      list = list.filter(g => g.warnings > 0);
    } else if (this.alertsFilter === 'k8s' || this.alertsFilter === 'health' || this.alertsFilter === 'pod') {
      list = list.filter(g => g.category === this.alertsFilter);
    } else if (this.selectedReasonName) {
      list = list.filter(g => g.name === this.selectedReasonName);
    }
    if (q) {
      list = list.filter(g =>
        g.name.toLowerCase().includes(q)
        || g.samples.some(s => (s.message || '').toLowerCase().includes(q))
      );
    }
    return list;
  }

  private alertsInScope(list: DeploymentMonitorAlert[], source: 'live' | 'history'): DeploymentMonitorAlert[] {
    if (this.alertsScope === 'all') return list;
    if (this.alertsScope === 'live') return source === 'live' ? list : [];
    return source === 'history' ? list : [];
  }

  private applyNonReasonFilters(list: DeploymentMonitorAlert[]): DeploymentMonitorAlert[] {
    const q = this.alertsSearch.trim().toLowerCase();
    const f = this.alertsFilter;
    return list.filter(a => {
      if (f === 'error' || f === 'warn') {
        if ((a.severity || '').toLowerCase() !== f) return false;
      } else if (f === 'k8s' || f === 'health' || f === 'pod') {
        if (this.alertCategory(a) !== f) return false;
      }
      // reason: filtré au niveau groupement / filterAlerts
      if (q) {
        const hay = [
          a.message, a.reason, a.pod, a.workload, a.object, a.type, a.kind,
          this.alertReasonLabel(a)
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  setAlertsFilter(filter: string): void {
    this.alertsFilter = filter;
  }

  filterByAlertName(name: string): void {
    const next = 'reason:' + name;
    this.alertsFilter = this.alertsFilter === next ? 'all' : next;
    if (this.alertsFilter.startsWith('reason:')) {
      this.alertsViewMode = 'list';
    } else {
      this.alertsViewMode = 'grouped';
    }
  }

  backToAlertAggregation(): void {
    this.alertsFilter = 'all';
    this.alertsViewMode = 'grouped';
  }

  clearAlertsFilters(): void {
    this.alertsFilter = 'all';
    this.alertsSearch = '';
    this.alertsScope = 'all';
    this.alertsViewMode = 'grouped';
  }

  alertCategory(a: DeploymentMonitorAlert): 'k8s' | 'health' | 'pod' {
    const kind = (a.kind || '').toLowerCase();
    if (kind === 'k8s-event' || kind === 'k8s') return 'k8s';
    if (kind === 'health') return 'health';
    if (kind === 'pod') return 'pod';

    const type = (a.type || '').toUpperCase();
    if (type.includes('HEALTH')) return 'health';
    if (type.includes('K8S_WARNING')) {
      const m = (a.message || '').toLowerCase();
      if (m.includes('health') || m.includes('ingress')) return 'health';
      if (m.includes('pending') || m.includes('crashloop') || m.includes('oom') || m.includes('pod failed')) {
        return 'pod';
      }
      return 'k8s';
    }

    const msg = (a.message || '').toLowerCase();
    const reason = (a.reason || '').toLowerCase();
    if (msg.includes('health url') || msg.includes('ingress') || reason.includes('health') || reason.includes('ingress')) {
      return 'health';
    }
    if (
      reason.includes('failedcreate') || reason.includes('failedscheduling') || reason.includes('failedmount')
      || reason.includes('unhealthy') || reason.includes('backoff')
      || msg.includes('failedcreate') || msg.includes('failedscheduling')
    ) {
      return 'k8s';
    }
    return 'pod';
  }

  private filterAlerts(list: DeploymentMonitorAlert[]): DeploymentMonitorAlert[] {
    const q = this.alertsSearch.trim().toLowerCase();
    const f = this.alertsFilter;
    return list.filter(a => {
      if (f === 'error' || f === 'warn') {
        if ((a.severity || '').toLowerCase() !== f) return false;
      } else if (f === 'k8s' || f === 'health' || f === 'pod') {
        if (this.alertCategory(a) !== f) return false;
      } else if (f.startsWith('reason:')) {
        const want = f.slice('reason:'.length).toLowerCase();
        if (this.alertReasonLabel(a).toLowerCase() !== want) return false;
      }
      if (q) {
        const hay = [
          a.message, a.reason, a.pod, a.workload, a.object, a.type, a.kind,
          this.alertReasonLabel(a)
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  alertReasonLabel(a: DeploymentMonitorAlert): string {
    if (a.reason && a.reason.trim()) return a.reason.trim();
    const msg = a.message || '';
    // Prefixed history messages: "[slug] ns=x svc=y pod=z — FailedCreate — detail"
    const parts = msg.split(' — ').map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.includes('=') || part.startsWith('[')) continue;
      if (/^[A-Za-z][A-Za-z0-9_-]{1,47}$/.test(part)) return part;
    }
    const dash = msg.indexOf(' — ');
    if (dash > 0 && dash < 48) {
      const head = msg.slice(0, dash).trim();
      if (!head.includes('=') && !head.startsWith('[')) return head;
    }
    if (a.type) {
      const t = a.type.replace(/^DEPLOYMENT_/, '');
      if (t.includes('HEALTH')) return 'HealthCheckFailed';
      if (t.includes('CRASH')) return 'CrashLoopBackOff';
      if (t.includes('OOM')) return 'OOMKilled';
      if (t.includes('POD_FAILED')) return 'PodFailed';
      if (t.includes('K8S')) return 'K8sWarning';
      return t.replace(/_/g, '');
    }
    return a.severity === 'error' ? 'Error' : 'Warning';
  }

  alertCategoryLabel(a: DeploymentMonitorAlert): string {
    const c = this.alertCategory(a);
    if (c === 'k8s') return 'Kubernetes';
    if (c === 'health') return 'Health check';
    return 'Pod';
  }

  categoryLabel(cat: 'k8s' | 'health' | 'pod'): string {
    if (cat === 'k8s') return 'Kubernetes';
    if (cat === 'health') return 'Health check';
    return 'Pod';
  }

  alertTarget(a: DeploymentMonitorAlert): string {
    return a.object || a.workload || a.pod || '';
  }

  alertClass(severity: string | undefined): string {
    if (severity === 'error') return 'am-alert-error';
    if (severity === 'warn') return 'am-alert-warn';
    return 'am-alert';
  }

  trackAlert(index: number, a: DeploymentMonitorAlert): string {
    return `${a.id || ''}|${a.reason || ''}|${a.object || a.pod || a.workload || ''}|${a.message || ''}|${index}`;
  }

  trackAgg(_index: number, g: AlertNameAgg): string {
    return g.name;
  }

  healthStatusTone(): 'ok' | 'ko' | 'unknown' {
    const h = this.alertsData?.health;
    if (!h?.checked) return 'unknown';
    if (h.ok === true) return 'ok';
    if (h.ok === false) return 'ko';
    return 'unknown';
  }

  selectHistory(dep: AppDeployment): void {
    if (this.isCurrentDeployment(dep) && this.isDeployOnline(dep)) {
      this.selectedHistoryId = dep.id;
      this.scrollToHistoryDetail();
      return;
    }
    const opening = this.selectedHistoryId !== dep.id;
    this.selectedHistoryId = opening ? dep.id : null;
    if (opening) {
      this.scrollToHistoryDetail();
    }
  }

  /** Après sélection : amène le panneau détail dans le viewport. */
  private scrollToHistoryDetail(): void {
    setTimeout(() => {
      const el = document.getElementById('ad-env-detail')
        || document.getElementById('ad-env-detail-hint');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  get selectedHistory(): AppDeployment | null {
    if (!this.selectedHistoryId) return null;
    return this.history.find(d => d.id === this.selectedHistoryId) || null;
  }

  /** Env sélectionné = celui déjà montré en section Environnement actif. */
  get selectedHistoryIsActive(): boolean {
    const d = this.selectedHistory;
    return !!d && this.isCurrentDeployment(d) && this.isDeployOnline(d);
  }

  /** Détail historique à monter (pas l'actif en double). */
  get selectedHistoryForDetail(): AppDeployment | null {
    if (!this.selectedHistory || this.selectedHistoryIsActive) return null;
    return this.selectedHistory;
  }

  get filteredHistory(): AppDeployment[] {
    let list = [...this.history];
    if (this.deployStatusFilter !== 'ALL') {
      const want = this.deployStatusFilter;
      list = list.filter(d => {
        const s = (d.status || '').toUpperCase();
        if (want === 'DEPLOYING') return s === 'DEPLOYING' || s === 'PENDING';
        return s === want;
      });
    }
    const q = (this.deployBranchFilter || '').trim().toLowerCase();
    if (q) {
      list = list.filter(d => {
        const ns = (d.namespace || '').toLowerCase();
        const id = (d.id || '').toLowerCase();
        return ns.includes(q) || id.includes(q);
      });
    }
    return list;
  }

  get deployStatTotal(): number { return this.history.length; }
  get deployStatRunning(): number {
    return this.history.filter(d => (d.status || '').toUpperCase() === 'RUNNING').length;
  }
  get deployStatInProgress(): number {
    return this.history.filter(d => {
      const s = (d.status || '').toUpperCase();
      return s === 'DEPLOYING' || s === 'PENDING';
    }).length;
  }
  get deployStatFailed(): number {
    return this.history.filter(d => (d.status || '').toUpperCase() === 'FAILED').length;
  }
  get deployStatStopped(): number {
    return this.history.filter(d => (d.status || '').toUpperCase() === 'STOPPED').length;
  }

  setDeployStatusFilter(f: DeployStatusFilter): void {
    this.deployStatusFilter = f;
  }

  clearDeployFilters(): void {
    this.deployStatusFilter = 'ALL';
    this.deployBranchFilter = '';
  }

  isCurrentDeployment(dep: AppDeployment): boolean {
    return !!this.app?.lastDeployment && this.app.lastDeployment.id === dep.id;
  }

  isDeployOnline(dep: AppDeployment): boolean {
    return (dep.status || '').toUpperCase() === 'RUNNING';
  }

  isDeployExpired(dep: AppDeployment): boolean {
    if (!dep.expiresAt) return false;
    const t = new Date(dep.expiresAt).getTime();
    return !Number.isNaN(t) && t <= Date.now();
  }

  deployStatusIcon(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'RUNNING') return '●';
    if (s === 'FAILED') return '✕';
    if (s === 'DEPLOYING' || s === 'PENDING') return '◌';
    if (s === 'STOPPED') return '○';
    return '·';
  }

  deployStatusLabel(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'RUNNING') return 'En ligne';
    if (s === 'FAILED') return 'Échec';
    if (s === 'DEPLOYING') return 'Déploiement';
    if (s === 'PENDING') return 'En attente';
    if (s === 'STOPPED') return 'Terminé';
    return status || '—';
  }

  deployStatusTone(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'RUNNING') return 'status-success';
    if (s === 'FAILED') return 'status-failed';
    if (s === 'DEPLOYING' || s === 'PENDING') return 'status-running';
    if (s === 'STOPPED') return 'status-canceled';
    return 'status-pending';
  }

  openDeployPipeline(dep: AppDeployment): void {
    if (!dep.gitlabPipelineId) return;
    this.router.navigate(['/projects', this.appId, 'pipeline-detail', String(dep.gitlabPipelineId)], {
      queryParams: { kind: 'DEPLOY' }
    });
  }

  historyStatusClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'running') return 'status-running';
    if (s === 'failed') return 'status-failed';
    if (s === 'stopped') return 'status-stopped';
    if (s === 'deploying' || s === 'pending') return 'status-deploying';
    return 'status-none';
  }

  serviceReadySummary(dep: AppDeployment): string {
    const services = dep.servicesState?.['services'];
    if (!services || typeof services !== 'object') return '—';
    const vals = Object.values(services as Record<string, { status?: string }>);
    if (!vals.length) return '—';
    const ready = vals.filter(v => (v?.status || '').toLowerCase() === 'ready').length;
    return `${ready}/${vals.length} ready`;
  }

  private scheduleEnvHistoryChart(): void {
    if (this.envHistoryChartTimer) clearTimeout(this.envHistoryChartTimer);
    this.envHistoryChartTimer = setTimeout(() => {
      this.ngZone.runOutsideAngular(() => this.renderEnvHistoryChart());
    }, 60);
  }

  private destroyEnvHistoryChart(): void {
    try {
      this.envHistoryChart?.destroy();
      if (this.envHistoryCanvas) Chart.getChart(this.envHistoryCanvas)?.destroy();
    } catch { /* ignore */ }
    this.envHistoryChart = undefined;
    this.hasEnvHistoryChart = false;
  }

  /** Succès = env en ligne / terminé proprement ; échec = FAILED. */
  private envHistoryOutcome(dep: AppDeployment): 'success' | 'failed' | 'other' {
    const s = (dep.status || '').toUpperCase();
    if (s === 'FAILED') return 'failed';
    if (s === 'RUNNING' || s === 'STOPPED') return 'success';
    return 'other';
  }

  private buildEnvHistorySeries(): { labels: string[]; success: number[]; failed: number[] } {
    const byDay = new Map<string, { success: number; failed: number }>();
    for (const d of this.history) {
      if (!d.createdAt) continue;
      const dt = new Date(d.createdAt);
      if (Number.isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      if (!byDay.has(key)) byDay.set(key, { success: 0, failed: 0 });
      const bucket = byDay.get(key)!;
      const outcome = this.envHistoryOutcome(d);
      if (outcome === 'success') bucket.success++;
      else if (outcome === 'failed') bucket.failed++;
    }
    const keys = [...byDay.keys()].sort();
    // Limiter aux 30 derniers jours avec activité (ou remplir si peu)
    const sliced = keys.length > 30 ? keys.slice(-30) : keys;
    return {
      labels: sliced.map(k => {
        const [, m, day] = k.split('-');
        return `${day}/${m}`;
      }),
      success: sliced.map(k => byDay.get(k)!.success),
      failed: sliced.map(k => byDay.get(k)!.failed)
    };
  }

  private renderEnvHistoryChart(): void {
    const canvas = this.envHistoryCanvas;
    if (!canvas || this.activeTab !== 'deployments') {
      this.hasEnvHistoryChart = false;
      return;
    }
    const series = this.buildEnvHistorySeries();
    if (!series.labels.length) {
      this.destroyEnvHistoryChart();
      return;
    }
    this.hasEnvHistoryChart = true;
    Chart.getChart(canvas)?.destroy();
    this.envHistoryChart?.destroy();
    this.envHistoryChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: series.labels,
        datasets: [
          {
            label: 'Succès',
            data: series.success,
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22, 163, 74, 0.12)',
            tension: 0.35,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2
          },
          {
            label: 'Échecs',
            data: series.failed,
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            tension: 0.35,
            fill: true,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, color: '#64748b' }
          },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, color: '#94a3b8', maxRotation: 0 }
          },
          y: {
            beginAtZero: true,
            ticks: {
              font: { size: 10 },
              color: '#94a3b8',
              precision: 0,
              stepSize: 1
            },
            grid: { color: 'rgba(148, 163, 184, 0.18)' }
          }
        }
      }
    });
  }

  // ---------- Pipelines app (agrégés) ----------

  loadAppPipelines(): void {
    const services = this.app?.services || [];
    if (!services.length) {
      this.appPipelines = [];
      this.appPipelinesError = null;
      this.appPipelinesLoading = false;
      return;
    }
    this.appPipelinesLoading = true;
    this.appPipelinesError = null;
    const kind = this.pipelineKindFilter === 'ALL' ? null : this.pipelineKindFilter;
    const calls = services
      .filter(s => !!s.id)
      .map(s =>
        this.pipelineApi.listPipelines(0, 50, s.id!, kind).pipe(
          catchError(() => of([] as PipelineListItem[]))
        )
      );
    if (!calls.length) {
      this.appPipelines = [];
      this.appPipelinesLoading = false;
      return;
    }
    forkJoin(calls).pipe(takeUntil(this.destroy$)).subscribe({
      next: (lists) => {
        const merged = lists.flat();
        const seen = new Set<string>();
        const dedup: PipelineListItem[] = [];
        for (const p of merged) {
          const key = `${p.pipelineId ?? ''}|${p.applicationId ?? ''}|${p.createdAt ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          dedup.push(p);
        }
        dedup.sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });
        this.shareStagesAcrossSamePipeline(dedup);
        this.appPipelines = dedup;
        this.appPipelinesLoading = false;
      },
      error: () => {
        this.appPipelinesError = 'Impossible de charger les pipelines.';
        this.appPipelinesLoading = false;
      }
    });
  }

  /**
   * Un lot multi-services = 1 pipeline GitLab, N exécutions.
   * Si une seule a stages_json (jobs), on les partage aux sœurs pour l'UI.
   */
  private shareStagesAcrossSamePipeline(items: PipelineListItem[]): void {
    const donor = new Map<number, PipelineListItem>();
    for (const p of items) {
      if (p.pipelineId == null) continue;
      if (p.jobs?.length) {
        const prev = donor.get(p.pipelineId);
        if (!prev || (prev.jobs?.length || 0) < p.jobs.length) {
          donor.set(p.pipelineId, p);
        }
      }
    }
    for (const p of items) {
      if (p.pipelineId == null) continue;
      const src = donor.get(p.pipelineId);
      if (!src || src === p) continue;
      if (!p.jobs?.length) p.jobs = src.jobs ? [...src.jobs] : [];
      if (!p.shortSha && src.shortSha) p.shortSha = src.shortSha;
      if (!p.webUrl && src.webUrl) p.webUrl = src.webUrl;
      if (!p.ref && src.ref) p.ref = src.ref;
      if (p.duration == null && src.duration != null) p.duration = src.duration;
    }
  }

  get filteredAppPipelines(): PipelineListItem[] {
    let list = [...this.appPipelines];
    if (this.pipelineIdFilter != null) {
      list = list.filter(p => p.pipelineId === this.pipelineIdFilter);
    }
    if (this.pipelineServiceFilter !== 'ALL') {
      list = list.filter(p => (p.applicationId || '') === this.pipelineServiceFilter);
    }
    const status = this.pipelineStatusFilter;
    if (status === 'SUCCESS') {
      list = list.filter(p => this.pipelineItemStatus(p) === 'SUCCESS');
    } else if (status === 'FAILED') {
      list = list.filter(p => ['FAILED', 'CANCELED'].includes(this.pipelineItemStatus(p)));
    } else if (status === 'RUNNING') {
      list = list.filter(p => ['RUNNING', 'PENDING'].includes(this.pipelineItemStatus(p)));
    }
    return list;
  }

  pipelineItemStatus(item: PipelineListItem): string {
    return (item.status || item.pipelineStatus || '').toUpperCase();
  }

  pipelineKindLabel(item: PipelineListItem): string {
    return (item.executionKind || 'SCAN').toUpperCase();
  }

  pipelineDisplayName(item: PipelineListItem): string {
    return item.serviceName || item.environmentName || 'service';
  }

  pipelineServiceName(item: PipelineListItem): string {
    if (item.serviceName) return item.serviceName;
    const svc = (this.app?.services || []).find(s => s.id === item.applicationId);
    return svc?.name || '—';
  }

  onPipelineKindChange(value: string): void {
    this.pipelineKindFilter = (value as PipelineKindFilter) || 'ALL';
    const q: Record<string, string> = {};
    if (this.pipelineKindFilter !== 'ALL') q['kind'] = this.pipelineKindFilter;
    if (this.pipelineIdFilter != null) q['pipelineId'] = String(this.pipelineIdFilter);
    this.router.navigate(['/projects', this.appId, 'pipelines'], { queryParams: q });
    this.loadAppPipelines();
  }

  onPipelineStatusChange(value: string): void {
    this.pipelineStatusFilter = (value as PipelineStatusFilter) || 'ALL';
  }

  onPipelineServiceChange(value: string): void {
    this.pipelineServiceFilter = value || 'ALL';
  }

  openPipeline(item: PipelineListItem): void {
    this.togglePipelineDetails(item);
  }

  pipelineCardKey(item: PipelineListItem): string {
    return `${item.pipelineId ?? ''}|${item.applicationId ?? ''}|${item.createdAt ?? ''}`;
  }

  isPipelineExpanded(item: PipelineListItem): boolean {
    return this.expandedPipelineKey === this.pipelineCardKey(item);
  }

  togglePipelineDetails(item: PipelineListItem): void {
    const key = this.pipelineCardKey(item);
    this.expandedPipelineKey = this.expandedPipelineKey === key ? null : key;
  }

  openPipelineFullPage(item: PipelineListItem, event?: Event): void {
    event?.stopPropagation();
    const kind = (item.executionKind || '').toUpperCase() === 'DEPLOY' ? 'DEPLOY' : 'SCAN';
    if (item.pipelineId) {
      try {
        localStorage.setItem('envirotest-last-pipeline-id', String(item.pipelineId));
        localStorage.setItem(`envirotest-last-pipeline-id:${this.appId}`, String(item.pipelineId));
        localStorage.setItem('envirotest-last-pipeline-kind', kind);
      } catch { /* ignore */ }
      this.router.navigate(['/projects', this.appId, 'pipeline-detail', String(item.pipelineId)], {
        queryParams: { kind }
      });
      return;
    }
    if (item.environmentId) {
      this.router.navigate(['/pipeline', item.environmentId], {
        queryParams: { appId: this.appId, kind }
      });
    }
  }

  jobDurationLabel(job: { duration?: number; durationSeconds?: number }): string {
    const sec = job.durationSeconds ?? job.duration;
    if (sec == null || sec < 0) return '';
    return this.formatPipelineDuration(sec);
  }

  cancelAppPipeline(item: PipelineListItem): void {
    if (!item.pipelineId || this.pipelineCancelingId != null) return;
    this.pipelineCancelingId = item.pipelineId;
    this.pipelineApi.cancelPipeline(item.pipelineId).subscribe({
      next: () => {
        this.pipelineCancelingId = null;
        this.loadAppPipelines();
      },
      error: () => {
        this.pipelineCancelingId = null;
        this.appPipelinesError = 'Impossible d\'annuler le pipeline';
      }
    });
  }

  formatPipelineAgo(iso: string | null | undefined): string {
    if (!iso) return '—';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '—';
    const diff = Math.max(0, Date.now() - t);
    const m = Math.floor(diff / 60000);
    if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `il y a ${h} h`;
    return `il y a ${Math.floor(h / 24)} j`;
  }

  formatPipelineDuration(sec: number | null | undefined): string {
    if (sec == null || sec < 0) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  isPipelineRunning(item: PipelineListItem): boolean {
    return ['RUNNING', 'PENDING'].includes(this.pipelineItemStatus(item));
  }

  // ---------- Helpers ----------

  databaseName(id?: string | null): string {
    if (!id) return '';
    return this.app?.databases.find((d) => d.id === id)?.name || '';
  }

  serviceName(id?: string | null): string {
    if (!id) return '';
    return this.app?.services.find((s) => s.id === id)?.name || '';
  }

  roleClass(role: string): string {
    return 'role-' + role.toLowerCase();
  }

  roleIcon(role: string): string {
    const r = (role || '').toUpperCase();
    if (r === 'FRONTEND') return 'F';
    if (r === 'BACKEND') return 'B';
    if (r === 'WORKER') return 'W';
    return 'S';
  }

  scanDefaultBranch(svc: AppServiceModel | null): string {
    return (svc?.gitBranch || 'main').trim() || 'main';
  }
}
