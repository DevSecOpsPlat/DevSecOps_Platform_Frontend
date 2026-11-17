import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, NgZone, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import Chart from 'chart.js/auto';
import { Observable, Subject, combineLatest, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, delay, distinctUntilChanged, map, shareReplay, switchMap, takeUntil, tap, timeout } from 'rxjs/operators';
import { ApplicationService } from '../../services/application/application.service';
import { EnvironmentService } from '../../services/environment/environment.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { FindingItem, FindingsService } from '../../services/findings/findings.service';
import { ApplicationResponse } from '../../models/application/application-response';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';
import {
  ENVIRONMENT_FILTER_OPTIONS,
  environmentStatusView,
  matchesEnvironmentFilter
} from '../../models/environment/status-types';
import { PipelineJobInfo } from '../../models/pipeline/pipeline-scan-response';
import { PipelineListItem } from '../../models/pipeline/pipeline-list-item';
import { CI_STAGE_ORDER } from '../../shared/ci-stage-order';
import { ProjectDeployModalComponent, ProjectDeployParams } from '../../application-management/project-deploy-modal/project-deploy-modal.component';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { DeployPreview, ManagedApp } from '../../models/application-management/application-management.models';
import { ToastService } from '../../services/ui/toast.service';
import { EtIconComponent, EtIconName } from '../../shared/et-icon/et-icon.component';
import {
  QualityGateEnvironmentOption,
  QualityGateResult,
  QualityGateService,
  QualityGateToolMetric,
  pickDefaultScanPipeline
} from '../../services/quality-gate/quality-gate.service';
import {
  ActivityItem,
  DashboardPipelineItem
} from '../../models/dashboard/dashboard.models';
import {
  DefectDojoDashboard2Response,
  DefectDojoDeployRecommendation,
  DefectDojoFindingItem,
  DefectDojoScanSnapshot,
  DefectDojoService,
  DefectDojoTimeSeriesPoint
} from '../../services/defectdojo/defectdojo.service';

export const GLOBAL_BRANCH = '__all__';

const SEV_BAR: Record<string, string> = {
  Critical: '#EF4444',
  High: '#F97316',
  Medium: '#EAB308',
  Low: '#3B82F6',
  Info: '#94A3B8',
  Total: '#1C1C2E'
};

const DEPLOY_CHART_COLORS = {
  success: '#22C55E',
  pending: '#F97316',
  failed: '#EF4444'
};

const DD_SEV_LINE_COLORS: Record<string, string> = {
  Critical: '#EF4444',
  High: '#F97316',
  Medium: '#EAB308',
  Low: '#3B82F6',
  Info: '#94A3B8'
};

const GRADE_COLORS: Record<string, string> = {
  A: '#16a34a',
  B: '#22c55e',
  C: '#f59e0b',
  D: '#f97316',
  E: '#dc2626'
};

const MATURITY_GRADE_SCALE = 'A · B · C · D · E';

interface SecurityScoreView {
  grade: string;
  score: number;
  summary: string;
}

const SECURITY_REQUEST_TIMEOUT_MS = 90_000;

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  hello: 'Accueil',
  setup: 'Setup / clone',
  clone: 'Clone / détection',
  'code-analysis': 'Code Analysis',
  'sonarqube-setup': 'Sonar — setup',
  'sonarqube-scan': 'Sonar — analyse',
  sca: 'Sca',
  'sca-trivy': 'SCA — Trivy',
  'sca-node': 'SCA — Node',
  'sca-python': 'SCA — Python',
  'sca-java': 'SCA — Java / Maven',
  'sca-owasp': 'SCA — OWASP Dependency-Check',
  sast: 'Sast',
  'sast-generic': 'SAST — Semgrep',
  'sast-angular': 'SAST — Angular / React',
  secrets: 'Secrets (Gitleaks)',
  'secrets-iac': 'Secrets / IaC',
  'secrets-lac': 'Secrets lac',
  container: 'Conteneur',
  iac: 'IaC (Checkov)',
  'license-node': 'Licences — Node',
  'license-python': 'Licences — Python',
  build: 'Build',
  'build-image': 'Build image',
  'container-scan': 'Scan image',
  'push-image': 'Push image',
  'deploy-k8s': 'Déploiement K8s',
  'zap-scan': 'Zap Scan',
  report: 'Reporting',
  reporting: 'Reporting',
  'security-validation': 'Security Validation',
  'schedule-delete': 'Planification suppression'
};

type PipelineStageStatus = 'done' | 'active' | 'pending' | 'failed';

interface RecentVulnerabilityRow {
  id: string | number;
  title: string;
  severity: string;
  toolLabel: string;
  source: 'defectdojo' | 'local';
  raw: DefectDojoFindingItem | FindingItem;
}

type DetectionType = 'SAST' | 'SCA' | 'IaC' | 'Secrets' | 'DAST' | 'Container' | 'Lint' | 'Autre';

type MaturityDeployVerdict = 'allow' | 'caution' | 'block' | 'unknown';

interface MaturityScanAnalysis {
  name: string;
  type: DetectionType;
  active: boolean;
  findingCount: number;
  status: 'ok' | 'warning' | 'alert' | 'inactive';
  summary: string;
  recommendation: string;
}

interface MaturityAnalysis {
  hasData: boolean;
  grade: string;
  score: number;
  scopeLabel: string;
  verdict: MaturityDeployVerdict;
  verdictTitle: string;
  verdictDetail: string;
  findings: string[];
  actions: string[];
  scanAnalyses: MaturityScanAnalysis[];
}

interface CiScannerDef {
  id: string;
  name: string;
  matchers: string[];
  icon: string;
  type: DetectionType;
  tooltip: string;
}

const CI_SCANNER_DEFS: CiScannerDef[] = [
  {
    id: 'trivy',
    name: 'Trivy FS',
    matchers: ['trivy', 'trivy fs'],
    icon: 'assets/scanners/trivy.svg',
    type: 'SCA',
    tooltip: 'Analyse des dépendances et des bibliothèques tierces (SCA) – couvre npm, pip, maven, gradle, go.mod, Gemfile, composer, Cargo.toml et NuGet.'
  },
  {
    id: 'semgrep',
    name: 'Semgrep',
    matchers: ['semgrep'],
    icon: 'assets/scanners/semgrep.svg',
    type: 'SAST',
    tooltip: 'Analyse statique du code source (SAST) – règles auto pour 30+ langages (JavaScript, Python, Java, Go, Ruby, PHP, C++, etc.).'
  },
  {
    id: 'hadolint',
    name: 'Hadolint',
    matchers: ['hadolint'],
    icon: 'assets/scanners/hadolint.svg',
    type: 'Lint',
    tooltip: 'Vérification des bonnes pratiques et des failles de configuration dans les Dockerfiles.'
  },
  {
    id: 'gitleaks',
    name: 'Gitleaks',
    matchers: ['gitleaks'],
    icon: 'assets/scanners/gitleaks.svg',
    type: 'Secrets',
    tooltip: 'Détection de secrets, clés API et credentials dans le code source (Gitleaks).'
  },
  {
    id: 'checkov',
    name: 'Checkov',
    matchers: ['checkov'],
    icon: 'assets/scanners/checkov.svg',
    type: 'IaC',
    tooltip: 'Analyse de sécurité des configurations Infrastructure-as-Code (Terraform, K8s, Helm, CloudFormation).'
  },
  {
    id: 'grype',
    name: 'Grype',
    matchers: ['grype', 'anchore grype'],
    icon: 'assets/scanners/grype.svg',
    type: 'Container',
    tooltip: 'Analyse des vulnérabilités dans les images conteneur (Grype) – packages OS et applications.'
  },
  {
    id: 'zap',
    name: 'OWASP ZAP',
    matchers: ['zap', 'owasp zap'],
    icon: 'assets/scanners/zap.svg',
    type: 'DAST',
    tooltip: 'Tests de sécurité dynamiques sur l\'application déployée (DAST) – détection de failles exploitables en production.'
  }
];

const TOOL_HINTS: [string, string][] = CI_SCANNER_DEFS.flatMap(def => [
  [def.id, def.tooltip] as [string, string],
  ...def.matchers.filter(m => m !== def.id).map(m => [m, def.tooltip] as [string, string])
]);

const DEFAULT_SCANNER_ICON = 'assets/scanners/default.svg';

/** SonarQube figure dans les outils du Quality Gate (pas dans DefectDojo) : carte dédiée dans l'indice de maturité. */
const SONAR_SCANNER_DEF: CiScannerDef = {
  id: 'sonarqube',
  name: 'SonarQube',
  matchers: ['sonarqube', 'sonar'],
  icon: DEFAULT_SCANNER_ICON,
  type: 'SAST',
  tooltip: 'Analyse de la qualité et de la sécurité du code (SonarQube).'
};

@Component({
  selector: 'app-project-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, ProjectDeployModalComponent, EtIconComponent],
  templateUrl: './project-overview.component.html',
  styleUrls: [
    './project-overview.component.css',
    '../security-dashboard/security-dashboard.component.css'
  ]
})
export class ProjectOverviewComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly securityReload$ = new Subject<{ appId: string; branch: string; pipelineId?: string | null }>();

  // Déploiement depuis la vue d'ensemble d'un service : même modal que la page de l'application.
  showDeployModal = false;
  deployManagedApp: ManagedApp | null = null;
  deployPreview: DeployPreview | null = null;
  deployPreviewLoading = false;
  deploying = false;
  deployError: string | null = null;
  private readonly deployPreviewTrigger$ = new Subject<{ branch: string; sessionDurationHours: number; serviceIds: string[] }>();

  /** Résultat Quality Gate (dernier pipeline de scan de la branche) : source unique de l'indice de maturité. */
  qgResult: QualityGateResult | null = null;
  qgLoading = false;
  private qgScopeKey = '';
  private readonly maturityQg$ = new Subject<{ appId: string; branch: string | null; pipelineId: string | null }>();
  /** Pipelines dont le résultat manquant a déjà été calculé une fois (comme la page Quality Gate). */
  private readonly qgAutoCaptured = new Set<string>();
  private deployDonutChart?: Chart;
  private weekBarChart?: Chart;
  private daySeverityChart?: Chart;
  private chartRenderTimer?: ReturnType<typeof setTimeout>;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private ttlCountdownInterval?: ReturnType<typeof setInterval>;

  @ViewChild('deployDonutCanvas') deployDonutCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('weekBarCanvas') weekBarCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('daySeverityCanvas') daySeverityCanvas?: ElementRef<HTMLCanvasElement>;

  readonly globalBranch = GLOBAL_BRANCH;
  readonly severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];

  openPicker: 'app' | 'branch' | 'env' | null = null;
  maturityPanelPinned = false;
  myApplications: ApplicationResponse[] = [];
  appsLoading = false;
  appId: string | null = null;
  selectedBranch = GLOBAL_BRANCH;
  /** Branche pour laquelle déploiements / pipelines ont été chargés en dernier. */
  private scopedDataBranch: string | null = null;
  private readonly defaultBranchByApp = new Map<string, string>();
  selectedEnvironmentId: string | null = null;
  selectedPipelineId: string | null = null;
  branches: string[] = [];
  toolList: { key: string; value: number }[] = [];
  hasOpenSeverityChart = false;
  openSeverityGranularity: 'hour' | 'day' | 'week' | 'month' = 'day';
  deploymentPeriod: 'day' | 'week' | 'month' = 'day';

  loading = false;
  error: string | null = null;
  infoMessage: string | null = null;
  dashboard: DefectDojoDashboard2Response | null = null;

  appName = '';
  appDetails: ApplicationResponse | null = null;
  latestDeployment: DeploymentHistoryItem | null = null;
  environmentSummary: EnvironmentSummaryResponse | null = null;
  loadingPipelineDetails = false;
  loadingScanPipelineDetails = false;
  latestDeployPipeline: PipelineListItem | null = null;
  latestScanPipeline: PipelineListItem | null = null;
  deployPipelineEver = false;
  scanPipelineEver = false;
  scanLaunching = false;
  scanLaunchError: string | null = null;
  private pipelineLivePollTimer?: ReturnType<typeof setInterval>;
  copied = false;
  remainingSeconds?: number;
  totalSeconds?: number;
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

  recentFindings: FindingItem[] = [];
  recentDojoFindings: DefectDojoFindingItem[] = [];
  recentFindingsLoading = false;
  deployRecommendation: DefectDojoDeployRecommendation | null = null;
  pipelineDrawerOpen = false;
  findingDrawerOpen = false;
  selectedFinding: FindingItem | null = null;
  hoveredSeverity: string | null = null;
  hoveredStage: PipelineJobInfo | null = null;
  copyLinkFeedback = false;
  nowMs = Date.now();
  totalEnvironmentsCreated = 0;
  weekDeployTrend = 0;
  weekSuccessTrend = 0;
  weekVulnTrend = 0;
  weekEnvTrend = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private defectDojoService: DefectDojoService,
    private applicationService: ApplicationService,
    private environmentService: EnvironmentService,
    private pipelineService: PipelineService,
    private findingsService: FindingsService,
    private ngZone: NgZone,
    private sanitizer: DomSanitizer,
    private appMgmt: ApplicationManagementService,
    private toastService: ToastService,
    private qualityGateService: QualityGateService
  ) {}

  ngOnInit(): void {
    this.deployPreviewTrigger$
      .pipe(debounceTime(250), takeUntil(this.destroy$))
      .subscribe(sel => this.fetchDeployPreview(sel));

    // Indice de maturité = résultat Quality Gate du pipeline de scan retenu (même règle que la page Quality Gate).
    this.maturityQg$.pipe(
      switchMap(({ appId, branch, pipelineId }) => {
        this.qgLoading = true;
        return this.qualityGateService.listScanPipelines(appId, branch).pipe(
          catchError(() => of([] as QualityGateEnvironmentOption[])),
          switchMap(pipes => {
            const requested = pipelineId ? pipes.find(p => p.pipelineId === pipelineId) : undefined;
            const pick = requested ?? (branch ? (pipes.find(p => !!p.pipelineId) ?? null) : pickDefaultScanPipeline(pipes));
            if (!pick?.pipelineId) {
              return of(null);
            }
            const pid = pick.pipelineId;
            const qgBranch = pick.branch || branch;
            return this.qualityGateService.getQualityGate(appId, qgBranch, null, false, pid).pipe(
              timeout(SECURITY_REQUEST_TIMEOUT_MS),
              switchMap(res => {
                // Résultat pas encore enregistré pour un pipeline terminé : le calculer une fois
                // (même comportement que la page Quality Gate), au lieu d'afficher « indisponible ».
                const status = (res?.pipelineStatus || '').toUpperCase();
                if (res?.verdictSource === 'SNAPSHOT_MISSING' && status !== 'RUNNING' && status !== 'PENDING'
                    && !this.qgAutoCaptured.has(pid)) {
                  this.qgAutoCaptured.add(pid);
                  return this.qualityGateService.getQualityGate(appId, qgBranch, null, true, pid).pipe(
                    timeout(SECURITY_REQUEST_TIMEOUT_MS),
                    catchError(() => of(res))
                  );
                }
                return of(res);
              }),
              catchError(() => of(null))
            );
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.qgResult = res;
      this.qgLoading = false;
    });

    const appId$ = this.route.parent!.paramMap.pipe(
      map(p => p.get('appId')),
      distinctUntilChanged()
    );
    // Sans ?branch= explicite : branche de travail du service (main en général). La vue
    // « Toutes les branches » reste accessible via ?branch=__all__ (sélecteur).
    const branch$ = combineLatest([appId$, this.route.queryParamMap]).pipe(
      switchMap(([id, qp]) => {
        const explicit = qp.get('branch');
        if (explicit) return of(explicit);
        return id ? this.serviceDefaultBranch$(id) : of(GLOBAL_BRANCH);
      }),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Libellés à jour tout de suite ; le rechargement des données suit (abonnement plus bas).
    branch$.pipe(takeUntil(this.destroy$)).subscribe(b => {
      this.selectedBranch = b;
    });

    this.securityReload$.pipe(
      switchMap(({ appId, branch, pipelineId }) => {
        const apiBranch = this.toApiBranch(branch);
        this.loading = true;
        this.destroyOpenSeverityChart();
        this.error = null;
        this.infoMessage = null;
        this.hasOpenSeverityChart = false;

        return this.defectDojoService.getDashboard2(appId, apiBranch, {
          pipelineId: pipelineId ?? undefined,
          scanOnly: true
        }).pipe(
          timeout(SECURITY_REQUEST_TIMEOUT_MS),
          catchError(err => {
            const msg = err?.name === 'TimeoutError'
              ? 'Le chargement des résultats de sécurité a dépassé 90 s — réessayez avec « Actualiser ».'
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
        this.loadRecentFindings();
        const showChart =
          (d.charts?.scanSnapshots?.length ?? 0) > 0
          || (d.charts?.detailedMetrics?.openDayToDayBySeverity?.length ?? 0) > 0;
        this.hasOpenSeverityChart = showChart;
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

    this.countdownTimer = setInterval(() => {
      this.nowMs = Date.now();
    }, 1000);

    appId$.pipe(takeUntil(this.destroy$)).subscribe(id => {
      this.appId = id;
      if (!id) return;
      this.loadOverview();
      this.loadMyApplications();
    });

    const pipelineId$ = this.route.queryParamMap.pipe(
      map(qp => qp.get('pipelineId')),
      distinctUntilChanged()
    );

    combineLatest([appId$, branch$, pipelineId$])
      .pipe(
        debounceTime(400),
        distinctUntilChanged((a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]),
        delay(800),
        takeUntil(this.destroy$)
      )
      .subscribe(([id, branch, pipelineId]) => {
        if (!id) return;
        this.selectedBranch = branch;
        this.selectedPipelineId = pipelineId;
        this.requestSecurityReload(id, branch, pipelineId);
        if (!this.overviewLoading && this.scopedDataBranch !== branch) {
          this.reloadBranchScopedData();
        }
      });
  }

  /** Branche de travail du service (champ git_branch), mise en cache par service. */
  private serviceDefaultBranch$(appId: string): Observable<string> {
    const cached = this.defaultBranchByApp.get(appId);
    if (cached) return of(cached);
    return this.applicationService.getApplicationById(appId).pipe(
      map(app => (app?.gitBranch || '').trim() || 'main'),
      catchError(() => of('main')),
      tap(b => this.defaultBranchByApp.set(appId, b))
    );
  }

  ngOnDestroy(): void {
    this.destroyDeployCharts();
    this.destroyOpenSeverityChart();
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.ttlCountdownInterval) clearInterval(this.ttlCountdownInterval);
    if (this.pipelineLivePollTimer) clearInterval(this.pipelineLivePollTimer);
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Profil déduit de l'historique pipeline (deploy / scan / les deux). */
  get serviceProfile(): 'full' | 'deploy-only' | 'scan-only' {
    if (this.scanPipelineEver && !this.deployPipelineEver) return 'scan-only';
    if (this.deployPipelineEver && !this.scanPipelineEver) return 'deploy-only';
    return 'full';
  }

  get showSecuritySection(): boolean {
    return this.serviceProfile !== 'deploy-only';
  }

  get isScanOnlyProfile(): boolean {
    return this.serviceProfile === 'scan-only';
  }

  get isDeployOnlyProfile(): boolean {
    return this.serviceProfile === 'deploy-only';
  }

  get ciScannerSummary(): Array<{ name: string; iconUrl: string; active: boolean; type: DetectionType; tooltip: string }> {
    const knownNames = new Set(CI_SCANNER_DEFS.map(d => d.name));
    const badges = CI_SCANNER_DEFS.map(def => ({
      name: def.name,
      iconUrl: def.icon,
      active: this.scannerHasExecuted(def.matchers),
      type: def.type,
      tooltip: def.tooltip
    }));

    for (const t of this.toolList) {
      const name = this.formatToolName(t.key);
      const matchedDef = this.matchScannerDef(t.key, name);
      if (matchedDef) continue;
      if (knownNames.has(name) || badges.some(b => b.name === name)) continue;
      badges.push({
        name,
        iconUrl: this.scannerIconUrl(t.key, name),
        active: true,
        type: this.classifyDetectionType(t.key || name),
        tooltip: this.toolDescription(t.key)
      });
    }

    return badges;
  }

  private matchScannerDef(key: string, name: string): CiScannerDef | undefined {
    const hay = `${key} ${name}`.toLowerCase();
    return CI_SCANNER_DEFS.find(def => def.matchers.some(m => hay.includes(m)));
  }

  detectionTypeClass(type: DetectionType): string {
    const map: Record<DetectionType, string> = {
      SAST: 'd2-sec-type--sast',
      SCA: 'd2-sec-type--sca',
      IaC: 'd2-sec-type--iac',
      Secrets: 'd2-sec-type--secrets',
      DAST: 'd2-sec-type--dast',
      Container: 'd2-sec-type--container',
      Lint: 'd2-sec-type--lint',
      Autre: 'd2-sec-type--other'
    };
    return map[type] ?? 'd2-sec-type--other';
  }

  private classifyDetectionType(scanType: string): DetectionType {
    const s = (scanType || '').toLowerCase();
    if (s.includes('hadolint')) return 'Lint';
    if (s.includes('grype') || s.includes('anchore')) return 'Container';
    if (s.includes('trivy') && s.includes('container')) return 'Container';
    if (s.includes('trivy') || s.includes('npm') || s.includes('pip') || s.includes('dependency') || s.includes('safety')) {
      return 'SCA';
    }
    if (s.includes('semgrep') || s.includes('eslint') || s.includes('bandit') || s.includes('sast')) return 'SAST';
    if (s.includes('gitleaks') || s.includes('secret') || s.includes('truffle')) return 'Secrets';
    if (s.includes('checkov') || s.includes('tfsec') || s.includes('iac')) return 'IaC';
    if (s.includes('zap') || s.includes('dast') || s.includes('burp')) return 'DAST';
    if (s.includes('container')) return 'Container';
    return 'Autre';
  }

  get activeScannerCount(): number {
    return this.ciScannerSummary.filter(s => s.active).length;
  }

  get totalSecurityOpen(): number {
    if (this.dashboard?.bySeverity) {
      return this.dashboard.totalOpen ?? this.totalFindings;
    }
    if (this.isGlobalView) return this.totalOpenVulnerabilities;
    return this.dashboard?.totalOpen ?? this.totalFindings;
  }

  get displayedHighCriticalCount(): number {
    if (this.dashboard?.bySeverity) {
      return this.openSeverityCount('Critical') + this.openSeverityCount('High');
    }
    return this.highCriticalVulnerabilityCount;
  }

  get hasMaturityScore(): boolean {
    return this.resolvedSecurityScore != null;
  }

  get maturityGradeScaleLabel(): string {
    return `Échelle : ${MATURITY_GRADE_SCALE}`;
  }

  /** Note et score repris tels quels du Quality Gate (aucun second calcul côté vue d'ensemble). */
  get resolvedSecurityScore(): SecurityScoreView | null {
    const qg = this.qgResult;
    const s = qg?.securityScore;
    if (!qg || !s?.grade) {
      return null;
    }
    return {
      grade: s.grade,
      score: s.score ?? 0,
      summary: qg.summary?.trim() || this.buildSecurityScoreSummary(s.grade)
    };
  }

  /** Sous-titre de la carte : quel scan est évalué. */
  get maturityScopeSub(): string {
    const qg = this.qgResult;
    if (qg?.branch) {
      return `Dernier scan · ${qg.branch}${qg.pipelineId ? ' · #' + qg.pipelineId : ''}`;
    }
    return this.isGlobalView ? 'Toutes les branches' : `Branche ${this.selectedBranch}`;
  }

  private get maturityScopeLabel(): string {
    const qg = this.qgResult;
    if (qg?.branch) {
      return `dernier scan de la branche ${qg.branch}${qg.pipelineId ? ` (pipeline #${qg.pipelineId})` : ''}`;
    }
    return this.isGlobalView ? 'toutes les branches' : `la branche ${this.selectedBranch}`;
  }

  /** Compteurs du Quality Gate, mêmes règles que la page Quality Gate. */
  get maturityCounts(): { total: number; critical: number; high: number; medium: number; low: number } {
    const qg = this.qgResult;
    if (!qg) {
      return { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
    }
    const sev = qg.metrics?.bySeverity ?? {};
    const tools = qg.toolMetrics ?? [];
    const fromTools = (k: 'critical' | 'high' | 'medium' | 'low') =>
      tools.reduce((n, t) => n + (t[k] ?? 0), 0);
    const pick = (k: 'critical' | 'high' | 'medium' | 'low') => sev[k] ?? fromTools(k);
    const sevSum = (sev['critical'] ?? 0) + (sev['high'] ?? 0) + (sev['medium'] ?? 0) + (sev['low'] ?? 0);
    const toolSum = fromTools('critical') + fromTools('high') + fromTools('medium') + fromTools('low');
    return {
      total: sevSum > 0 ? sevSum : (toolSum > 0 ? toolSum : (qg.metrics?.totalVulnerabilities ?? 0)),
      critical: qg.metrics?.combinedCritical ?? pick('critical'),
      high: pick('high'),
      medium: pick('medium'),
      low: sev['low'] ?? 0
    };
  }

  get displaySecurityGrade(): string {
    return this.resolvedSecurityScore?.grade ?? '—';
  }

  get displaySecurityScoreLabel(): string {
    if (!this.resolvedSecurityScore) return '—/100';
    return `${this.resolvedSecurityScore.score}/100`;
  }

  get displaySecuritySummary(): string {
    const summary = this.qgResult?.summary?.trim();
    if (summary) {
      return summary;
    }
    if (this.qgLoading) {
      return 'Lecture du résultat Quality Gate…';
    }
    return `Aucun scan terminé sur ce périmètre. Lancez un pipeline de scan pour obtenir une note (${MATURITY_GRADE_SCALE}).`;
  }

  get securityScorePercent(): number {
    return this.resolvedSecurityScore?.score ?? 0;
  }

  /**
   * Même verdict, même note et mêmes explications que la page Quality Gate :
   * « Pourquoi ce verdict ? » = verdictExplanation, « Conseils pratiques » = practicalAdvice.
   */
  get maturityAnalysis(): MaturityAnalysis {
    const qg = this.qgResult;
    const resolved = this.resolvedSecurityScore;
    const grade = resolved?.grade ?? '—';
    const score = resolved?.score ?? 0;
    const scopeLabel = this.maturityScopeLabel;
    const scanAnalyses = this.buildMaturityScanAnalyses();

    if (!qg) {
      return {
        hasData: false,
        grade,
        score,
        scopeLabel,
        verdict: 'unknown',
        verdictTitle: this.qgLoading ? 'Analyse en cours…' : 'Analyse indisponible',
        verdictDetail: this.qgLoading
          ? 'Lecture du dernier résultat Quality Gate de ce périmètre.'
          : 'Aucun pipeline de scan terminé sur ce périmètre. Lancez un scan avant de déployer.',
        findings: [],
        actions: this.qgLoading ? [] : ['Lancer un pipeline de scan sur la branche à déployer.'],
        scanAnalyses
      };
    }

    const c = this.maturityCounts;
    const findings: string[] = [
      resolved
        ? `Note ${grade} · score ${score}/100 — ${scopeLabel}.`
        : `Score de posture non calculé — ${scopeLabel}.`,
      `${c.total} vulnérabilité(s) : ${c.critical} critique(s), ${c.high} élevée(s), ${c.medium} moyenne(s), ${c.low} faible(s).`
    ];
    for (const line of qg.verdictExplanation ?? []) {
      const text = (line ?? '').trim();
      if (text && !findings.includes(text)) {
        findings.push(text);
      }
    }
    if (!(qg.verdictExplanation?.length)) {
      for (const v of qg.hardGateViolations ?? []) {
        findings.push(`Condition bloquante : ${v.message || v.label}`);
      }
    }

    const advice = qg.practicalAdvice?.length ? qg.practicalAdvice : (qg.detailedRecommendations ?? []);
    const actions = advice
      .map(a => (a ?? '').replace(/^\s*\d+\.\s*/, '').trim())
      .filter(a => !!a)
      .slice(0, 6);

    const inProgress = qg.verdictSource === 'PIPELINE_IN_PROGRESS';
    return {
      hasData: true,
      grade,
      score,
      scopeLabel,
      verdict: inProgress ? 'unknown' : this.maturityVerdictFromQg(qg.verdict),
      verdictTitle: inProgress ? 'Scan en cours' : this.qgVerdictLabel(qg.verdict),
      verdictDetail: qg.summary?.trim() || '',
      findings: findings.slice(0, 8),
      actions,
      scanAnalyses
    };
  }

  private maturityVerdictFromQg(verdict: string | null | undefined): MaturityDeployVerdict {
    switch (verdict) {
      case 'RECOMMENDED': return 'allow';
      case 'WITH_WARNINGS': return 'caution';
      case 'NOT_RECOMMENDED': return 'block';
      default: return 'unknown';
    }
  }

  /** Libellés identiques à la page Quality Gate. */
  private qgVerdictLabel(verdict: string | null | undefined): string {
    switch (verdict) {
      case 'RECOMMENDED': return 'Déployable';
      case 'WITH_WARNINGS': return 'Déployable avec surveillance';
      case 'NOT_RECOMMENDED': return 'Déploiement non recommandé';
      case 'INDETERMINE': return 'Vérification incomplète';
      default: return 'Verdict indisponible';
    }
  }

  maturityVerdictClass(verdict: MaturityDeployVerdict): string {
    const map: Record<MaturityDeployVerdict, string> = {
      allow: 'd2-sec-maturity-verdict--allow',
      caution: 'd2-sec-maturity-verdict--caution',
      block: 'd2-sec-maturity-verdict--block',
      unknown: 'd2-sec-maturity-verdict--unknown'
    };
    return map[verdict] ?? map.unknown;
  }

  maturityScanStatusClass(status: MaturityScanAnalysis['status']): string {
    return `d2-sec-maturity-scan--${status}`;
  }

  toggleMaturityPanel(event: Event): void {
    event.stopPropagation();
    this.maturityPanelPinned = !this.maturityPanelPinned;
  }

  onMaturityTooltipWheel(event: WheelEvent): void {
    event.stopPropagation();
  }

  @HostListener('document:click')
  closeMaturityPanel(): void {
    this.maturityPanelPinned = false;
  }

  private buildSecurityScoreSummary(grade: string): string {
    switch (grade) {
      case 'A':
        return 'Aucune vulnérabilité critique ou élevée ouverte.';
      case 'B':
        return 'Quelques vulnérabilités élevées, aucune critique.';
      case 'C':
        return 'Risque modéré — prioriser les corrections critiques.';
      case 'D':
        return 'Risque élevé — plusieurs failles critiques ouvertes.';
      case 'E':
        return 'Risque critique — action immédiate requise.';
      default:
        return 'Posture sécurité calculée à partir des vulnérabilités ouvertes.';
    }
  }

  /** Une carte par outil, avec les compteurs « outils » du Quality Gate (mêmes chiffres que sa page). */
  private buildMaturityScanAnalyses(): MaturityScanAnalysis[] {
    const qg = this.qgResult;
    const tools = qg?.toolMetrics ?? [];
    const defs: CiScannerDef[] = [...CI_SCANNER_DEFS, SONAR_SCANNER_DEF];
    return defs.map(def => {
      const metric = tools.find(t => {
        const hay = `${t.id} ${t.label}`.toLowerCase();
        return t.id === def.id || def.matchers.some(m => hay.includes(m));
      });
      const inactiveReason = this.toolInactiveReason(def, metric);
      if (inactiveReason) {
        return this.buildSingleScannerAnalysis(def, false, 0, inactiveReason);
      }
      const count = def.id === 'sonarqube'
        ? (metric!.critical ?? 0) + (metric!.high ?? 0)
        : (metric!.total ?? 0);
      return this.buildSingleScannerAnalysis(def, true, count);
    });
  }

  /** null = outil exécuté et évaluable ; sinon la raison affichée. */
  private toolInactiveReason(def: CiScannerDef, metric: QualityGateToolMetric | undefined): string | null {
    if (!this.qgResult) {
      return `${def.name} : aucun résultat Quality Gate sur ce périmètre.`;
    }
    if (!metric) {
      return `${def.name} n'apparaît pas dans le dernier scan.`;
    }
    if (def.id === 'zap' && this.qgResult.metrics?.dastApplicable === false) {
      return 'OWASP ZAP ne s\'exécute que sur un pipeline de déploiement (application en ligne).';
    }
    if (metric.evaluable === false) {
      return `${def.name} : job en échec, aucun rapport exploitable.`;
    }
    if ((metric.stageStatus || '').toUpperCase() === 'SKIPPED') {
      return `${def.name} n'a pas été exécuté dans ce pipeline.`;
    }
    return null;
  }

  private buildSingleScannerAnalysis(
    def: CiScannerDef, active: boolean, findingCount: number, inactiveReason?: string): MaturityScanAnalysis {
    if (!active) {
      return {
        name: def.name,
        type: def.type,
        active: false,
        findingCount: 0,
        status: 'inactive',
        summary: inactiveReason || `${def.name} n'a pas été exécuté sur ce périmètre.`,
        recommendation: def.id === 'zap'
          ? 'Déployez l\'application pour obtenir l\'analyse dynamique.'
          : 'Relancez un pipeline de scan incluant cet outil avant un déploiement.'
      };
    }

    if (findingCount === 0) {
      return {
        name: def.name,
        type: def.type,
        active: true,
        findingCount: 0,
        status: 'ok',
        summary: `${def.name} : aucune vulnérabilité ouverte détectée.`,
        recommendation: 'Aucune action requise pour ce scanner.'
      };
    }

    const status = this.scannerAnalysisStatus(def, findingCount);
    const { summary, recommendation } = this.scannerAnalysisMessages(def, findingCount);

    return {
      name: def.name,
      type: def.type,
      active: true,
      findingCount,
      status,
      summary,
      recommendation
    };
  }

  private scannerAnalysisStatus(def: CiScannerDef, count: number): MaturityScanAnalysis['status'] {
    if (def.type === 'Secrets' || def.id === 'sonarqube') return 'alert';
    if (def.type === 'DAST' && count > 0) return count >= 3 ? 'alert' : 'warning';
    if (count >= 5) return 'alert';
    return 'warning';
  }

  private scannerAnalysisMessages(def: CiScannerDef, count: number): { summary: string; recommendation: string } {
    const n = count;
    const plural = n > 1 ? 's' : '';
    switch (def.id) {
      case 'trivy':
        return {
          summary: `Trivy FS : ${n} vulnérabilité${plural} dans vos dépendances (npm, pip, Maven, etc.).`,
          recommendation: 'Mettez à jour ou remplacez les bibliothèques affectées, puis relancez le pipeline SCA.'
        };
      case 'semgrep':
        return {
          summary: `Semgrep : ${n} faille${plural} dans le code source (injections, XSS, mauvaises pratiques…).`,
          recommendation: 'Corrigez le code signalé avant déploiement ; priorisez les findings Critical et High.'
        };
      case 'hadolint':
        return {
          summary: `Hadolint : ${n} problème${plural} de configuration ou de sécurité dans le Dockerfile.`,
          recommendation: 'Appliquez les bonnes pratiques Docker (utilisateur non-root, tag fixe, .dockerignore) avant le build.'
        };
      case 'gitleaks':
        return {
          summary: `Gitleaks : ${n} secret${plural} ou credential${plural} exposé${plural} dans le dépôt.`,
          recommendation: 'Révoquez immédiatement les clés concernées, purgez l\'historique Git et ne déployez pas cette version.'
        };
      case 'checkov':
        return {
          summary: `Checkov : ${n} mauvaise${plural} configuration${plural} IaC (Terraform, K8s, Helm…).`,
          recommendation: 'Corrigez les ressources cloud/K8s (accès publics, privilèges, secrets en clair) avant déploiement.'
        };
      case 'grype':
        return {
          summary: `Grype : ${n} CVE${plural} dans l'image conteneur (OS et packages système).`,
          recommendation: 'Reconstruisez l\'image avec une base à jour et des correctifs de sécurité appliqués.'
        };
      case 'zap':
        return {
          summary: `OWASP ZAP : ${n} faille${plural} dynamique${plural} sur l'application déployée (XSS, headers, cookies…).`,
          recommendation: 'Corrigez les failles exploitables en runtime avant toute mise en production.'
        };
      case 'sonarqube':
        return {
          summary: `SonarQube : ${n} problème${plural} bloquant${plural} ou critique${plural} dans le code.`,
          recommendation: 'Corrigez les problèmes bloquants et critiques signalés par SonarQube avant le déploiement.'
        };
      default:
        return {
          summary: `${def.name} : ${n} finding${plural} ouvert${plural}.`,
          recommendation: 'Consultez le détail dans DefectDojo et traitez les findings par ordre de sévérité.'
        };
    }
  }

  get securityKpis(): Array<{
    label: string;
    value: string | number;
    color: string;
    sub?: string;
  }> {
    const crit = this.openSeverityCount('Critical');
    const high = this.openSeverityCount('High');
    const medium = this.openSeverityCount('Medium');
    const low = this.openSeverityCount('Low');
    const info = this.openSeverityCount('Info');
    return [
      {
        label: 'Ouvertes',
        value: this.loading ? '…' : this.totalSecurityOpen,
        color: '#F97316'
      },
      {
        label: 'Critiques',
        value: this.loading ? '…' : crit,
        color: SEV_BAR['Critical']
      },
      {
        label: 'Élevées',
        value: this.loading ? '…' : high,
        color: SEV_BAR['High']
      },
      {
        label: 'Medium',
        value: this.loading ? '…' : medium,
        color: SEV_BAR['Medium']
      },
      {
        label: 'Low',
        value: this.loading ? '…' : low,
        color: SEV_BAR['Low']
      },
      {
        label: 'Info',
        value: this.loading ? '…' : info,
        color: SEV_BAR['Info']
      }
    ];
  }

  get isGlobalView(): boolean {
    return this.selectedBranch === GLOBAL_BRANCH;
  }

  get scopeLabel(): string {
    return this.isGlobalView
      ? 'Toutes les branches (vue globale)'
      : `Branche : ${this.selectedBranch}`;
  }

  get deploymentScopeLabel(): string {
    return this.isGlobalView ? 'toutes branches' : `branche ${this.selectedBranch}`;
  }

  get activeEnvCount(): number {
    return this.displayedEnvironmentCards.length;
  }

  get branchPathLabel(): string {
    return this.isGlobalView ? 'Toutes les branches' : this.selectedBranch;
  }

  get envPathLabel(): string {
    if (this.selectedEnvironmentId) {
      const env = this.environmentsForApp.find(e => e.id === this.selectedEnvironmentId);
      return env?.environmentName || 'Environnement';
    }
    return `${this.allActiveEnvironmentCards.length} actif(s)`;
  }

  get environmentFilteredDeployments(): DeploymentHistoryItem[] {
    if (!this.selectedEnvironmentId) return this.deployments;
    return this.deployments.filter(d => String(d.environmentId) === this.selectedEnvironmentId);
  }

  get displayLatestDeployment(): DeploymentHistoryItem | null {
    const deps = this.environmentFilteredDeployments;
    return deps.length > 0 ? deps[0] : null;
  }

  /** URL publique de l'app (résumé env ou dernier déploiement filtré). */
  get liveDeploymentUrl(): string | null {
    const fromSummary = (this.environmentSummary?.previewUrl || '').trim();
    const fromHistory = (this.displayLatestDeployment?.deploymentUrl || '').trim();
    const candidate = fromSummary || fromHistory;
    if (!candidate) return null;
    if (!this.canDisplayDeploymentUrl(candidate)) return null;
    return candidate;
  }

  get trustedEmbedUrl(): SafeResourceUrl | null {
    const u = this.liveDeploymentUrl;
    return u ? this.sanitizer.bypassSecurityTrustResourceUrl(u) : null;
  }

  /** Lien ouvrable dans un nouvel onglet (URL présente et session non expirée). */
  get canOpenDeploymentPreview(): boolean {
    const dep = this.displayLatestDeployment;
    if (!dep || this.isLatestEnvExpired) return false;
    const envStatus = (dep.environmentStatus || '').toUpperCase();
    return envStatus === 'RUNNING' && !!this.liveDeploymentUrl;
  }

  get latestPreviewUnavailableTitle(): string {
    const dep = this.displayLatestDeployment;
    if (!dep) return 'Aperçu indisponible';
    if (this.isLatestEnvExpired) return 'Session expirée';
    if ((dep.environmentStatus || '').toUpperCase() === 'FAILED') return 'Aucune URL — déploiement en échec';
    return 'Aperçu indisponible';
  }

  get latestPreviewUnavailableMessage(): string {
    const dep = this.displayLatestDeployment;
    if (!dep) return 'Aucune URL de prévisualisation n\'a été publiée pour cet environnement.';
    if (this.isLatestEnvExpired) {
      return 'La session éphémère est terminée. Relancez un déploiement pour obtenir une nouvelle URL.';
    }
    if ((dep.environmentStatus || '').toUpperCase() === 'FAILED') {
      return 'Aucune URL — le déploiement n\'a jamais abouti. Ouvrez le pipeline pour diagnostiquer le job en échec.';
    }
    return 'Aucune URL de prévisualisation n\'a été publiée pour cet environnement.';
  }

  get displayRecentPipelines(): DashboardPipelineItem[] {
    if (!this.selectedEnvironmentId) return this.recentPipelines;
    return this.recentPipelines.filter(p => String(p.environmentId) === this.selectedEnvironmentId);
  }

  get chartDeploymentCounts(): {
    total: number;
    success: number;
    pending: number;
    failed: number;
    skipped: number;
  } {
    return this.countPipelineChartStatuses(this.getChartDeployments());
  }

  /** KPI du bandeau haut — statuts environnement K8s. */
  get environmentKpiCounts(): {
    total: number;
    online: number;
    inProgress: number;
    failed: number;
    ended: number;
  } {
    const deps = this.selectedEnvironmentId
      ? this.environmentFilteredDeployments
      : this.deployments;
    return this.countEnvironmentKpis(deps);
  }

  get displayDeploymentCounts(): {
    total: number;
    success: number;
    pending: number;
    failed: number;
    skipped: number;
  } {
    const deps = this.selectedEnvironmentId
      ? this.environmentFilteredDeployments
      : this.deployments;
    return this.countPipelineChartStatuses(deps);
  }

  get displayedEnvironmentCards(): Array<{
    id: string;
    name: string;
    branch: string;
    timeRemaining: string;
    vulnCount: number | null;
  }> {
    const cards = this.activeEnvironmentCards;
    if (this.isGlobalView) {
      return cards;
    }
    return cards.filter(e => e.branch === this.selectedBranch);
  }

  get allActiveEnvironmentCards(): Array<{
    id: string;
    name: string;
    branch: string;
    status: string;
    statusLabel: string;
    timeRemaining: string;
    expiresAt: unknown;
    vulnCount: number | null;
  }> {
    let envs = (this.environmentsForApp || [])
      .filter(e => matchesEnvironmentFilter(e.status, 'ACTIVE'));
    if (!this.isGlobalView) {
      envs = envs.filter(e => (e.gitBranch || 'main') === this.selectedBranch);
    }
    if (this.selectedEnvironmentId) {
      envs = envs.filter(e => e.id === this.selectedEnvironmentId);
    }
    return envs.map(e => ({
      id: e.id,
      name: e.environmentName || 'Environnement',
      branch: e.gitBranch || '—',
      status: (e.status || '').toUpperCase(),
      statusLabel: environmentStatusView(e.status).label,
      timeRemaining: this.calculateTimeRemaining(e.expiresAt),
      expiresAt: e.expiresAt,
      vulnCount: this.envCountsLoading ? null : (this.envVulnCounts[e.id] ?? 0)
    }));
  }

  readonly envStatusFilterOptions = ENVIRONMENT_FILTER_OPTIONS;

  get activeEnvironmentCards(): Array<{
    id: string;
    name: string;
    branch: string;
    timeRemaining: string;
    vulnCount: number | null;
  }> {
    return this.allActiveEnvironmentCards.slice(0, 4);
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

  get successRate(): number {
    const env = this.environmentKpiCounts;
    if (!env.total) return 0;
    return Math.round((env.online / env.total) * 100);
  }

  get overviewStats(): Array<{
    label: string;
    value: number | string;
    color: string;
    trend?: string;
    filter?: string | null;
  }> {
    const env = this.environmentKpiCounts;
    const depPending = this.loadingSlow;
    const scope = this.isGlobalView ? '' : ` · ${this.selectedBranch}`;
    const vulnValue = this.dashboard?.bySeverity
      ? (this.loading ? '…' : this.totalSecurityOpen)
      : (this.isGlobalView ? this.totalOpenVulnerabilities : (this.loading ? '…' : this.totalFindings));
    const vulnTrend = this.displayedHighCriticalCount > 0
      ? `Crit./Élevées: ${this.displayedHighCriticalCount}`
      : undefined;

    return [
      {
        label: `Total${scope}`,
        value: depPending ? '…' : env.total,
        color: '#3B82F6',
        filter: null
      },
      {
        label: `En ligne${scope}`,
        value: depPending ? '…' : env.online,
        color: '#22C55E',
        trend: depPending ? undefined : (env.total ? `${Math.round(env.online / env.total * 100)}%` : '0%'),
        filter: 'ACTIVE'
      },
      {
        label: `En cours${scope}`,
        value: depPending ? '…' : env.inProgress,
        color: '#F97316',
        filter: 'IN_PROGRESS'
      },
      {
        label: `Échec${scope}`,
        value: depPending ? '…' : env.failed,
        color: '#EF4444',
        filter: 'NEVER_STARTED'
      },
      {
        label: `Terminés${scope}`,
        value: depPending ? '…' : env.ended,
        color: '#6B7280',
        filter: 'ENDED'
      },
      {
        label: `Vulnérabilités${scope}`,
        value: vulnValue,
        color: '#8B5CF6',
        trend: vulnTrend
      }
    ];
  }

  get qualityGate(): {
    passed: boolean;
    branch: string;
    criticalCount: number;
    threshold: number;
    message: string;
  } {
    const threshold = this.deployRecommendation?.criticalThreshold ?? 5;
    const criticalCount = this.deployRecommendation?.criticalCount
      ?? (this.dashboard?.bySeverity
        ? this.severityCount('Critical')
        : (this.isGlobalView
          ? (this.vulnerabilityStatsBySeverity['CRITICAL'] ?? 0)
          : this.severityCount('Critical')));
    const passed = this.deployRecommendation
      ? this.deployRecommendation.deployRecommended
      : criticalCount <= threshold;
    const branch = this.isGlobalView
      ? (this.latestDeployment?.gitBranch || this.branches[0] || 'main')
      : this.selectedBranch;
    const message = passed
      ? 'Toutes les branches passent le quality gate'
      : `Branche ${branch} — ${criticalCount} critiques détectées (seuil : ${threshold})`;
    return { passed, branch, criticalCount, threshold, message };
  }

  get deploymentDonutLegend(): Array<{ label: string; value: number; color: string; pct: number }> {
    const c = this.chartDeploymentCounts;
    const total = Math.max(c.total, 1);
    return [
      { label: 'Réussis', value: c.success, color: DEPLOY_CHART_COLORS.success, pct: Math.round(c.success / total * 100) },
      { label: 'En attente', value: c.pending, color: DEPLOY_CHART_COLORS.pending, pct: Math.round(c.pending / total * 100) },
      { label: 'Échoués', value: c.failed, color: DEPLOY_CHART_COLORS.failed, pct: Math.round(c.failed / total * 100) }
    ];
  }

  get deploymentMetricsBar(): Array<{ label: string; value: number; cssClass: string }> {
    const c = this.displayDeploymentCounts;
    return [
      { label: 'Réussis', value: c.success, cssClass: 'd2-dep-metric--success' },
      { label: 'En attente', value: c.pending, cssClass: 'd2-dep-metric--pending' },
      { label: 'Échoués', value: c.failed, cssClass: 'd2-dep-metric--failed' },
      { label: 'Ignorés', value: c.skipped, cssClass: 'd2-dep-metric--skipped' },
      { label: 'Total', value: c.total, cssClass: 'd2-dep-metric--total' }
    ];
  }

  get deploymentChartSubtitle(): string {
    const parts: string[] = [];
    if (this.isGlobalView) parts.push('Toutes branches');
    else parts.push(`Branche ${this.selectedBranch}`);
    if (this.selectedEnvironmentId) {
      const env = this.environmentsForApp.find(e => e.id === this.selectedEnvironmentId);
      parts.push(env?.environmentName || 'Environnement filtré');
    }
    parts.push(this.deploymentPeriodLabel);
    return parts.join(' · ');
  }

  get deploymentChartHint(): string {
    return 'Réussi = environnement passé en ligne au moins une fois';
  }

  get deploymentPeriodLabel(): string {
    switch (this.deploymentPeriod) {
      case 'week':
        return '8 dernières semaines calendaires';
      case 'month':
        return '6 derniers mois';
      default:
        return '7 derniers jours';
    }
  }

  get severityBarMax(): number {
    return Math.max(...this.severities.map(s => this.openSeverityCount(s)), 1);
  }

  get pipelineStagesWithStatus(): Array<{ name: string; status: PipelineStageStatus }> {
    return this.buildPipelineStages(this.latestDeployPipeline?.jobs, 'deploy');
  }

  get scanPipelineStagesWithStatus(): Array<{ name: string; status: PipelineStageStatus }> {
    return this.buildPipelineStages(this.latestScanPipeline?.jobs, 'scan');
  }

  private buildPipelineStages(
    jobs: PipelineJobInfo[] | undefined | null,
    kind: 'scan' | 'deploy'
  ): Array<{ name: string; status: PipelineStageStatus }> {
    if (!jobs?.length) return [];

    const stageJobs = new Map<string, PipelineJobInfo[]>();
    jobs.forEach(job => {
      const stage = (job.stage || job.name || 'unknown').toLowerCase();
      if (!stageJobs.has(stage)) {
        stageJobs.set(stage, []);
      }
      stageJobs.get(stage)?.push(job);
    });

    // Étapes réellement présentes dans CE pipeline, dans l'ordre du .gitlab-ci.yml. Un modèle figé
    // affichait par exemple « Scan image » (grisé) sur un déploiement, alors que Grype ne tourne
    // plus dans le flux deploy, et masquait build / scan d'image / validation sur un scan.
    const present = CI_STAGE_ORDER.filter(stage => stageJobs.has(stage));
    const template = present.length ? present : this.stageTemplateForKind(kind);
    return template.map(stageName => {
      const stageJobList = stageJobs.get(stageName) ?? [];
      return {
        name: this.formatStageName(stageName),
        status: this.statusFromStageJobs(stageJobList)
      };
    });
  }

  get safePreviewUrl(): SafeResourceUrl | null {
    const url = this.latestPreviewUrl;
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  }

  deploymentStatusPillClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'd2-hero-pill--success';
    if (s === 'FAILED' || s === 'CANCELED') return 'd2-hero-pill--danger';
    if (s === 'RUNNING' || s === 'PENDING') return 'd2-hero-pill--warning';
    return 'd2-hero-pill--muted';
  }

  get latestPreviewUrl(): string | null {
    const dep = this.displayLatestDeployment;
    if (!dep) return null;
    if (dep.deploymentUrl?.trim()) return dep.deploymentUrl.trim();
    const env = this.environmentsForApp.find(e => e.id === dep.environmentId);
    return env?.previewUrl?.trim() || null;
  }

  get isLatestEnvExpired(): boolean {
    const dep = this.displayLatestDeployment;
    if (!dep) return true;
    const st = (dep.environmentStatus || '').toUpperCase();
    if (st === 'EXPIRED') return true;
    const ms = this.parseBackendInstantMs(dep.expiresAt);
    return ms != null && ms <= this.nowMs;
  }

  get latestTtlProgress(): number {
    const dep = this.displayLatestDeployment;
    if (!dep?.expiresAt || !dep.createdAt) return 0;
    const start = this.safeParseDate(dep.createdAt)?.getTime() ?? 0;
    const end = this.parseBackendInstantMs(dep.expiresAt) ?? 0;
    if (!start || !end || end <= start) return 0;
    const elapsed = this.nowMs - start;
    const total = end - start;
    return Math.max(0, Math.min(100, 100 - (elapsed / total) * 100));
  }

  openSeverityCount(sev: string): number {
    if (this.dashboard?.bySeverity) {
      return this.severityCount(sev);
    }
    if (this.isGlobalView) {
      const map: Record<string, string> = {
        Critical: 'CRITICAL', High: 'HIGH', Medium: 'MEDIUM', Low: 'LOW', Info: 'INFO'
      };
      return this.vulnerabilityStatsBySeverity[map[sev]] ?? 0;
    }
    return this.severityCount(sev);
  }

  severityBarWidth(sev: string): number {
    return Math.round((this.openSeverityCount(sev) / this.severityBarMax) * 100);
  }

  scannerActive(key: string): boolean {
    return this.toolList.some(t => t.key.toLowerCase().includes(key) && t.value > 0);
  }

  get openSeverityChartSubtitle(): string {
    switch (this.openSeverityGranularity) {
      case 'hour':
        return 'Open by Severity · dernier scan connu par heure';
      case 'day':
        return this.isGlobalView
          ? 'Open Day to Day · tout le produit · un point par jour'
          : 'Open Day to Day · branche sélectionnée · un point par jour';
      case 'week':
        return 'Open by Severity · dernier état connu par semaine';
      case 'month':
        return 'Open by Severity · dernier état connu par mois';
      default:
        return 'Évolution des vulnérabilités ouvertes par sévérité';
    }
  }

  setOpenSeverityGranularity(granularity: 'hour' | 'day' | 'week' | 'month'): void {
    if (this.openSeverityGranularity === granularity) return;
    this.openSeverityGranularity = granularity;
    this.ngZone.runOutsideAngular(() => this.renderOpenSeverityChart());
  }

  setDeploymentPeriod(period: 'day' | 'week' | 'month'): void {
    if (this.deploymentPeriod === period) return;
    this.deploymentPeriod = period;
    this.scheduleDeployChartsRender();
  }

  private getScanSnapshots(): DefectDojoScanSnapshot[] {
    return this.dashboard?.charts?.scanSnapshots ?? [];
  }

  private scheduleOpenSeverityChartRender(): void {
    if (this.chartRenderTimer) clearTimeout(this.chartRenderTimer);
    this.chartRenderTimer = setTimeout(() => {
      this.ngZone.runOutsideAngular(() => this.renderOpenSeverityChart());
    }, 120);
  }

  private destroyOpenSeverityChart(): void {
    this.ngZone.runOutsideAngular(() => {
      if (this.daySeverityChart) {
        this.daySeverityChart.destroy();
        this.daySeverityChart = undefined;
      }
      const canvas = this.daySeverityCanvas?.nativeElement;
      if (canvas) {
        Chart.getChart(canvas)?.destroy();
      }
    });
  }

  private renderOpenSeverityChart(): void {
    const canvas = this.daySeverityCanvas?.nativeElement;
    const snapshots = this.getScanSnapshots();
    const dayToDay = this.dashboard?.charts?.detailedMetrics?.openDayToDayBySeverity;
    const hasData = (snapshots?.length ?? 0) > 0 || (dayToDay?.length ?? 0) > 0;
    if (!canvas || !hasData || this.loading) return;

    const wrap = canvas.parentElement;
    if (!wrap || wrap.clientWidth === 0) return;

    Chart.getChart(canvas)?.destroy();
    this.daySeverityChart?.destroy();

    canvas.width = wrap.clientWidth;
    canvas.height = 280;

    const sorted = this.resolveSeverityChartSnapshots(snapshots ?? []);

    const granularity = this.openSeverityGranularity;
    const labels = sorted.map(s => this.formatSeverityChartLabel(s, granularity));

    const maxTicks = granularity === 'hour' ? 24 : granularity === 'day' ? 18 : 10;
    const yMax = Math.max(
      ...sorted.flatMap(s => this.severities.map(sev => s.bySeverity?.[sev] || 0)),
      1
    );
    const yStep = this.niceChartStepSize(yMax);

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
                  const day = this.snapshotDayKey(snap);
                  return day ? this.formatDayLabel(day) : (snap.label || '');
                }
                return this.formatSeverityChartLabel(snap, granularity);
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

  private formatSeverityChartLabel(s: DefectDojoScanSnapshot, granularity: string): string {
    if (granularity === 'week' || granularity === 'month') {
      return s.label || '—';
    }
    if (granularity === 'hour') {
      const hourKey = this.snapshotHourKey(s);
      return hourKey ? this.formatHourLabel(hourKey) : (s.label || '—');
    }
    const day = this.snapshotDayKey(s);
    return day ? this.formatDayLabel(day) : (s.label || '—');
  }

  private niceChartStepSize(maxValue: number): number {
    if (maxValue <= 10) return 1;
    if (maxValue <= 25) return 5;
    if (maxValue <= 75) return 25;
    if (maxValue <= 150) return 25;
    return Math.ceil(maxValue / 5 / 10) * 10;
  }

  private formatDayLabel(isoDay: string): string {
    const p = isoDay.split('-');
    return p.length === 3 ? `${p[0]}/${p[1]}/${p[2]}` : isoDay;
  }

  private resolveSeverityChartSnapshots(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
    const sorted = [...snapshots].sort((a, b) =>
      (a.timestamp || a.date || '').localeCompare(b.timestamp || b.date || '')
    );

    if (this.openSeverityGranularity === 'week') {
      const fromMetrics = this.dashboard?.charts?.detailedMetrics?.weekToWeekBySeverity;
      if (fromMetrics?.length) {
        return fromMetrics.map(p => ({
          testId: 0,
          scanType: 'Semaine',
          label: this.formatWeekPeriodLabel(p.period),
          bySeverity: p.bySeverity ?? {},
          totalOpen: Object.values(p.bySeverity ?? {}).reduce((s, n) => s + (n || 0), 0)
        }));
      }
      return this.aggregateSnapshotsByWeek(sorted);
    }

    if (this.openSeverityGranularity === 'month') {
      const fromMetrics = this.dashboard?.charts?.detailedMetrics?.openDayToDayBySeverity;
      if (fromMetrics?.length) {
        return this.aggregateDayMetricsByMonth(fromMetrics);
      }
      return this.aggregateSnapshotsByMonth(sorted);
    }

    if (this.openSeverityGranularity === 'hour') {
      return this.aggregateSnapshotsByHour(sorted);
    }

    if (this.openSeverityGranularity === 'day') {
      const fromMetrics = this.dashboard?.charts?.detailedMetrics?.openDayToDayBySeverity;
      if (fromMetrics?.length) {
        return this.prependZeroBaselineDay(this.mapDayToDayMetricsToSnapshots(fromMetrics));
      }
      return this.prependZeroBaselineDay(
        this.fillAllDaysForward(this.aggregateSnapshotsByDay(sorted))
      );
    }

    return sorted;
  }

  /** Ajoute un jour à zéro avant le premier point pour ancrer le graphique à 0. */
  private prependZeroBaselineDay(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
    if (!snapshots.length) return snapshots;
    const firstDay = this.snapshotDayKey(snapshots[0]) || snapshots[0].date?.slice(0, 10);
    if (!firstDay) return snapshots;
    const prevDay = this.addDaysIso(firstDay, -1);
    if (snapshots.some(s => this.snapshotDayKey(s) === prevDay)) {
      return snapshots;
    }
    return [this.buildZeroDaySnapshot(prevDay), ...snapshots];
  }

  private buildZeroDaySnapshot(day: string): DefectDojoScanSnapshot {
    const bySeverity = Object.fromEntries(this.severities.map(sev => [sev, 0]));
    return {
      testId: 0,
      scanType: 'Jour',
      label: this.formatDayLabel(day),
      date: day,
      timestamp: day,
      totalOpen: 0,
      bySeverity
    };
  }

  private addDaysIso(isoDay: string, delta: number): string {
    const d = this.safeParseDate(isoDay);
    if (!d) return isoDay;
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    next.setDate(next.getDate() + delta);
    return this.formatLocalDay(next);
  }

  /** Convertit la série backend Open Day to Day (tous les jours) en snapshots chart. */
  private mapDayToDayMetricsToSnapshots(points: DefectDojoTimeSeriesPoint[]): DefectDojoScanSnapshot[] {
    return points.map(p => ({
      testId: 0,
      scanType: 'Jour',
      label: this.formatDayLabel(p.period),
      date: p.period,
      timestamp: p.period,
      totalOpen: this.severities.reduce((s, sev) => s + (p.bySeverity?.[sev] ?? 0), 0),
      bySeverity: { ...(p.bySeverity ?? {}) }
    }));
  }

  /** Remplit chaque jour calendaire entre le premier snapshot et aujourd'hui (forward-fill). */
  private fillAllDaysForward(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
    if (!snapshots.length) return snapshots;

    const byDay = new Map<string, DefectDojoScanSnapshot>();
    for (const s of snapshots) {
      const key = this.snapshotDayKey(s);
      if (key) byDay.set(key, s);
    }

    const sortedKeys = [...byDay.keys()].sort();
    const firstDay = sortedKeys[0];
    const today = this.formatLocalDay(new Date());
    const timeline = this.expandDayRange(firstDay, today);

    const emptySeverity = (): Record<string, number> =>
      Object.fromEntries(this.severities.map(sev => [sev, 0]));

    let last: DefectDojoScanSnapshot | null = null;
    return timeline.map(day => {
      const snap = byDay.get(day);
      if (snap) last = snap;
      const bySeverity = last?.bySeverity ?? emptySeverity();
      return {
        testId: 0,
        scanType: 'Jour',
        label: this.formatDayLabel(day),
        date: day,
        timestamp: day,
        totalOpen: this.severities.reduce((s, sev) => s + (bySeverity[sev] ?? 0), 0),
        bySeverity: { ...bySeverity }
      };
    });
  }

  private formatLocalDay(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private expandDayRange(startDay: string, endDay: string): string[] {
    const start = this.safeParseDate(startDay);
    const end = this.safeParseDate(endDay);
    if (!start || !end) return [startDay];

    const from = start.getTime() <= end.getTime() ? new Date(start) : new Date(end);
    const to = start.getTime() <= end.getTime() ? new Date(end) : new Date(start);
    const days: string[] = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const limit = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    while (cursor.getTime() <= limit.getTime()) {
      days.push(this.formatLocalDay(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return days.length ? days : [startDay];
  }

  /** Agrège les snapshots par jour calendaire ; conserve le plus récent de chaque journée. */
  private aggregateSnapshotsByDay(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
    const buckets = new Map<string, DefectDojoScanSnapshot>();
    for (const s of snapshots) {
      const key = this.snapshotDayKey(s);
      if (!key) continue;
      const prev = buckets.get(key);
      if (!prev || this.getSnapshotSortKey(s) > this.getSnapshotSortKey(prev)) {
        buckets.set(key, {
          ...s,
          date: key,
          label: this.formatDayLabel(key)
        });
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, snap]) => snap);
  }

  /** Agrège par heure ; conserve le snapshot le plus récent de chaque heure. */
  private aggregateSnapshotsByHour(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
    const buckets = new Map<string, DefectDojoScanSnapshot>();
    for (const s of snapshots) {
      const key = this.snapshotHourKey(s);
      if (!key) continue;
      const prev = buckets.get(key);
      if (!prev || this.getSnapshotSortKey(s) > this.getSnapshotSortKey(prev)) {
        buckets.set(key, {
          ...s,
          timestamp: `${key}:00:00`,
          label: this.formatHourLabel(key)
        });
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, snap]) => snap);
  }

  private snapshotDayKey(s: DefectDojoScanSnapshot): string | null {
    if (s.date && /^\d{4}-\d{2}-\d{2}/.test(s.date)) {
      return s.date.slice(0, 10);
    }
    const d = this.parseSnapshotDate(s);
    if (!d) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private snapshotHourKey(s: DefectDojoScanSnapshot): string | null {
    const raw = s.timestamp || s.date;
    if (!raw) return null;
    if (raw.length >= 13 && raw.includes('T')) {
      return raw.substring(0, 13);
    }
    const d = this.parseSnapshotDate(s);
    if (!d) return null;
    const day = this.snapshotDayKey(s);
    if (!day) return null;
    return `${day}T${String(d.getHours()).padStart(2, '0')}`;
  }

  private aggregateSnapshotsByWeek(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
    const buckets = new Map<string, DefectDojoScanSnapshot>();
    for (const s of snapshots) {
      const d = this.parseSnapshotDate(s);
      if (!d) continue;
      const key = this.startOfWeek(d).toISOString().slice(0, 10);
      const prev = buckets.get(key);
      if (!prev || this.getSnapshotSortKey(s) > this.getSnapshotSortKey(prev)) {
        buckets.set(key, s);
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, s]) => ({
        ...s,
        label: this.formatWeekPeriodLabel(key)
      }));
  }

  private aggregateSnapshotsByMonth(snapshots: DefectDojoScanSnapshot[]): DefectDojoScanSnapshot[] {
    const buckets = new Map<string, DefectDojoScanSnapshot>();
    for (const s of snapshots) {
      const d = this.parseSnapshotDate(s);
      if (!d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const prev = buckets.get(key);
      if (!prev || this.getSnapshotSortKey(s) > this.getSnapshotSortKey(prev)) {
        buckets.set(key, s);
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, s]) => ({
        ...s,
        label: this.formatMonthPeriodLabel(key)
      }));
  }

  private aggregateDayMetricsByMonth(
    points: DefectDojoTimeSeriesPoint[]
  ): DefectDojoScanSnapshot[] {
    const buckets = new Map<string, DefectDojoTimeSeriesPoint>();
    for (const p of points) {
      const d = this.safeParseDate(p.period);
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
        label: this.formatMonthPeriodLabel(key),
        bySeverity: p.bySeverity ?? {},
        totalOpen: Object.values(p.bySeverity ?? {}).reduce((s, n) => s + (n || 0), 0)
      }));
  }

  private parseSnapshotDate(s: DefectDojoScanSnapshot): Date | null {
    const raw = s.timestamp || s.date;
    return raw ? this.safeParseDate(raw) : null;
  }

  private getSnapshotSortKey(s: DefectDojoScanSnapshot): string {
    return s.timestamp || s.date || '';
  }

  private formatWeekPeriodLabel(period: string): string {
    const d = this.safeParseDate(period.length === 10 ? period : period.slice(0, 10));
    if (!d) return period;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `Sem. ${day}/${month}`;
  }

  private formatMonthPeriodLabel(key: string): string {
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const [year, month] = key.split('-');
    const idx = Number(month) - 1;
    if (!year || idx < 0 || idx > 11) return key;
    return `${monthNames[idx]} ${year}`;
  }

  private formatHourLabel(isoHour: string): string {
    const [datePart, hourPart] = isoHour.split('T');
    if (!datePart || hourPart == null) return isoHour;
    const p = datePart.split('-');
    if (p.length !== 3) return isoHour;
    return `${p[0]}/${p[1]}/${p[2]} ${hourPart}:00`;
  }

  private onEnvironmentFilterChange(): void {
    setTimeout(() => this.scheduleDeployChartsRender(), 0);
    this.refreshLatestDeploymentDetails();
  }

  trendLabel(trend: number): string {
    if (trend === 0) return 'vs semaine dernière';
    const arrow = trend > 0 ? '↑' : '↓';
    return `${arrow} ${Math.abs(trend)}% vs semaine dernière`;
  }

  trendClass(trend: number): string {
    if (trend > 0) return 'd2-trend-up';
    if (trend < 0) return 'd2-trend-down';
    return 'd2-trend-neutral';
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
      ['anchore grype', 'Grype'],
      ['grype', 'Grype'],
      ['checkov', 'Checkov'],
      ['gitleaks', 'Gitleaks'],
      ['hadolint', 'Hadolint'],
      ['semgrep', 'Semgrep'],
      ['trivy', 'Trivy FS'],
      ['zap', 'OWASP ZAP'],
      ['owasp zap', 'OWASP ZAP'],
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

  scannerIconUrl(key: string, name?: string): string {
    const hay = `${key} ${name ?? this.formatToolName(key)}`.toLowerCase();
    for (const def of CI_SCANNER_DEFS) {
      if (def.matchers.some(m => hay.includes(m))) return def.icon;
    }
    return DEFAULT_SCANNER_ICON;
  }

  private findToolForScanner(matchers: string[]): { key: string; value: number } | undefined {
    return this.toolList.find(t => {
      const hay = `${t.key} ${this.formatToolName(t.key)}`.toLowerCase();
      return matchers.some(m => hay.includes(m));
    });
  }

  /**
   * "Cet outil a-t-il tourné ?" -- à utiliser pour active/inactive (jamais findToolForScanner /
   * toolList, qui excluent les entrées à 0 finding et confondent donc "a tourné, rien trouvé"
   * avec "n'a jamais tourné").
   */
  private scannerHasExecuted(matchers: string[]): boolean {
    const executed = this.dashboard?.toolsExecuted;
    if (!executed?.length) {
      // Repli : pas de signal dédié disponible (dashboard non scopé pipeline, etc.) -- se rabat
      // sur l'ancien comportement plutôt que de tout marquer "non exécuté" à tort.
      return !!this.findToolForScanner(matchers);
    }
    return executed.some(key => {
      const hay = `${key} ${this.formatToolName(key)}`.toLowerCase();
      return matchers.some(m => hay.includes(m));
    });
  }

  formatTtlRemaining(): string {
    if (this.isLatestEnvExpired) return 'Expiré';
    const dep = this.displayLatestDeployment;
    if (!dep?.expiresAt) return '—';
    return this.calculateTimeRemaining(dep.expiresAt);
  }

  private formatStageName(stage: string): string {
    if (!stage) return 'Unknown';
    const mapped = PIPELINE_STAGE_LABELS[stage.trim().toLowerCase()];
    if (mapped) return mapped;
    let formatted = stage.replace(/[-_]/g, ' ');
    formatted = formatted.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    return formatted;
  }

  toolBarWidth(value: number): number {
    return Math.round((value / this.toolListMax) * 100);
  }

  toolDescription(key: string): string {
    const lower = (key || '').toLowerCase();
    for (const [needle, hint] of TOOL_HINTS) {
      if (lower.includes(needle)) return hint;
    }
    if (lower.includes('bandit')) {
      return 'Analyse statique Python (SAST) – détection de failles dans le code source.';
    }
    if (lower.includes('dependency-check')) {
      return 'Analyse des dépendances OWASP (SCA) – détection de CVEs dans les bibliothèques tierces.';
    }
    return 'Scanner de sécurité alimenté par le pipeline CI/CD via DefectDojo.';
  }

  selectBranch(branch: string): void {
    if (this.selectedBranch === branch || this.loading) return;
    this.destroyOpenSeverityChart();
    if (this.selectedEnvironmentId && branch !== GLOBAL_BRANCH) {
      const env = this.environmentsForApp.find(e => e.id === this.selectedEnvironmentId);
      if (env && (env.gitBranch || 'main') !== branch) {
        this.selectedEnvironmentId = null;
      }
    }
    if (branch === GLOBAL_BRANCH) {
      this.selectedEnvironmentId = null;
    }
    this.selectedBranch = branch;
    this.closeAllPickers();
    this.onBranchChange();
    this.reloadBranchScopedData();
  }

  selectBranchFromPicker(branch: string): void {
    this.closeAllPickers();
    this.selectBranch(branch);
  }

  toggleAppPicker(event: Event): void {
    event.stopPropagation();
    const next = this.openPicker === 'app' ? null : 'app';
    this.openPicker = next;
    if (next === 'app') {
      this.loadMyApplications(true);
    }
  }

  toggleBranchPicker(event: Event): void {
    event.stopPropagation();
    this.openPicker = this.openPicker === 'branch' ? null : 'branch';
  }

  toggleEnvPicker(event?: Event): void {
    event?.stopPropagation();
    this.openPicker = this.openPicker === 'env' ? null : 'env';
  }

  closeAllPickers(): void {
    this.openPicker = null;
  }

  switchApplication(app: ApplicationResponse): void {
    if (!app?.id || app.id === this.appId) {
      this.closeAllPickers();
      return;
    }
    this.closeAllPickers();
    this.selectedEnvironmentId = null;
    this.selectedBranch = GLOBAL_BRANCH;
    this.router.navigate(['/project', app.id, 'overview'], { queryParams: { branch: null } });
  }

  loadMyApplications(force = false): void {
    if (!force && (this.myApplications.length > 0 || this.appsLoading)) return;
    this.appsLoading = true;
    this.applicationService.getMyApplications().pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$)
    ).subscribe(apps => {
      this.myApplications = apps || [];
      this.appsLoading = false;
    });
  }

  selectEnvFromPath(env: { id: string; branch: string }): void {
    this.closeAllPickers();
    if (env.branch && env.branch !== '—' && this.selectedBranch !== env.branch) {
      this.destroyOpenSeverityChart();
      this.selectedBranch = env.branch;
      this.onBranchChange();
      this.reloadBranchScopedData();
    }
    this.selectedEnvironmentId = env.id;
    this.onEnvironmentFilterChange();
  }

  selectAllEnvironmentsFilter(): void {
    this.closeAllPickers();
    this.selectedEnvironmentId = null;
    this.onEnvironmentFilterChange();
  }

  scrollToEnvironments(): void {
    this.closeAllPickers();
    this.scrollTo('d2-environments');
  }

  goToSecuritySection(): void {
    this.closeAllPickers();
    this.viewSecurityDashboard();
  }

  selectBranchFromEnv(branch: string): void {
    if (!branch || branch === '—') return;
    this.selectBranch(branch);
  }

  deployOnSelectedBranch(): void {
    // Ouvre le modal de déploiement de l'application du service (l'ancienne route
    // /environment-create redirigeait vers la liste des projets).
    if (!this.appId) return;
    this.deployError = null;
    this.deployPreview = null;
    this.appMgmt.getDeployContext(this.appId).pipe(
      switchMap(ctx => {
        if (!ctx?.managedApplicationId) {
          throw new Error('Ce service ne fait pas encore partie d’une application gérée.');
        }
        return this.appMgmt.get(ctx.managedApplicationId);
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: app => {
        if (!app?.services?.length) {
          this.toastService.push('error', 'Déploiement impossible', 'Ajoutez au moins un service à l’application.');
          return;
        }
        this.deployManagedApp = app;
        this.showDeployModal = true;
      },
      error: e => this.toastService.push('error', 'Déploiement impossible',
        e?.error?.message || e?.message || 'Application introuvable.')
    });
  }

  get deployDefaultBranch(): string {
    if (!this.isGlobalView && this.selectedBranch) return this.selectedBranch;
    return this.deployManagedApp?.services?.[0]?.gitBranch || 'main';
  }

  closeDeployModal(): void {
    if (this.deploying) return;
    this.showDeployModal = false;
    this.deployPreview = null;
    this.deployError = null;
  }

  onDeploySelectionChange(sel: { branch: string; sessionDurationHours: number; serviceIds: string[] }): void {
    this.deployPreviewTrigger$.next(sel);
  }

  private fetchDeployPreview(sel: { branch: string; sessionDurationHours: number; serviceIds: string[] }): void {
    const app = this.deployManagedApp;
    if (!this.showDeployModal || !app) return;
    if (!sel.serviceIds.length) {
      this.deployPreview = null;
      this.deployPreviewLoading = false;
      return;
    }
    this.deployPreviewLoading = true;
    this.appMgmt.previewDeploy(app.id, sel).pipe(takeUntil(this.destroy$)).subscribe({
      next: preview => {
        this.deployPreview = preview;
        this.deployPreviewLoading = false;
      },
      error: e => {
        this.deployPreviewLoading = false;
        this.deployError = e?.error?.message || 'Impossible d\'analyser la sélection.';
      }
    });
  }

  confirmDeploy(params: ProjectDeployParams): void {
    const app = this.deployManagedApp;
    if (!app) return;
    this.deploying = true;
    this.deployError = null;
    this.appMgmt.deploy(app.id, {
      branch: params.branch,
      sessionDurationHours: params.sessionDurationHours,
      serviceIds: params.serviceIds
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: dep => {
        this.deploying = false;
        this.showDeployModal = false;
        this.deployPreview = null;
        this.toastService.push('success', 'Déploiement lancé', 'Le pipeline de déploiement démarre.');
        const pid = dep?.gitlabPipelineId;
        if (pid) {
          this.viewPipelineById(pid, params.branch, 'DEPLOY');
        } else {
          this.refreshAll();
        }
      },
      error: e => {
        this.deploying = false;
        this.deployError = e?.error?.message || 'Déploiement impossible.';
      }
    });
  }

  goToApplications(): void {
    try {
      const managedId = localStorage.getItem('envirotest-last-managed-app-id');
      if (managedId) {
        this.router.navigate(['/projects', managedId, 'dashboard']);
        return;
      }
    } catch { /* ignore */ }
    this.router.navigate(['/projects']);
  }

  navigateToSeverity(sev: string): void {
    if (!this.appId) return;
    const queryParams: Record<string, string> = { severity: sev };
    if (!this.isGlobalView) queryParams['branch'] = this.selectedBranch;
    this.router.navigate(['/project', this.appId, 'security-dashboard'], { queryParams });
  }

  openPipelineDrawer(): void {
    this.pipelineDrawerOpen = true;
  }

  closePipelineDrawer(): void {
    this.pipelineDrawerOpen = false;
  }

  get displayRecentVulnerabilities(): RecentVulnerabilityRow[] {
    if (this.recentDojoFindings.length) {
      return this.recentDojoFindings.map(f => ({
        id: f.id,
        title: f.title || f.cwe || 'Finding',
        severity: f.severity || 'Info',
        toolLabel: f.toolName || f.scanType || f.testTitle || 'scan',
        source: 'defectdojo' as const,
        raw: f
      }));
    }
    return this.recentFindings.map(f => ({
      id: f.id,
      title: f.title || f.ruleId || 'Finding',
      severity: f.severity || 'Info',
      toolLabel: f.toolName || f.scanType || 'scan',
      source: 'local' as const,
      raw: f
    }));
  }

  openRecentFinding(row: RecentVulnerabilityRow): void {
    if (row.source === 'defectdojo') {
      if (!this.appId) return;
      const queryParams = this.isGlobalView ? {} : { branch: this.selectedBranch, category: 'open' };
      this.router.navigate(['/project', this.appId, 'overview', 'finding', row.id], { queryParams });
      return;
    }
    this.openFindingDrawer(row.raw as FindingItem);
  }

  openFindingDrawer(finding: FindingItem): void {
    this.selectedFinding = finding;
    this.findingDrawerOpen = true;
  }

  closeFindingDrawer(): void {
    this.findingDrawerOpen = false;
    this.selectedFinding = null;
  }

  openLiveDeployment(): void {
    if (!this.canOpenDeploymentPreview) return;
    const u = this.liveDeploymentUrl;
    if (u) window.open(u, '_blank', 'noopener,noreferrer');
  }

  copyPreviewUrl(): void {
    if (!this.canOpenDeploymentPreview) return;
    const u = this.liveDeploymentUrl;
    if (!u) return;
    navigator.clipboard?.writeText(u).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    });
  }

  openPreviewUrl(): void {
    const url = this.latestPreviewUrl;
    if (url) window.open(url, '_blank', 'noopener');
  }

  copyPreviewLink(): void {
    this.copyPreviewUrl();
  }

  getPipelineStagesWithStatus(): Array<{ name: string; status: PipelineStageStatus }> {
    return this.pipelineStagesWithStatus;
  }

  pipelineStageCount(status: PipelineStageStatus): number {
    return this.pipelineStagesWithStatus.filter(s => s.status === status).length;
  }

  totalSeverityCount(bySeverity?: Record<string, number> | null): number {
    if (!bySeverity) return 0;
    return this.severities.reduce((sum, sev) => sum + (bySeverity[sev] ?? 0), 0);
  }

  hexToRgb(hex: string): string {
    const normalized = (hex || '').replace('#', '').trim();
    const h = normalized.length === 3
      ? normalized.split('').map(c => c + c).join('')
      : normalized;
    if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) {
      return '0, 0, 0';
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r}, ${g}, ${b}`;
  }

  formatRemaining(): string {
    if (this.remainingSeconds != null && !Number.isNaN(this.remainingSeconds)) {
      const sec = this.remainingSeconds;
      if (sec <= 0) return 'Expiré';
      if (sec < 60) return `${sec}s`;
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      if (m < 60) return `${m}m ${s}s`;
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return `${h}h ${rm}m`;
    }
    if (this.isLatestEnvExpired) return 'Expiré';
    const dep = this.displayLatestDeployment;
    if (dep?.expiresAt) return this.calculateTimeRemaining(dep.expiresAt);
    return '—';
  }

  ttlProgressPercent(): number {
    const total = this.totalSeconds;
    const rem = this.remainingSeconds;
    if (total != null && total > 0 && rem != null && !Number.isNaN(rem) && !Number.isNaN(total)) {
      return Math.min(100, Math.max(0, (rem / total) * 100));
    }
    if (this.isLatestEnvExpired) return 0;
    return this.latestTtlProgress;
  }

  loadLatestPipelineDetails(): void {
    this.refreshDeployPipelineLive();
  }

  private refreshDeployPipelineLive(): void {
    const pipe = this.latestDeployPipeline;
    if (!pipe?.pipelineId || !this.appId) {
      return;
    }

    this.loadingPipelineDetails = true;
    this.pipelineService.getPipelineAndScanLiveById(pipe.pipelineId, this.appId).pipe(
      catchError(() => of(null)),
      takeUntil(this.destroy$)
    ).subscribe(details => {
      if (details) {
        pipe.jobs = details.jobs ?? pipe.jobs;
        pipe.pipelineStatus = details.status || pipe.pipelineStatus;
        this.latestDeployPipeline = { ...pipe };
        const dep = this.displayLatestDeployment;
        if (dep && details.jobs?.length) {
          dep.jobs = details.jobs;
          dep.pipelineStatus = details.status || dep.pipelineStatus;
          this.deployments = [...this.deployments];
        }
      }
      this.loadingPipelineDetails = false;
      this.syncPipelineLivePolling();
    });
  }

  private refreshScanPipelineLive(): void {
    const pipe = this.latestScanPipeline;
    if (!pipe?.pipelineId || !this.appId) {
      return;
    }

    this.loadingScanPipelineDetails = true;
    this.pipelineService.getPipelineAndScanLiveById(pipe.pipelineId, this.appId).pipe(
      catchError(() => of(null)),
      takeUntil(this.destroy$)
    ).subscribe(details => {
      if (details) {
        pipe.jobs = details.jobs ?? pipe.jobs;
        pipe.pipelineStatus = details.status || pipe.pipelineStatus;
        this.latestScanPipeline = { ...pipe };
        if (details.status && this.isPipelineOpen(details.status)) {
          this.selectedPipelineId = String(pipe.pipelineId);
          this.requestSecurityReload(this.appId!, this.isGlobalView ? GLOBAL_BRANCH : this.selectedBranch, String(pipe.pipelineId));
        }
      }
      this.loadingScanPipelineDetails = false;
      this.syncPipelineLivePolling();
    });
  }

  launchScanPipeline(): void {
    if (!this.appId || this.scanLaunching) return;
    this.scanLaunching = true;
    this.scanLaunchError = null;
    const branch = this.isGlobalView ? undefined : this.selectedBranch;
    this.applicationService.triggerScan(this.appId, branch).pipe(
      catchError(err => {
        this.scanLaunchError = err?.error?.message || 'Impossible de lancer le scan';
        this.scanLaunching = false;
        return of(null);
      }),
      takeUntil(this.destroy$)
    ).subscribe(res => {
      this.scanLaunching = false;
      if (res) {
        this.applicationService.clearDeploymentsCache(this.appId!);
        this.loadDeploymentsAndPipelines();
        if (this.appId) {
          this.requestSecurityReload(this.appId, this.isGlobalView ? GLOBAL_BRANCH : this.selectedBranch);
        }
        const pid = res.gitlabPipelineId;
        if (pid && this.appId) {
          try {
            localStorage.setItem('envirotest-last-pipeline-id', String(pid));
            localStorage.setItem(`envirotest-last-pipeline-id:${this.appId}`, String(pid));
            localStorage.setItem('envirotest-last-pipeline-kind', 'SCAN');
          } catch { /* ignore */ }
          this.router.navigate(['/project', this.appId, 'pipeline-detail', String(pid)], {
            queryParams: { kind: 'SCAN' }
          });
        } else if (this.appId) {
          this.router.navigate(['/project', this.appId, 'pipeline-detail'], {
            queryParams: { kind: 'SCAN' }
          });
        }
      }
    });
  }

  viewDeployPipelineDetails(): void {
    // Toujours par l'identifiant GitLab : la page de détail reste dans la mise en page du service
    // (même barre latérale). L'ancienne route /pipeline/:envId sortait du service et restait
    // bloquée sur « Chargement du pipeline… » pour les déploiements d'applications gérées.
    const pipe = this.latestDeployPipeline;
    if (pipe?.pipelineId) {
      this.viewPipelineById(pipe.pipelineId, pipe.gitBranch, 'DEPLOY');
      return;
    }
    const dep = this.displayLatestDeployment;
    if (dep?.pipelineId) {
      this.viewPipelineById(dep.pipelineId, dep.gitBranch, 'DEPLOY');
      return;
    }
    if (pipe?.environmentId) {
      this.viewPipeline(pipe.environmentId, 'DEPLOY');
    }
  }

  /** Ligne « Pipelines récents » : détail dans la mise en page du service. */
  openRecentPipeline(p: DashboardPipelineItem): void {
    const kind = (p.kind || '').toUpperCase();
    const k = kind === 'SCAN' || kind === 'DEPLOY' ? (kind as 'SCAN' | 'DEPLOY') : undefined;
    if (p.id) {
      this.viewPipelineById(p.id, p.branch, k);
      return;
    }
    if (p.environmentId) {
      this.viewPipeline(p.environmentId, k);
    }
  }

  viewScanPipelineDetails(): void {
    const pipe = this.latestScanPipeline;
    if (!pipe?.pipelineId) return;
    this.viewPipelineById(pipe.pipelineId, pipe.gitBranch, 'SCAN');
  }

  private isPipelineOpen(status: string | undefined | null): boolean {
    const s = (status || '').toUpperCase();
    return s === 'RUNNING' || s === 'PENDING';
  }

  private syncPipelineLivePolling(): void {
    if (this.pipelineLivePollTimer) {
      clearInterval(this.pipelineLivePollTimer);
      this.pipelineLivePollTimer = undefined;
    }
    const deployOpen = this.isPipelineOpen(this.latestDeployPipeline?.pipelineStatus);
    const scanOpen = this.isPipelineOpen(this.latestScanPipeline?.pipelineStatus);
    if (!deployOpen && !scanOpen) {
      return;
    }
    this.pipelineLivePollTimer = setInterval(() => {
      if (this.isPipelineOpen(this.latestDeployPipeline?.pipelineStatus)) {
        this.refreshDeployPipelineLive();
      }
      if (this.isPipelineOpen(this.latestScanPipeline?.pipelineStatus)) {
        this.refreshScanPipelineLive();
      }
      if (!this.isPipelineOpen(this.latestDeployPipeline?.pipelineStatus)
          && !this.isPipelineOpen(this.latestScanPipeline?.pipelineStatus)) {
        if (this.pipelineLivePollTimer) {
          clearInterval(this.pipelineLivePollTimer);
          this.pipelineLivePollTimer = undefined;
        }
      }
    }, 15_000);
  }

  private pickLatestPipeline(items: PipelineListItem[]): PipelineListItem | null {
    if (!items.length) return null;
    return [...items].sort((a, b) => {
      const ta = this.safeParseDate(a.createdAt)?.getTime() || 0;
      const tb = this.safeParseDate(b.createdAt)?.getTime() || 0;
      return tb - ta;
    })[0];
  }

  private filterPipelinesByBranch(items: PipelineListItem[]): PipelineListItem[] {
    if (!this.isGlobalView && this.selectedBranch) {
      return items.filter(p => (p.gitBranch || p.ref || 'main') === this.selectedBranch);
    }
    return items;
  }

  loadEnvironmentSummary(envId: string): void {
    this.environmentService.getEnvironment(envId).pipe(
      catchError(() => of(null)),
      takeUntil(this.destroy$)
    ).subscribe(env => {
      if (!env) {
        this.environmentSummary = null;
        this.totalSeconds = undefined;
        this.remainingSeconds = undefined;
        return;
      }
      this.environmentSummary = env;
      const expiresMs = this.parseBackendInstantMs(env.expiresAt as unknown);
      const createdMs = this.parseBackendInstantMs(env.createdAt as unknown);
      if (expiresMs != null && createdMs != null && expiresMs > createdMs) {
        const now = Date.now();
        this.totalSeconds = Math.max(1, Math.floor((expiresMs - createdMs) / 1000));
        this.remainingSeconds = Math.max(0, Math.floor((expiresMs - now) / 1000));
        this.startTtlCountdown();
      } else {
        if (this.ttlCountdownInterval) {
          clearInterval(this.ttlCountdownInterval);
          this.ttlCountdownInterval = undefined;
        }
        this.totalSeconds = undefined;
        this.remainingSeconds = undefined;
      }
    });
  }

  private refreshLatestDeploymentDetails(): void {
    const dep = this.displayLatestDeployment;
    if (!dep?.environmentId) {
      this.environmentSummary = null;
      this.totalSeconds = undefined;
      this.remainingSeconds = undefined;
      if (this.ttlCountdownInterval) {
        clearInterval(this.ttlCountdownInterval);
        this.ttlCountdownInterval = undefined;
      }
    } else {
      this.loadEnvironmentSummary(dep.environmentId);
    }
    this.refreshDeployPipelineLive();
    this.refreshScanPipelineLive();
  }

  private startTtlCountdown(): void {
    if (this.ttlCountdownInterval) clearInterval(this.ttlCountdownInterval);
    this.ttlCountdownInterval = setInterval(() => {
      if (this.remainingSeconds == null || this.remainingSeconds <= 0) {
        this.remainingSeconds = 0;
        if (this.ttlCountdownInterval) clearInterval(this.ttlCountdownInterval);
        return;
      }
      this.remainingSeconds--;
    }, 1000);
  }

  envTtlProgress(expiresAt: unknown, createdAt?: unknown): number {
    const end = this.parseBackendInstantMs(expiresAt);
    const start = createdAt ? this.safeParseDate(createdAt)?.getTime() : null;
    if (!end || !start || end <= start) return 0;
    const elapsed = this.nowMs - start;
    const total = end - start;
    return Math.max(0, Math.min(100, 100 - (elapsed / total) * 100));
  }

  formatDuration(seconds?: number): string {
    if (seconds == null || seconds <= 0) return '—';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  stageStatusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'd2-stage--success';
    if (s === 'FAILED' || s === 'CANCELED') return 'd2-stage--failed';
    if (s === 'RUNNING' || s === 'PENDING' || s === 'BUILDING') return 'd2-stage--pending';
    return 'd2-stage--muted';
  }

  stageIcon(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return '✓';
    if (s === 'FAILED' || s === 'CANCELED') return '✕';
    if (s === 'RUNNING' || s === 'PENDING') return '◌';
    return '·';
  }

  connectorClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'd2-connector--success';
    if (s === 'FAILED' || s === 'CANCELED') return 'd2-connector--failed';
    if (s === 'RUNNING' || s === 'PENDING') return 'd2-connector--pending';
    return 'd2-connector--muted';
  }

  /** Icône au trait d'un évènement d'activité (type, puis statut pour les environnements). */
  activityIconName(act: ActivityItem): EtIconName {
    const status = String(act.status || '').toUpperCase();
    switch (act.type) {
      case 'pipeline': return 'commit';
      case 'deployment': return 'rocket';
      case 'environment':
        return status === 'FAILED' || status === 'DEGRADED' ? 'alert' : 'server';
      default: return 'activity';
    }
  }

  /** Couleur de la pastille d'un filtre de statut d'environnement. */
  envFilterColor(id: string | null): string {
    switch (id) {
      case 'ACTIVE': return '#22C55E';
      case 'IN_PROGRESS': return '#F97316';
      case 'DEGRADED': return '#EAB308';
      case 'NEVER_STARTED': return '#EF4444';
      case 'ENDED': return '#94A3B8';
      default: return 'transparent';
    }
  }

  activityIconClass(type: ActivityItem['type']): string {
    switch (type) {
      case 'deployment': return 'd2-act-icon--blue';
      case 'pipeline': return 'd2-act-icon--orange';
      case 'environment': return 'd2-act-icon--green';
      default: return 'd2-act-icon--gray';
    }
  }

  findingSeverityClass(sev: string): string {
    const s = (sev || '').toUpperCase();
    if (s === 'CRITICAL') return 'sev-critical';
    if (s === 'HIGH') return 'sev-high';
    if (s === 'MEDIUM') return 'sev-medium';
    if (s === 'LOW') return 'sev-low';
    return 'sev-info';
  }

  findingSeverityColor(sev: string): string {
    const map: Record<string, string> = {
      CRITICAL: 'Critical',
      HIGH: 'High',
      MEDIUM: 'Medium',
      LOW: 'Low',
      INFO: 'Info'
    };
    const key = map[(sev || '').toUpperCase()] ?? sev;
    return this.severityBarColor(key);
  }

  heroStatusLabel(): string {
    const st = this.displayLatestDeployment?.pipelineStatus || this.displayLatestDeployment?.environmentStatus;
    if (!st) return 'Actif';
    const s = st.toUpperCase();
    if (s === 'SUCCESS' || s === 'RUNNING') return 'Actif';
    if (s === 'FAILED') return 'Échec';
    if (s === 'PENDING') return 'En cours';
    return st;
  }

  heroStatusClass(): string {
    const label = this.heroStatusLabel().toUpperCase();
    if (label === 'ACTIF' || label === 'SUCCESS') return 'd2-hero-pill--success';
    if (label === 'ÉCHEC' || label === 'FAILED') return 'd2-hero-pill--danger';
    if (label === 'EN COURS' || label === 'PENDING') return 'd2-hero-pill--warning';
    return 'd2-hero-pill--success';
  }

  private scheduleDeployChartsRender(): void {
    if (this.chartRenderTimer) clearTimeout(this.chartRenderTimer);
    this.chartRenderTimer = setTimeout(() => {
      this.ngZone.runOutsideAngular(() => {
        this.renderDeployDonutChart();
        this.renderWeekBarChart();
      });
    }, 120);
  }

  private destroyDeployCharts(): void {
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
      this.chartRenderTimer = undefined;
    }
    this.ngZone.runOutsideAngular(() => {
      [this.deployDonutChart, this.weekBarChart].forEach(ch => ch?.destroy());
      this.deployDonutChart = undefined;
      this.weekBarChart = undefined;
    });
  }

  private renderDeployDonutChart(): void {
    const canvas = this.deployDonutCanvas?.nativeElement;
    if (!canvas || this.loadingSlow) return;
    const wrap = canvas.parentElement;
    if (!wrap || wrap.clientWidth === 0) return;

    Chart.getChart(canvas)?.destroy();
    this.deployDonutChart?.destroy();

    const data = [
      this.chartDeploymentCounts.success,
      this.chartDeploymentCounts.pending,
      this.chartDeploymentCounts.failed
    ];
    this.deployDonutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Réussis', 'En attente', 'Échoués'],
        datasets: [{
          data,
          backgroundColor: [DEPLOY_CHART_COLORS.success, DEPLOY_CHART_COLORS.pending, DEPLOY_CHART_COLORS.failed],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        animation: { animateRotate: true, duration: 800, easing: 'easeInOutQuad' },
        plugins: { legend: { display: false }, tooltip: {
          callbacks: {
            label: ctx => {
              const total = data.reduce((a, b) => a + b, 0) || 1;
              const pct = Math.round((ctx.parsed / total) * 100);
              return `${ctx.label} · ${ctx.parsed} (${pct}%)`;
            }
          }
        }}
      }
    });
  }

  private renderWeekBarChart(): void {
    const canvas = this.weekBarCanvas?.nativeElement;
    if (!canvas || this.loadingSlow) return;
    const wrap = canvas.parentElement;
    if (!wrap || wrap.clientWidth === 0) return;

    Chart.getChart(canvas)?.destroy();
    this.weekBarChart?.destroy();

    const periodData = this.buildDeploymentPeriodChartData();
    this.weekBarChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: periodData.labels,
        datasets: [
          { label: 'Réussis', data: periodData.success, backgroundColor: DEPLOY_CHART_COLORS.success, borderRadius: 3, barPercentage: 0.85 },
          { label: 'En attente', data: periodData.pending, backgroundColor: DEPLOY_CHART_COLORS.pending, borderRadius: 3, barPercentage: 0.85 },
          { label: 'Échoués', data: periodData.failed, backgroundColor: DEPLOY_CHART_COLORS.failed, borderRadius: 3, barPercentage: 0.85 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 }, color: '#94A3B8' } },
          y: { stacked: true, display: false, beginAtZero: true }
        }
      }
    });
  }

  private getChartDeployments(): DeploymentHistoryItem[] {
    const { start } = this.getDeploymentPeriodRange();
    return this.environmentFilteredDeployments.filter(dep => {
      const created = this.safeParseDate(dep.createdAt);
      return !!created && created >= start;
    });
  }

  private countEnvironmentKpis(deps: DeploymentHistoryItem[]): {
    total: number;
    online: number;
    inProgress: number;
    failed: number;
    ended: number;
  } {
    return {
      total: deps.length,
      online: deps.filter(d => matchesEnvironmentFilter(d.environmentStatus, 'ACTIVE')).length,
      inProgress: deps.filter(d => matchesEnvironmentFilter(d.environmentStatus, 'IN_PROGRESS')).length,
      failed: deps.filter(d => matchesEnvironmentFilter(d.environmentStatus, 'NEVER_STARTED')).length,
      ended: deps.filter(d => matchesEnvironmentFilter(d.environmentStatus, 'ENDED')).length
    };
  }

  /** Donut / barres — logique pipeline : réussi si l'env a été en ligne. */
  private countPipelineChartStatuses(deps: DeploymentHistoryItem[]): {
    total: number;
    success: number;
    pending: number;
    failed: number;
    skipped: number;
  } {
    const success = deps.filter(d => this.pipelineChartOutcome(d) === 'success').length;
    const pending = deps.filter(d => this.pipelineChartOutcome(d) === 'pending').length;
    const failed = deps.filter(d => this.pipelineChartOutcome(d) === 'failed').length;
    const skipped = deps.filter(d => this.pipelineChartOutcome(d) === 'skipped').length;
    return {
      total: deps.length,
      success,
      pending,
      failed,
      skipped
    };
  }

  private countDeploymentsByStatus(deps: DeploymentHistoryItem[]): {
    total: number;
    success: number;
    pending: number;
    failed: number;
    skipped: number;
  } {
    const success = deps.filter(d => this.deploymentOutcome(d) === 'success').length;
    const pending = deps.filter(d => this.deploymentOutcome(d) === 'pending').length;
    const failed = deps.filter(d => this.deploymentOutcome(d) === 'failed').length;
    const skipped = deps.filter(d => this.deploymentOutcome(d) === 'skipped').length;
    return {
      total: deps.length,
      success,
      pending,
      failed,
      skipped
    };
  }

  private getDeploymentPeriodRange(): { start: Date; bucketCount: number } {
    const now = new Date();
    if (this.deploymentPeriod === 'week') {
      const currentWeekStart = this.startOfWeek(now);
      const start = new Date(currentWeekStart);
      start.setDate(start.getDate() - 7 * 7);
      return { start, bucketCount: 8 };
    }
    if (this.deploymentPeriod === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      start.setHours(0, 0, 0, 0);
      return { start, bucketCount: 6 };
    }
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, bucketCount: 7 };
  }

  private getDeploymentBucketIndex(created: Date, start: Date): number {
    if (this.deploymentPeriod === 'month') {
      return (created.getFullYear() - start.getFullYear()) * 12 + (created.getMonth() - start.getMonth());
    }
    if (this.deploymentPeriod === 'week') {
      const createdWeekStart = this.startOfWeek(created);
      const rangeWeekStart = this.startOfWeek(start);
      return Math.round((createdWeekStart.getTime() - rangeWeekStart.getTime()) / (7 * 86_400_000));
    }
    const startMs = this.startOfDay(start).getTime();
    const createdMs = this.startOfDay(created).getTime();
    return Math.floor((createdMs - startMs) / 86_400_000);
  }

  private buildDeploymentPeriodLabels(start: Date, bucketCount: number): string[] {
    if (this.deploymentPeriod === 'month') {
      const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
      return Array.from({ length: bucketCount }, (_, i) => {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        return monthNames[d.getMonth()];
      });
    }
    if (this.deploymentPeriod === 'week') {
      const weekStart = this.startOfWeek(start);
      return Array.from({ length: bucketCount }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i * 7);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        return `${day}/${month}`;
      });
    }
    const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const now = new Date();
    return Array.from({ length: bucketCount }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (bucketCount - 1 - i));
      return dayLabels[d.getDay()];
    });
  }

  private buildDeploymentPeriodChartData(): {
    labels: string[];
    success: number[];
    pending: number[];
    failed: number[];
  } {
    const { start, bucketCount } = this.getDeploymentPeriodRange();
    const buckets = Array.from({ length: bucketCount }, () => ({ success: 0, pending: 0, failed: 0 }));

    this.getChartDeployments().forEach(dep => {
      const created = this.safeParseDate(dep.createdAt);
      if (!created) return;
      const idx = this.getDeploymentBucketIndex(created, start);
      if (idx < 0 || idx >= bucketCount) return;
      const outcome = this.pipelineChartOutcome(dep);
      if (outcome === 'success') buckets[idx].success++;
      else if (outcome === 'failed') buckets[idx].failed++;
      else if (outcome === 'pending') buckets[idx].pending++;
    });

    return {
      labels: this.buildDeploymentPeriodLabels(start, bucketCount),
      success: buckets.map(b => b.success),
      pending: buckets.map(b => b.pending),
      failed: buckets.map(b => b.failed)
    };
  }

  private startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Semaine calendaire ISO : lundi 00:00 → dimanche 23:59 */
  private startOfWeek(date: Date): Date {
    const d = this.startOfDay(date);
    const day = d.getDay();
    const daysFromMonday = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - daysFromMonday);
    return d;
  }

  private computeWeekTrends(): void {
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const inRange = (d: Date, start: Date, end: Date) => d >= start && d < end;
    const countDeps = (start: Date, end: Date) =>
      this.deployments.filter(d => {
        const dt = this.safeParseDate(d.createdAt);
        return dt && inRange(dt, start, end);
      }).length;

    const thisWeek = countDeps(weekAgo, now);
    const lastWeek = countDeps(twoWeeksAgo, weekAgo);
    this.weekDeployTrend = this.pctChange(lastWeek, thisWeek);

    const successRate = (start: Date, end: Date) => {
      const deps = this.deployments.filter(d => {
        const dt = this.safeParseDate(d.createdAt);
        return dt && inRange(dt, start, end);
      });
      if (!deps.length) return 0;
      return Math.round(deps.filter(d => d.pipelineStatus?.toUpperCase() === 'SUCCESS').length / deps.length * 100);
    };
    this.weekSuccessTrend = successRate(twoWeeksAgo, weekAgo) - successRate(weekAgo, now);

    const envThis = this.environmentsForApp.filter(e => {
      const dt = this.safeParseDate(e.createdAt);
      return dt && inRange(dt, weekAgo, now);
    }).length;
    const envLast = this.environmentsForApp.filter(e => {
      const dt = this.safeParseDate(e.createdAt);
      return dt && inRange(dt, twoWeeksAgo, weekAgo);
    }).length;
    this.weekEnvTrend = this.pctChange(envLast, envThis);
    this.weekVulnTrend = 0;
  }

  private pctChange(prev: number, curr: number): number {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  }

  private loadRecentFindings(): void {
    if (!this.appId) return;
    this.recentFindingsLoading = true;
    const branch = this.isGlobalView ? undefined : this.selectedBranch;

    const tags = this.selectedPipelineId
      ? this.defectDojoService.pipelineTag(this.selectedPipelineId)
      : this.defectDojoService.scanKindTag();

    this.defectDojoService.getFindings(this.appId, branch, 'open', 0, 10, undefined, tags).pipe(
      catchError(() => of(null)),
      switchMap(page => {
        const dojoItems = page?.content?.filter(f => !!f?.title || !!f?.id) ?? [];
        if (dojoItems.length) {
          return of({ source: 'defectdojo' as const, dojo: dojoItems, local: [] as FindingItem[] });
        }
        const filters: { status?: string; branch?: string } = { status: 'OPEN' };
        if (!this.isGlobalView) filters.branch = this.selectedBranch;
        return this.findingsService.listByApplication(this.appId!, 0, 10, filters).pipe(
          map(localPage => ({
            source: 'local' as const,
            dojo: [] as DefectDojoFindingItem[],
            local: localPage.content || []
          })),
          catchError(() => of({ source: 'local' as const, dojo: [] as DefectDojoFindingItem[], local: [] as FindingItem[] }))
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe(result => {
      this.recentDojoFindings = result.dojo;
      this.recentFindings = result.local;
      this.recentFindingsLoading = false;
    });
  }

  private loadDeployRecommendation(): void {
    if (!this.appId) return;
    const branch = this.isGlobalView ? undefined : this.selectedBranch;
    this.defectDojoService.getDashboard(this.appId, branch, this.defectDojoService.scanKindTag()).pipe(
      catchError(() => of(null)),
      takeUntil(this.destroy$)
    ).subscribe(d => {
      this.deployRecommendation = d?.deployRecommendation ?? null;
    });
  }

  scrollTo(sectionId: string): void {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  viewSecurityDashboard(): void {
    if (!this.appId) return;
    const queryParams: Record<string, string> = this.isGlobalView ? {} : { branch: this.selectedBranch };
    if (this.selectedPipelineId) {
      queryParams['pipelineId'] = this.selectedPipelineId;
    }
    this.router.navigate(['/project', this.appId, 'security-dashboard'], { queryParams });
  }

  /** Ouvre la page Quality Gate sur exactement le scan évalué par l'indice de maturité. */
  viewQualityGate(): void {
    if (!this.appId) return;
    const queryParams: Record<string, string> = {};
    const branch = this.qgResult?.branch || (this.isGlobalView ? null : this.selectedBranch);
    const pipelineId = this.qgResult?.pipelineId
      ? String(this.qgResult.pipelineId)
      : (this.selectedPipelineId
        || (this.latestScanPipeline?.pipelineId != null ? String(this.latestScanPipeline.pipelineId) : null));
    if (branch) {
      queryParams['branch'] = branch;
    }
    if (pipelineId) {
      queryParams['pipelineId'] = pipelineId;
    }
    this.router.navigate(['/project', this.appId, 'quality-gate'], { queryParams });
  }

  gradeColor(grade?: string): string {
    return GRADE_COLORS[grade ?? ''] ?? '#64748b';
  }

  refreshAll(): void {
    if (this.appId) {
      this.loadOverview();
      this.loadEnvironmentVulnCounts();
      this.loadRecentFindings();
      this.loadDeployRecommendation();
      this.requestSecurityReload(this.appId, this.isGlobalView ? GLOBAL_BRANCH : this.selectedBranch);
    }
  }

  onBranchChange(): void {
    // Vue globale explicite : sans paramètre, la page revient à la branche du service.
    const queryParams = this.isGlobalView
      ? { branch: GLOBAL_BRANCH }
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

  private requestSecurityReload(appId: string, branch: string, pipelineId?: string | null): void {
    if (this.serviceProfile === 'deploy-only') {
      return;
    }
    this.securityReload$.next({ appId, branch, pipelineId });
    this.loadMaturityQualityGate(appId, branch, pipelineId ?? null);
  }

  /** Recharge le résultat Quality Gate ; l'ancien n'est effacé que si le périmètre (service/branche) change. */
  private loadMaturityQualityGate(appId: string, branch: string, pipelineId: string | null): void {
    const apiBranch = branch === GLOBAL_BRANCH ? null : branch;
    const scopeKey = `${appId}|${apiBranch ?? '*'}`;
    if (scopeKey !== this.qgScopeKey) {
      this.qgScopeKey = scopeKey;
      this.qgResult = null;
    }
    this.maturityQg$.next({ appId, branch: apiBranch, pipelineId });
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
    this.selectedEnvironmentId = null;
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
        this.totalEnvironmentsCreated = (quickData.environments || []).length;

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
        this.loadRecentFindings();
        this.loadDeployRecommendation();
        setTimeout(() => this.loadEnvironmentVulnCounts(), 2500);
      },
      error: () => {
        this.overviewLoading = false;
        this.overviewError = 'Erreur lors du chargement du projet';
        this.loadDeploymentsAndPipelines();
      }
    });
  }

  private reloadBranchScopedData(): void {
    if (!this.appId || this.overviewLoading) return;
    this.applicationService.clearDeploymentsCache(this.appId);
    this.loadDeploymentsAndPipelines();
    this.loadRecentFindings();
    this.loadDeployRecommendation();
  }

  private loadDeploymentsAndPipelines(): void {
    if (!this.appId) return;

    this.loadingSlow = true;
    this.scopedDataBranch = this.selectedBranch;
    const branch = this.isGlobalView ? undefined : this.selectedBranch;

    forkJoin({
      deployments: this.applicationService.getDeploymentHistory(this.appId, { branch, page: 0, size: 50 }).pipe(catchError(() => of([]))),
      deployPipelines: this.pipelineService.listPipelines(0, 50, this.appId, 'DEPLOY').pipe(catchError(() => of([] as PipelineListItem[]))),
      scanPipelines: this.pipelineService.listPipelines(0, 50, this.appId, 'SCAN').pipe(catchError(() => of([] as PipelineListItem[])))
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: slowData => {
        this.deployments = slowData.deployments || [];
        this.latestDeployment = this.deployments.length > 0 ? this.deployments[0] : null;

        const deployList = this.filterPipelinesByBranch(slowData.deployPipelines || []);
        const scanList = this.filterPipelinesByBranch(slowData.scanPipelines || []);

        if (deployList.length > 0) this.deployPipelineEver = true;
        if (scanList.length > 0) this.scanPipelineEver = true;
        if ((slowData.deployments || []).length > 0) this.deployPipelineEver = true;

        this.latestDeployPipeline = this.pickLatestPipeline(deployList);
        this.latestScanPipeline = this.pickLatestPipeline(scanList);

        const envIdsForApp = new Set<string>();
        this.environmentsForApp.forEach(e => envIdsForApp.add(String(e.id)));
        this.deployments.forEach(d => {
          if (d?.environmentId) envIdsForApp.add(String(d.environmentId));
        });

        let rawPipelines: PipelineListItem[] = [...deployList, ...scanList];
        if (!rawPipelines.length) {
          rawPipelines = (slowData.deployPipelines || []).concat(slowData.scanPipelines || []);
        }

        this.recentPipelines = rawPipelines
          .sort((a, b) => {
            const dateA = this.safeParseDate(a.createdAt)?.getTime() || 0;
            const dateB = this.safeParseDate(b.createdAt)?.getTime() || 0;
            return dateB - dateA;
          })
          .slice(0, 5)
          .map((p): DashboardPipelineItem => ({
            id: p.pipelineId ?? null,
            kind: (p.executionKind || '').toString().toUpperCase() || undefined,
            name: p.serviceName || p.environmentName || `Pipeline #${p.pipelineId ?? '—'}`,
            branch: p.gitBranch || p.ref || 'main',
            status: p.status || p.pipelineStatus || 'UNKNOWN',
            createdAt: this.safeParseDate(p.createdAt)?.toISOString() ||
              this.safeParseDate(p.finishedAt)?.toISOString() ||
              new Date().toISOString(),
            environmentId: p.environmentId ?? '',
            environmentName: p.environmentName ?? p.serviceName ?? `Scan #${p.pipelineId ?? '—'}`,
            triggeredBy: p.createdByUsername ?? undefined
          }));

        const counters = this.countPipelineChartStatuses(this.deployments);
        this.totalDeployments = counters.total;
        this.successfulDeployments = counters.success;
        this.failedDeployments = counters.failed;
        this.pendingDeployments = counters.pending;
        this.skippedDeployments = counters.skipped;

        this.buildRecentActivities();
        this.computeWeekTrends();
        this.loadingSlow = false;
        this.refreshLatestDeploymentDetails();
        setTimeout(() => this.scheduleDeployChartsRender(), 0);
      },
      error: () => {
        this.loadingSlow = false;
      }
    });
  }

  private hasEnvironmentBeenOnline(dep: DeploymentHistoryItem): boolean {
    const env = (dep.environmentStatus || '').toUpperCase();
    return ['RUNNING', 'DEGRADED', 'EXPIRED', 'DESTROYED'].includes(env);
  }

  /**
   * Donut « Statut des déploiements » — indépendant des KPI env.
   * Réussi = l'environnement est passé en ligne au moins une fois (RUNNING+),
   * pas le statut SUCCESS du pipeline en base.
   */
  private pipelineChartOutcome(dep: DeploymentHistoryItem): 'success' | 'pending' | 'failed' | 'skipped' {
    const pipelineStatus = (dep.pipelineStatus || '').toUpperCase();
    if (pipelineStatus === 'SKIPPED') return 'skipped';
    if (this.hasEnvironmentBeenOnline(dep)) return 'success';

    const envStatus = (dep.environmentStatus || '').toUpperCase();
    if (envStatus === 'FAILED') return 'failed';
    if (envStatus === 'PENDING' || envStatus === 'BUILDING') {
      if (pipelineStatus === 'FAILED' || pipelineStatus === 'CANCELED') return 'failed';
      return 'pending';
    }
    if (pipelineStatus === 'FAILED' || pipelineStatus === 'CANCELED') return 'failed';
    if (pipelineStatus === 'RUNNING' || pipelineStatus === 'PENDING') return 'pending';
    return 'pending';
  }

  private deploymentOutcome(dep: DeploymentHistoryItem): 'success' | 'pending' | 'failed' | 'skipped' {
    return this.pipelineChartOutcome(dep);
  }

  private inferPipelineKind(jobs: PipelineJobInfo[]): 'scan' | 'deploy' {
    const hasDeployJob = jobs.some(j => {
      const stage = (j.stage || j.name || '').toLowerCase();
      return stage.includes('deploy') || stage.includes('build-image') || stage.includes('push-image');
    });
    return hasDeployJob ? 'deploy' : 'scan';
  }

  private stageTemplateForKind(kind: 'scan' | 'deploy'): string[] {
    // Doit coller aux `stages:` GitLab (pipeline.md) — pas aux noms de jobs.
    // clone-repository / deploy:clone sont des jobs du stage `setup`, pas un stage séparé.
    if (kind === 'scan') {
      return ['setup', 'code-analysis', 'sca', 'sast', 'secrets-iac', 'reporting'];
    }
    // Pas de « container-scan » : Grype a été retiré du flux deploy (scan d'image dans le flux scan).
    return ['setup', 'build', 'push-image', 'deploy-k8s', 'zap-scan', 'reporting', 'security-validation'];
  }

  private statusFromStageJobs(jobs: PipelineJobInfo[]): PipelineStageStatus {
    if (!jobs.length) return 'pending';
    const statuses = jobs.map(j => (j.status || '').toLowerCase());
    if (statuses.some(s => s === 'failed' || s === 'canceled')) return 'failed';
    if (statuses.some(s => s === 'running' || s === 'pending' || s === 'created' || s === 'building')) return 'active';
    if (statuses.every(s => s === 'success' || s === 'passed' || s === 'manual' || s === 'skipped')) {
      // skipped/manual seuls → pas « done » ; done seulement si au moins un succès
      if (statuses.every(s => s === 'skipped' || s === 'manual')) return 'pending';
      return 'done';
    }
    if (statuses.some(s => s === 'skipped')) return 'pending';
    return 'pending';
  }

  private canDisplayDeploymentUrl(url: string): boolean {
    const dep = this.displayLatestDeployment;
    if (!dep) return false;
    const envStatus = (dep.environmentStatus || '').toUpperCase();
    if (envStatus !== 'RUNNING') return false;
    if (this.isLatestEnvExpired) return false;
    const lower = url.toLowerCase();
    return !lower.includes('.local');
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

  viewEnvSecurityAnalysis(env: { id: string; branch?: string; gitBranch?: string }): void {
    if (!this.appId) return;
    const branch = env.branch || env.gitBranch;
    const queryParams: Record<string, string> = {};
    if (branch && branch !== '—') queryParams['branch'] = branch;
    this.router.navigate(['/project', this.appId, 'security-dashboard'], { queryParams });
  }

  viewPipeline(envId: string, kind?: 'SCAN' | 'DEPLOY'): void {
    const queryParams: Record<string, string> = {};
    if (kind) queryParams['kind'] = kind;
    if (this.appId) {
      // Pipeline lié à un environnement, affiché dans la mise en page du service (même barre latérale).
      this.router.navigate(['/project', this.appId, 'pipeline-detail'], {
        queryParams: { ...queryParams, envId }
      });
      return;
    }
    this.router.navigate(['/pipeline', envId], { queryParams });
  }

  viewPipelineById(pipelineId: number | string, branch?: string, kind?: 'SCAN' | 'DEPLOY'): void {
    const queryParams: Record<string, string> = {};
    if (kind) queryParams['kind'] = kind;
    if (branch) queryParams['branch'] = branch;
    try {
      localStorage.setItem('envirotest-last-pipeline-id', String(pipelineId));
      if (this.appId) localStorage.setItem(`envirotest-last-pipeline-id:${this.appId}`, String(pipelineId));
      if (kind) localStorage.setItem('envirotest-last-pipeline-kind', kind);
    } catch { /* ignore */ }
    if (this.appId) {
      this.router.navigate(['/project', this.appId, 'pipeline-detail', String(pipelineId)], { queryParams });
      return;
    }
    this.router.navigate(['/pipeline/id', String(pipelineId)], { queryParams });
  }

  viewEnvironment(envId: string): void {
    // Reste dans la mise en page du service (même barre latérale).
    if (this.appId) {
      this.router.navigate(['/project', this.appId, 'environment', envId]);
      return;
    }
    this.router.navigate(['/environment', envId]);
  }

  /** Lien vers le détail d'un pipeline, dans la mise en page du service (même barre latérale). */
  private pipelineDetailLink(pipelineId: number | string | null | undefined, kind?: string | null): string | undefined {
    if (!pipelineId || !this.appId) return undefined;
    const k = (kind || '').toUpperCase();
    const query = k === 'SCAN' || k === 'DEPLOY' ? `?kind=${k}` : '';
    return `/project/${this.appId}/pipeline-detail/${pipelineId}${query}`;
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
        link: this.pipelineDetailLink(d.pipelineId, 'DEPLOY')
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
        link: this.pipelineDetailLink(p.id, p.kind)
      });
    });

    const envByDate = [...this.environmentsForApp].sort((a, b) => {
      const ta = this.safeParseDate(a.createdAt)?.getTime() || 0;
      const tb = this.safeParseDate(b.createdAt)?.getTime() || 0;
      return tb - ta;
    });

    envByDate
      .filter(e => {
        if (this.isGlobalView) return true;
        return (e.gitBranch || 'main') === this.selectedBranch;
      })
      .slice(0, 4).forEach(e => {
      const { title, description } = this.environmentActivityCopy(e);
      const st = (e.status || '').toUpperCase();
      const preview = st === 'RUNNING' && (e.previewUrl || '').trim() ? (e.previewUrl as string).trim() : undefined;
      activities.push({
        id: e.id,
        type: 'environment',
        title,
        description,
        timestamp: e.createdAt,
        status: this.environmentStatusLabel(e.status),
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

  getDockerfileDisplay(): string {
    return this.appDetails?.dockerfilePath?.trim() || './Dockerfile';
  }

  getGithubTokenDisplay(): string {
    if (!this.appDetails) return '—';
    return this.appDetails.hasGithubToken ? 'Configuré' : 'Non configuré';
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
    if (s === 'RUNNING') return 'status-success';
    if (s === 'DEGRADED') return 'status-warning';
    if (s === 'PENDING' || s === 'BUILDING') return 'status-warning';
    if (s === 'DESTROYED' || s === 'EXPIRED') return 'status-muted';
    return 'status-muted';
  }

  environmentStatusClass(status: string | undefined): string {
    return environmentStatusView(status).cssClass;
  }

  environmentStatusLabel(status: string | undefined): string {
    return environmentStatusView(status).label;
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

  viewDeploymentsWithStatusFilter(filter: string | null): void {
    if (!this.appId) return;
    const queryParams: Record<string, string> = {};
    if (filter) queryParams['status'] = filter;
    if (!this.isGlobalView && this.selectedBranch) {
      queryParams['branch'] = this.selectedBranch;
    }
    this.router.navigate(['/project', this.appId, 'deployments'], { queryParams });
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
      case 'RUNNING': return { title: 'Environnement en ligne', description: `${name} — branche ${branch}` };
      case 'DEGRADED': return { title: 'Environnement dégradé', description: `${name} — pods non prêts` };
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
    if (s === 'DEGRADED') return '⚠️';
    if (s === 'BUILDING') return '🔧';
    if (s === 'PENDING') return '⏳';
    if (s === 'FAILED') return '⚠️';
    if (s === 'DESTROYED' || s === 'EXPIRED') return '🗑️';
    return '🌍';
  }
}
