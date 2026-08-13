import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import {
  AppDatabaseModel,
  AppDeployment,
  AppServiceModel,
  DeploymentMonitorAlert,
  DeploymentMonitoringResponse,
  DeploymentPodInfo,
  SECRET_MASK
} from '../../models/application-management/application-management.models';
import { PipelineJobInfo, PipelineScanResponse } from '../../models/pipeline/pipeline-scan-response';
import { AiAnalysisService } from '../../services/ai/ai-analysis.service';
import { ExplainPipelineLogsResponse } from '../../models/ai/explain-pipeline-logs.model';
import { sortStageNames } from '../../shared/ci-stage-order';

interface StateEntry {
  name: string;
  status: string;
  wave: number;
  internalHost: string;
  externalUrl?: string | null;
  role?: string | null;
}

/** Viewport virtuel de l’aperçu (rendu desktop réduit pour remplir le cadre). */
const PREVIEW_VW = 1280;
const PREVIEW_VH = 800;

@Component({
  selector: 'app-managed-deployment-status',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './deployment-status.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class DeploymentStatusComponent implements OnChanges, OnDestroy {
  @Input() appId!: string;
  @Input() deployment!: AppDeployment;
  @Input() services: AppServiceModel[] = [];
  /** full = historique (CI, pods, DBs) ; banner = dashboard app (annexe §3.3). */
  @Input() variant: 'full' | 'banner' = 'full';
  /** true = détails techniques sous le banner (sans en-tête / TTL dupliqués). */
  @Input() embed = false;
  /** Affiche les onglets Pipeline / Services / BD / Pods / Connexions. */
  @Input() showOpsTabs = false;
  @Output() navigateSection = new EventEmitter<'monitoring' | 'alerts' | 'history' | 'deployments'>();

  opsTab: 'pipeline' | 'services' | 'databases' | 'pods' | 'connections' = 'pipeline';

  setOpsTab(tab: 'pipeline' | 'services' | 'databases' | 'pods' | 'connections'): void {
    this.opsTab = tab;
    if (tab !== 'pipeline') {
      this.closeCiLogs();
    }
    if (tab !== 'pods' && tab !== 'services' && tab !== 'databases') {
      this.closeLogs();
    }
    if (tab === 'pipeline' && this.ciPipeline?.jobs?.length) {
      this.ensureDefaultCiJobSelected(this.ciPipeline.jobs);
    }
    if (tab === 'pods') {
      this.selectedWorkload = null;
      this.ensureDefaultPodSelected(true);
    }
    if (tab === 'services') {
      this.selectedWorkload = null;
      this.ensureDefaultServiceSelected(true);
    }
    if (tab === 'databases') {
      this.selectedWorkload = null;
      this.ensureDefaultDatabaseSelected(true);
    }
  }

  /** Jobs CI regroupés par stage (ordre .gitlab-ci.yml). */
  get ciStages(): { name: string; status: string; jobs: PipelineJobInfo[] }[] {
    const jobs = this.ciPipeline?.jobs || [];
    const map = new Map<string, PipelineJobInfo[]>();
    for (const j of jobs) {
      const stage = (j.stage || 'default').trim() || 'default';
      if (!map.has(stage)) map.set(stage, []);
      map.get(stage)!.push(j);
    }
    map.forEach(list => list.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0)));
    const stageNames = sortStageNames(Array.from(map.keys()), (stage) =>
      Math.min(...(map.get(stage) || []).map(j => j.id ?? 0))
    );
    return stageNames.map((name) => {
      const stageJobs = map.get(name)!;
      return {
        name,
        status: this.aggregateJobStatus(stageJobs),
        jobs: stageJobs
      };
    });
  }

  private aggregateJobStatus(jobs: PipelineJobInfo[]): string {
    const norms = jobs.map(j => this.normCiStatus(j.status));
    if (norms.some(s => s === 'failed' || s === 'canceled')) return 'failed';
    if (norms.some(s => s === 'running')) return 'running';
    if (norms.some(s => s === 'pending' || s === 'created')) return 'pending';
    if (norms.length && norms.every(s => s === 'success')) return 'success';
    return 'pending';
  }

  formatJobDuration(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return '';
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  jobRowClass(status: string): string {
    const s = this.normCiStatus(status);
    if (s === 'success' || s === 'ready') return 'job-success';
    if (s === 'failed' || s === 'canceled' || s === 'stopped') return 'job-failed';
    if (s === 'running' || s === 'pending' || s === 'created' || s === 'notready') return 'job-running';
    return '';
  }

  podRowClass(phase: string | undefined, ready: boolean | undefined): string {
    const p = (phase || '').toLowerCase();
    if (ready || p === 'running') return 'job-success';
    if (p === 'failed' || p === 'error' || p === 'crashloopbackoff') return 'job-failed';
    return 'job-running';
  }

  /** Stage aperçu — scale dynamique pour remplir le conteneur. */
  @ViewChild('previewStage') set previewStageEl(el: ElementRef<HTMLElement> | undefined) {
    this.teardownPreviewScale();
    if (el?.nativeElement) {
      this.setupPreviewScale(el.nativeElement);
    }
  }

  /** Copie locale (mise à jour par le polling). */
  dep!: AppDeployment;

  /** Mots de passe révélés (id base → mot de passe en clair). */
  revealed: Record<string, string> = {};
  revealing: Record<string, boolean> = {};

  pods: DeploymentPodInfo[] = [];
  podsLoading = false;
  podsError: string | null = null;

  monitorAlerts: DeploymentMonitorAlert[] = [];
  monitorHealth: DeploymentMonitoringResponse['health'] | null = null;
  monitorSummary: DeploymentMonitoringResponse['summary'] | null = null;
  monitorAppUrl: string | null = null;
  metricsAvailable = false;

  selectedWorkload: string | null = null;
  logs = '';
  logsPod = '';
  logsLoading = false;
  logsError: string | null = null;

  /** Pipeline CI (jobs + logs). */
  ciPipeline: PipelineScanResponse | null = null;
  ciLoading = false;
  ciError: string | null = null;
  selectedCiJob: PipelineJobInfo | null = null;
  ciJobLogs = '';
  ciJobLogsLoading = false;
  ciJobLogsError: string | null = null;

  /** Agent IA — explication des logs CI. */
  logAiResult: ExplainPipelineLogsResponse | null = null;
  logAiLoading = false;
  logAiError: string | null = null;
  logAiQuestion = '';

  rebuildingServiceId: string | null = null;
  rebuildError: string | null = null;
  rebuildMessage: string | null = null;

  /** Compte à rebours TTL (secondes restantes, corrigé horloge serveur). */
  ttlLabel = '';
  ttlProgress = 0;
  ttlUrgent = false;
  ttlExpired = false;
  extendingTtl = false;
  extendTtlError: string | null = null;
  extendTtlMessage: string | null = null;

  private poll?: Subscription;
  private podsPoll?: Subscription;
  private ciPoll?: Subscription;
  private ttlTimer?: ReturnType<typeof setInterval>;
  /** Décalage serveur - client (ms). */
  private serverOffsetMs = 0;
  /** Exposé au template (date pipe). */
  expiresAtMs: number | null = null;
  readyAtMs: number | null = null;
  private ttlHours = 0;

  constructor(
    private api: ApplicationManagementService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private aiAnalysisService: AiAnalysisService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['deployment'] && this.deployment) {
      this.dep = this.deployment;
      this.closeLogs();
      this.closeCiLogs();
      this.setupPolling();
      this.setupPodsPolling();
      if (this.variant === 'full') {
        this.setupCiPolling();
      } else {
        this.ciPoll?.unsubscribe();
        this.ciPipeline = null;
      }
      this.setupTtlCountdown();
      this.syncPreviewUrl();
      if (this.isStopped) {
        this.pods = [];
        this.podsError = null;
        this.podsLoading = false;
        this.rebuildMessage = null;
        this.ciPipeline = null;
        this.ciLoading = false;
        this.ciError = null;
        this.ciPoll?.unsubscribe();
        this.closeCiLogs();
      } else {
        this.refreshPods();
        if (this.variant === 'full') {
          this.refreshCiPipeline();
        }
      }
    }
  }

  get isStopped(): boolean {
    return this.dep?.status === 'STOPPED';
  }

  get isRunning(): boolean {
    return (this.dep?.status || '').toUpperCase() === 'RUNNING';
  }

  /** URL front : health/monitor, sinon service FRONTEND. */
  get frontendUrl(): string | null {
    const fromMonitor = (this.monitorAppUrl || '').trim();
    if (fromMonitor) return fromMonitor;
    const front = this.serviceEntries.find(s => (s.role || '').toUpperCase() === 'FRONTEND' && s.externalUrl);
    if (front?.externalUrl) return front.externalUrl.trim();
    // Fallback : première URL qui ne finit pas par /api
    const any = this.serviceEntries.find(s => {
      const u = (s.externalUrl || '').replace(/\/$/, '');
      return u && !u.endsWith('/api');
    });
    return any?.externalUrl?.trim() || null;
  }

  get backendUrl(): string | null {
    const back = this.serviceEntries.find(s => (s.role || '').toUpperCase() === 'BACKEND' && s.externalUrl);
    if (back?.externalUrl) return back.externalUrl.trim();
    const api = this.serviceEntries.find(s => (s.externalUrl || '').replace(/\/$/, '').endsWith('/api'));
    const url = api?.externalUrl?.trim() || null;
    if (url && url === this.frontendUrl) return null;
    return url;
  }

  canEmbedPreview(url: string | null | undefined): boolean {
    const u = (url || '').trim().toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://');
  }

  /**
   * URL iframe stable (propriété, pas getter).
   * Sinon le tick TTL (1s) recrée un SafeResourceUrl → reload / scintillement.
   * On conserve la dernière URL valide tant que l'env tourne.
   */
  previewSafeUrl: SafeResourceUrl | null = null;
  private previewRawUrl = '';
  /** Scale pour que l’iframe desktop couvre tout le stage. */
  previewScale = 1;
  readonly previewVw = PREVIEW_VW;
  readonly previewVh = PREVIEW_VH;
  private previewResizeObs?: ResizeObserver;

  private syncPreviewUrl(): void {
    if (!this.isRunning) {
      this.previewSafeUrl = null;
      this.previewRawUrl = '';
      this.teardownPreviewScale();
      return;
    }
    const url = this.frontendUrl;
    if (!url || !this.canEmbedPreview(url)) {
      return;
    }
    if (url === this.previewRawUrl && this.previewSafeUrl) {
      return;
    }
    this.previewRawUrl = url;
    this.previewSafeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  private setupPreviewScale(stage: HTMLElement): void {
    const apply = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w < 8 || h < 8) return;
      // cover : remplit tout le conteneur (peut rogner un peu les bords)
      const next = Math.max(w / PREVIEW_VW, h / PREVIEW_VH);
      if (Math.abs(next - this.previewScale) < 0.001) return;
      this.previewScale = next;
      this.cdr.detectChanges();
    };
    apply();
    this.previewResizeObs = new ResizeObserver(() => apply());
    this.previewResizeObs.observe(stage);
  }

  private teardownPreviewScale(): void {
    this.previewResizeObs?.disconnect();
    this.previewResizeObs = undefined;
  }

  /** Ingress manquant alors que le déploiement est RUNNING. */
  get ingressBroken(): boolean {
    if (!this.dep || this.isStopped || this.dep.status === 'FAILED') return false;
    if (this.dep.status !== 'RUNNING') return false;
    const state = this.dep.servicesState;
    if (!state || state['ingressApplied'] === undefined || state['ingressApplied'] === null) {
      return false;
    }
    return state['ingressApplied'] === false;
  }

  get ingressWarning(): string | null {
    if (!this.ingressBroken) return null;
    const err = this.dep?.servicesState?.['ingressError'];
    return err
      ? `Ingress non appliqué : ${err}`
      : 'Pods prêts, mais Ingress non appliqué — URL publique indisponible.';
  }

  /** Affiche Stopped si le déploiement est arrêté, même si servicesState dit encore Ready. */
  displayStatus(status: string): string {
    if (this.isStopped) return 'Stopped';
    return status || 'NotReady';
  }

  ngOnDestroy(): void {
    this.poll?.unsubscribe();
    this.podsPoll?.unsubscribe();
    this.ciPoll?.unsubscribe();
    this.clearTtlTimer();
    this.teardownPreviewScale();
  }

  private setupTtlCountdown(): void {
    this.clearTtlTimer();
    this.ttlLabel = '';
    this.ttlProgress = 0;
    this.ttlUrgent = false;
    this.ttlExpired = false;
    this.expiresAtMs = null;
    this.readyAtMs = null;
    this.ttlHours = this.dep?.ttlHours || 0;

    if (!this.dep || this.isStopped || this.dep.status === 'FAILED') {
      this.ttlLabel = this.isStopped ? 'Environnement arrêté' : '';
      return;
    }

    if (this.dep.serverTime) {
      const serverMs = Date.parse(this.dep.serverTime);
      if (!Number.isNaN(serverMs)) {
        this.serverOffsetMs = serverMs - Date.now();
      }
    }

    if (this.dep.expiresAt) {
      this.expiresAtMs = this.parseInstantMs(this.dep.expiresAt);
    }
    if (this.dep.readyAt) {
      this.readyAtMs = this.parseInstantMs(this.dep.readyAt);
    }
    // Fallback : remainingSeconds serveur si expiresAt illisible
    if (!this.expiresAtMs && typeof this.dep.remainingSeconds === 'number' && this.dep.remainingSeconds > 0) {
      this.expiresAtMs = this.nowServerMs() + this.dep.remainingSeconds * 1000;
    }

    this.tickTtl();
    this.ttlTimer = setInterval(() => this.tickTtl(), 1000);
  }

  private parseInstantMs(value: string | number | null | undefined): number | null {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Jackson timestamps = epoch seconds ; JS Date = ms
      return value < 1e12 ? value * 1000 : value;
    }
    const s = String(value).trim();
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = parseFloat(s);
      return n < 1e12 ? n * 1000 : n;
    }
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private clearTtlTimer(): void {
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = undefined;
    }
  }

  private nowServerMs(): number {
    return Date.now() + this.serverOffsetMs;
  }

  private tickTtl(): void {
    if (this.isStopped) {
      this.ttlLabel = 'Environnement arrêté';
      this.ttlProgress = 0;
      this.ttlExpired = true;
      this.clearTtlTimer();
      return;
    }

    if (!this.expiresAtMs) {
      const hrs = this.ttlHours || (this.dep?.servicesState?.ttlHours as number) || 4;
      this.ttlLabel = `TTL ${hrs}h — démarre quand l'environnement est Ready`;
      this.ttlProgress = 0;
      this.ttlUrgent = false;
      this.ttlExpired = false;
      return;
    }

    const now = this.nowServerMs();
    const remainingMs = this.expiresAtMs - now;
    if (remainingMs <= 0) {
      this.ttlLabel = 'Expiré — nettoyage cluster en cours…';
      this.ttlProgress = 100;
      this.ttlUrgent = true;
      this.ttlExpired = true;
      return;
    }

    const totalMs = this.readyAtMs && this.expiresAtMs > this.readyAtMs
      ? this.expiresAtMs - this.readyAtMs
      : (this.ttlHours > 0 ? this.ttlHours : 4) * 3600_000;
    const elapsed = Math.max(0, totalMs - remainingMs);
    this.ttlProgress = Math.min(100, Math.round((elapsed / totalMs) * 100));
    this.ttlUrgent = remainingMs < 15 * 60_000;
    this.ttlExpired = false;
    this.ttlLabel = this.formatDuration(remainingMs);
  }

  private formatDuration(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    return `${m}m ${String(s).padStart(2, '0')}s`;
  }

  get canExtendTtl(): boolean {
    if (!this.dep || this.isStopped || this.dep.status === 'FAILED') return false;
    if (!this.expiresAtMs) return false;
    if (this.ttlExpired) return false;
    // Plafond 72 h depuis Ready
    const ready = this.readyAtMs || (this.expiresAtMs - (this.ttlHours || 4) * 3600_000);
    const maxExpires = ready + 72 * 3600_000;
    return this.expiresAtMs < maxExpires - 60_000;
  }

  extendTtl(hours: number): void {
    if (!this.appId || !this.dep?.id || !this.canExtendTtl || this.extendingTtl) return;
    if (!confirm(`Prolonger le TTL de ${hours} h ?`)) return;
    this.extendingTtl = true;
    this.extendTtlError = null;
    this.extendTtlMessage = null;
    this.api.extendDeploymentTtl(this.appId, this.dep.id, hours).subscribe({
      next: (updated) => {
        this.extendingTtl = false;
        this.dep = updated;
        this.extendTtlMessage = `TTL prolongé de ${hours} h.`;
        this.setupTtlCountdown();
      },
      error: (e) => {
        this.extendingTtl = false;
        this.extendTtlError = e?.error?.message || 'Impossible de prolonger le TTL.';
      }
    });
  }

  private setupPolling(): void {
    this.poll?.unsubscribe();
    if (!this.dep || !this.appId) return;
    if (this.dep.status !== 'DEPLOYING' && this.dep.status !== 'PENDING') return;

    this.poll = interval(5000)
      .pipe(switchMap(() => this.api.getDeployment(this.appId, this.dep.id)))
      .subscribe({
        next: (updated) => {
          this.dep = updated;
          this.setupTtlCountdown();
          this.syncPreviewUrl();
          if (updated.gitlabPipelineId) {
            this.refreshCiPipeline(true);
            this.setupCiPolling();
          }
          if (updated.status !== 'DEPLOYING' && updated.status !== 'PENDING') {
            this.poll?.unsubscribe();
            this.setupPodsPolling();
            if (updated.status !== 'STOPPED') {
              this.refreshPods();
            } else {
              this.pods = [];
            }
          }
        },
        error: () => {}
      });
  }

  private setupPodsPolling(): void {
    this.podsPoll?.unsubscribe();
    if (!this.dep || !this.appId) return;
    if (this.dep.status === 'STOPPED' || this.dep.status === 'FAILED') return;

    this.podsPoll = interval(10000).subscribe(() => this.refreshPods(true));
  }

  refreshPods(silent = false): void {
    if (!this.appId || !this.dep?.id) return;
    if (this.dep.status === 'STOPPED' || this.dep.status === 'FAILED') {
      this.pods = [];
      this.monitorAlerts = [];
      this.monitorHealth = null;
      this.monitorSummary = null;
      this.monitorAppUrl = null;
      this.metricsAvailable = false;
      this.podsLoading = false;
      this.podsError = null;
      this.podsPoll?.unsubscribe();
      return;
    }
    if (!silent) {
      this.podsLoading = true;
      this.podsError = null;
    }
    this.api.getDeploymentMonitoring(this.appId, this.dep.id).subscribe({
      next: (res) => {
        if (this.dep.status === 'STOPPED') {
          this.pods = [];
          this.podsLoading = false;
          return;
        }
        this.pods = res.pods || [];
        this.monitorAlerts = res.alerts || [];
        this.monitorHealth = res.health || null;
        this.monitorSummary = res.summary || null;
        this.monitorAppUrl = res.appUrl || null;
        this.metricsAvailable = !!res.summary?.metricsAvailable;
        this.podsLoading = false;
        this.podsError = null;
        this.syncPreviewUrl();
        this.ensureDefaultPodSelected();
      },
      error: (e) => {
        this.podsLoading = false;
        if (!silent) {
          this.podsError = e?.error?.message || 'Impossible de charger le monitoring.';
        }
      }
    });
  }

  healthBadgeClass(): string {
    if (!this.monitorHealth?.checked) return 'status-pending';
    if (this.monitorHealth.ok === true) return 'status-running';
    if (this.monitorHealth.ok === false) return 'status-failed';
    return 'status-pending';
  }

  alertClass(severity: string): string {
    return severity === 'error' ? 'am-alert-error' : 'am-alert';
  }

  openLogs(workload: string): void {
    if (!workload || !this.appId || !this.dep?.id) return;
    this.closeCiLogs();
    this.selectedWorkload = workload;
    this.logsLoading = true;
    this.logsError = null;
    this.logs = '';
    this.api.getDeploymentLogs(this.appId, this.dep.id, workload, 400).subscribe({
      next: (res) => {
        this.logs = res.logs || '(vide)';
        this.logsPod = res.pod || '';
        this.logsLoading = false;
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.logsLoading = false;
        this.logsError = e?.error?.message || e?.message || 'Impossible de lire les logs.';
        this.logs = '';
        this.cdr.markForCheck();
      }
    });
  }

  /** Ouvre les logs d’un service / d’une base (résolution du label K8s `app`). */
  openEntryLogs(entry: StateEntry, kind: 'service' | 'database' = 'service'): void {
    const wl = this.resolveEntryWorkload(entry, kind);
    if (wl) this.openLogs(wl);
  }

  entryWorkloadKey(entry: StateEntry, kind: 'service' | 'database' = 'service'): string {
    return this.resolveEntryWorkload(entry, kind) || entry.name;
  }

  /** Premier pod sélectionné par défaut (onglet Pods). */
  private ensureDefaultPodSelected(force = false): void {
    if (!force && this.showOpsTabs && this.opsTab !== 'pods') return;
    if (!this.pods.length) {
      this.selectedWorkload = null;
      return;
    }
    if (!force && this.selectedWorkload) {
      const still = this.pods.some(p => (p.workload || p.name) === this.selectedWorkload);
      if (still) return;
    }
    const first = this.pods[0];
    this.openLogs(first.name || first.workload || '');
  }

  private ensureDefaultServiceSelected(force = false): void {
    if (this.isStopped || !this.serviceEntries.length) {
      this.closeLogs();
      return;
    }
    if (!force && this.showOpsTabs && this.opsTab !== 'services') return;
    if (!force && this.selectedWorkload) {
      const still = this.serviceEntries.some(s => this.entryWorkloadKey(s, 'service') === this.selectedWorkload);
      if (still) return;
    }
    this.openEntryLogs(this.serviceEntries[0], 'service');
  }

  private ensureDefaultDatabaseSelected(force = false): void {
    if (this.isStopped || !this.databaseEntries.length) {
      this.closeLogs();
      return;
    }
    if (!force && this.showOpsTabs && this.opsTab !== 'databases') return;
    if (!force && this.selectedWorkload) {
      const still = this.databaseEntries.some(d => this.entryWorkloadKey(d, 'database') === this.selectedWorkload);
      if (still) return;
    }
    this.openEntryLogs(this.databaseEntries[0], 'database');
  }

  closeLogs(): void {
    this.selectedWorkload = null;
    this.logs = '';
    this.logsPod = '';
    this.logsError = null;
  }

  private setupCiPolling(): void {
    this.ciPoll?.unsubscribe();
    if (!this.dep?.gitlabPipelineId || !this.appId || this.isStopped) return;

    this.ciPoll = interval(5000).subscribe(() => {
      if (!this.shouldPollCi()) {
        this.ciPoll?.unsubscribe();
        return;
      }
      this.refreshCiPipeline(true);
    });
  }

  private shouldPollCi(): boolean {
    if (!this.dep?.gitlabPipelineId) return false;
    if (this.isStopped || this.dep.status === 'FAILED') return false;
    if (this.dep.status === 'DEPLOYING' || this.dep.status === 'PENDING') return true;
    const st = (this.ciPipeline?.status || '').toLowerCase();
    return st === 'running' || st === 'pending' || st === 'created' || st === 'waiting_for_resource';
  }

  refreshCiPipeline(silent = false): void {
    if (this.isStopped) {
      this.ciPipeline = null;
      this.ciLoading = false;
      this.ciError = null;
      this.ciPoll?.unsubscribe();
      return;
    }
    if (!this.appId || !this.dep?.id || !this.dep.gitlabPipelineId) {
      this.ciPipeline = null;
      this.ciError = null;
      this.ciLoading = false;
      return;
    }
    if (!silent) {
      this.ciLoading = true;
      this.ciError = null;
    }
    this.api.getDeploymentCiPipeline(this.appId, this.dep.id).subscribe({
      next: (res) => {
        this.ciPipeline = res;
        this.ciLoading = false;
        this.ciError = null;
        // Sélection par défaut : premier job (ou conserver le job courant)
        this.ensureDefaultCiJobSelected(res.jobs || []);
        // Rafraîchir les logs du job sélectionné s'il est encore en cours
        if (this.selectedCiJob && this.isCiJobActive(this.selectedCiJob)) {
          const updated = (res.jobs || []).find((j) => Number(j.id) === Number(this.selectedCiJob!.id));
          if (updated) {
            this.selectedCiJob = updated;
            this.loadCiJobLogs(Number(updated.id), true);
          }
        }
        if (!this.shouldPollCi()) {
          this.ciPoll?.unsubscribe();
        } else if (!this.ciPoll || this.ciPoll.closed) {
          this.setupCiPolling();
        }
      },
      error: (e) => {
        this.ciLoading = false;
        if (!silent) {
          this.ciError = e?.error?.message || 'Impossible de charger le pipeline CI.';
        }
      }
    });
  }

  /** Choisit un job par défaut si aucun n'est sélectionné. */
  private ensureDefaultCiJobSelected(jobs: PipelineJobInfo[]): void {
    if (!jobs.length) {
      this.selectedCiJob = null;
      this.ciJobLogs = '';
      return;
    }
    if (this.selectedCiJob) {
      const stillThere = jobs.find(j => Number(j.id) === Number(this.selectedCiJob!.id));
      if (stillThere) {
        this.selectedCiJob = stillThere;
        // Recharger les logs si le panneau est vide (ex. après changement d'onglet)
        if (!this.ciJobLogs && !this.ciJobLogsLoading && !this.ciJobLogsError) {
          this.loadCiJobLogs(Number(stillThere.id), false);
        }
        return;
      }
    }
    // Préférer un job failed, sinon running, sinon le premier
    const preferred =
      jobs.find(j => {
        const s = this.normCiStatus(j.status);
        return s === 'failed' || s === 'canceled';
      }) ||
      jobs.find(j => this.isCiJobActive(j)) ||
      jobs[0];
    this.selectCiJob(preferred);
  }

  /** Clic sur un stage → sélectionne le premier job du stage. */
  selectCiStage(stage: { name: string; jobs: PipelineJobInfo[] }): void {
    const jobs = stage?.jobs || [];
    if (!jobs.length) return;
    const preferred =
      jobs.find(j => {
        const s = this.normCiStatus(j.status);
        return s === 'failed' || s === 'canceled';
      }) ||
      jobs.find(j => this.isCiJobActive(j)) ||
      jobs[0];
    this.selectCiJob(preferred);
  }

  selectCiJob(job: PipelineJobInfo): void {
    const id = Number(job?.id);
    if (!job || !Number.isFinite(id) || id <= 0) {
      this.ciJobLogsError = 'Job sans identifiant GitLab — logs indisponibles.';
      this.selectedCiJob = job || null;
      this.ciJobLogs = '';
      return;
    }
    this.closeLogs();
    this.selectedCiJob = job;
    this.logAiResult = null;
    this.logAiError = null;
    this.logAiQuestion = '';
    this.loadCiJobLogs(id, false);
  }

  private loadCiJobLogs(jobId: number, silent: boolean): void {
    if (!this.appId || !this.dep?.id) return;
    if (!silent) {
      this.ciJobLogsLoading = true;
      this.ciJobLogsError = null;
      this.ciJobLogs = '';
    }
    this.api.getDeploymentCiJobLogs(this.appId, this.dep.id, jobId).subscribe({
      next: (logs) => {
        this.ciJobLogs = logs || '(vide)';
        this.ciJobLogsLoading = false;
        this.ciJobLogsError = null;
      },
      error: (e) => {
        this.ciJobLogsLoading = false;
        if (!silent) {
          const st = this.normCiStatus(this.selectedCiJob?.status);
          this.ciJobLogsError = (st === 'pending' || st === 'running' || st === 'created')
            ? 'Logs pas encore disponibles — job en cours.'
            : (e?.error?.message || e?.message || 'Logs CI indisponibles.');
        }
      }
    });
  }

  closeCiLogs(): void {
    this.selectedCiJob = null;
    this.ciJobLogs = '';
    this.ciJobLogsError = null;
    this.ciJobLogsLoading = false;
    // garde la conversation IA (questions projet / URL)
  }

  explainLogsWithAi(): void {
    this.askPipelineAi(true);
  }

  /**
   * @param explainLog true = bouton « Expliquer ce log » (question défaut sur l’échec)
   */
  askPipelineAi(explainLog = false): void {
    if (this.logAiLoading) return;
    const typed = this.logAiQuestion?.trim() || '';
    if (!explainLog && !typed) return;
    if (explainLog && !this.ciJobLogs?.trim()) {
      this.logAiError = 'Charge d’abord les logs du job, ou pose une question libre (URL, statut…).';
      return;
    }
    this.logAiLoading = true;
    this.logAiError = null;
    const question = typed || (explainLog
      ? 'Explique-moi ce log : qu\'est-ce qui a échoué et quelles sont les causes probables ?'
      : '');
    const stagesOverview = this.ciStages
      .map(s => `${s.name}=${(s.status || '').toLowerCase()}`)
      .join('; ');
    this.aiAnalysisService.explainPipelineLogs({
      logs: this.ciJobLogs || undefined,
      jobName: this.selectedCiJob?.name,
      stageName: this.selectedCiJob?.stage,
      jobStatus: this.selectedCiJob?.status,
      pipelineKind: 'DEPLOY',
      stagesOverview,
      projectHint: 'EnviroTest — déploiement K8s géré',
      projectContext: this.buildAiProjectContext(),
      userQuestion: question
    }).subscribe({
      next: (res) => {
        this.logAiResult = res;
        this.logAiLoading = false;
        this.cdr.detectChanges();
        setTimeout(() => this.scrollLogAiIntoView(), 50);
      },
      error: (err) => {
        this.logAiLoading = false;
        this.logAiError = err?.error?.message || err?.message || 'Erreur lors de l\'explication IA.';
        this.cdr.markForCheck();
      }
    });
  }

  private buildAiProjectContext(): string {
    const lines: string[] = [];
    lines.push(`appId: ${this.appId || '—'}`);
    if (this.dep) {
      lines.push(`deploymentId: ${this.dep.id}`);
      lines.push(`namespace: ${this.dep.namespace || '—'}`);
      lines.push(`deploymentStatus: ${this.dep.status}`);
      lines.push(`gitlabPipelineId: ${this.dep.gitlabPipelineId ?? '—'}`);
      lines.push(`pipelineStatus: ${this.ciPipeline?.status || '—'}`);
      if (this.ciPipeline?.webUrl) lines.push(`gitlabPipelineUrl: ${this.ciPipeline.webUrl}`);
    }
    const appUrl = this.frontendUrl;
    if (appUrl) lines.push(`appUrl: ${appUrl}`);
    if (this.monitorAppUrl) lines.push(`monitorAppUrl: ${this.monitorAppUrl}`);
    const backendUrl = this.backendUrl;
    if (backendUrl) lines.push(`backendUrl: ${backendUrl}`);
    const services = this.serviceEntries || [];
    if (services.length) {
      lines.push('services:');
      for (const s of services) {
        lines.push(
          `  - name=${s.name}; role=${s.role || '—'}; status=${s.status}; host=${s.internalHost || '—'}; externalUrl=${s.externalUrl || '—'}`
        );
      }
    }
    if (this.services?.length) {
      lines.push('configuredServices:');
      for (const s of this.services) {
        lines.push(`  - id=${s.id}; name=${s.name}; role=${s.role || '—'}`);
      }
    }
    const pods = this.pods || [];
    if (pods.length) {
      lines.push('pods:');
      for (const p of pods.slice(0, 20)) {
        lines.push(
          `  - name=${p.name}; phase=${p.phase || '—'}; ready=${p.ready}; workload=${p.workload || '—'}`
        );
      }
    }
    return lines.join('\n');
  }

  private scrollLogAiIntoView(): void {
    try {
      const el = document.querySelector('.ds-log-ai-result') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch { /* ignore */ }
  }

  isCiJobActive(job: PipelineJobInfo | null | undefined): boolean {
    const st = this.normCiStatus(job?.status);
    return st === 'pending' || st === 'running' || st === 'created' || st === 'waiting_for_resource';
  }

  normCiStatus(status: string | null | undefined): string {
    return (status || '').toLowerCase();
  }

  ciJobStatusClass(status: string): string {
    const s = this.normCiStatus(status);
    if (s === 'success') return 'status-running';
    if (s === 'failed' || s === 'canceled' || s === 'cancelled') return 'status-failed';
    return 'status-pending';
  }

  serviceIdFor(name: string): string | null {
    if (!name || !this.services?.length) return null;
    const found = this.services.find((s) => s.name === name);
    return found?.id || null;
  }

  canRebuild(s: StateEntry): boolean {
    if (!this.dep || this.dep.status === 'STOPPED' || this.dep.status === 'FAILED') return false;
    if (this.dep.status === 'DEPLOYING' || this.dep.status === 'PENDING') return false;
    return !!this.serviceIdFor(s.name);
  }

  rebuildService(s: StateEntry): void {
    const sid = this.serviceIdFor(s.name);
    if (!sid || !this.appId) return;
    if (!confirm(`Rebuild « ${s.name} » uniquement (même namespace) ?\nLes autres services ne seront pas reconstruits.`)) {
      return;
    }
    this.rebuildingServiceId = sid;
    this.rebuildError = null;
    this.rebuildMessage = null;
    this.api.rebuildService(this.appId, sid).subscribe({
      next: (updated) => {
        this.rebuildingServiceId = null;
        this.dep = updated;
        this.rebuildMessage = `Rebuild « ${s.name} » lancé — pipeline CI en cours.`;
        this.setupPolling();
        this.setupCiPolling();
        this.refreshCiPipeline();
        this.refreshPods();
      },
      error: (e) => {
        this.rebuildingServiceId = null;
        this.rebuildError = e?.error?.message || 'Échec du rebuild.';
      }
    });
  }

  /** Extrait le nom K8s (label app) depuis internalHost / URL. */
  workloadFromHost(host: string): string | null {
    if (!host) return null;
    let h = host.trim();
    // jdbc:postgresql://db-x.ns.svc… → db-x.ns.svc…
    const schemeIdx = h.indexOf('://');
    if (schemeIdx >= 0) h = h.slice(schemeIdx + 3);
    h = h.split('/')[0].split(':')[0]; // drop path / port
    const first = h.split('.')[0];
    return first || null;
  }

  /** Normalise comme AppNaming.k8sName côté backend. */
  k8sWorkloadName(input: string): string {
    if (!input?.trim()) return 'x';
    let s = input.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
    if (!s) s = 'x';
    if (s.length > 50) s = s.slice(0, 50).replace(/-+$/, '');
    return s || 'x';
  }

  /**
   * Résout le label K8s `app` pour un service / une base :
   * pods → DNS interne → nom normalisé (db-… pour les bases).
   */
  resolveEntryWorkload(entry: StateEntry, kind: 'service' | 'database' = 'service'): string | null {
    if (!entry) return null;
    const fromHost = this.workloadFromHost(entry.internalHost || '');
    const slug = this.k8sWorkloadName(entry.name);
    const candidates = kind === 'database'
      ? [fromHost, slug.startsWith('db-') ? slug : `db-${slug}`, slug, entry.name]
      : [fromHost, slug, entry.name];
    const uniq = [...new Set(candidates.filter((c): c is string => !!c))];

    for (const c of uniq) {
      const pod = this.pods.find(p =>
        p.workload === c || p.name === c || (p.name || '').startsWith(c + '-')
      );
      if (pod?.workload) return pod.workload;
      if (pod?.name) return pod.workload || c;
    }
    return uniq[0] || null;
  }

  serviceEntryForWorkload(workload: string | null): StateEntry | null {
    if (!workload) return null;
    return this.serviceEntries.find(s => this.entryWorkloadKey(s, 'service') === workload) || null;
  }

  private entries(section: 'services' | 'databases'): StateEntry[] {
    const state = this.dep?.servicesState?.[section];
    if (!state) return [];
    return Object.keys(state).map((name) => {
      const roleFromState = state[name]?.role || null;
      const roleFromApp = this.services?.find(s => s.name === name)?.role || null;
      return {
        name,
        status: state[name]?.status || 'NotReady',
        wave: state[name]?.wave ?? 0,
        internalHost: state[name]?.internalHost || '',
        externalUrl: state[name]?.externalUrl || null,
        role: roleFromState || roleFromApp
      };
    });
  }

  get serviceEntries(): StateEntry[] {
    return this.entries('services');
  }

  /** Libellé clair : URL app vs API backend (path /api). */
  externalUrlLabel(s: StateEntry): string {
    const role = (s.role || '').toUpperCase();
    if (role === 'FRONTEND') return 'URL app (frontend)';
    if (role === 'BACKEND') return 'URL API (backend)';
    const url = (s.externalUrl || '').replace(/\/$/, '');
    if (url.endsWith('/api')) return 'URL API (backend)';
    return 'URL externe';
  }

  get databaseEntries(): StateEntry[] {
    return this.entries('databases');
  }

  statusClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'ready') return 'status-running';
    if (s === 'stopped') return 'status-stopped';
    if (s === 'failed') return 'status-failed';
    return 'status-pending';
  }

  podPhaseClass(phase: string, ready: boolean): string {
    // Aligné sur les pastilles pipeline (success / failed / pending)
    if (ready || (phase || '').toLowerCase() === 'running') return 'status-running';
    const p = (phase || '').toLowerCase();
    if (p === 'failed' || p === 'unknown' || p === 'error' || p === 'crashloopbackoff') return 'status-failed';
    return 'status-pending';
  }

  podStatusLabel(phase: string, ready: boolean): string {
    if (ready || (phase || '').toLowerCase() === 'running') return 'success';
    const p = (phase || '').toLowerCase();
    if (p === 'failed' || p === 'unknown' || p === 'error' || p === 'crashloopbackoff') return 'failed';
    return (phase || 'pending').toLowerCase();
  }

  displayUrl(db: AppDatabaseModel): string {
    const masked = db.generatedConnectionUrl || '';
    const pwd = db.id ? this.revealed[db.id] : undefined;
    if (pwd && masked.includes(SECRET_MASK)) {
      return masked.replace(SECRET_MASK, pwd);
    }
    return masked;
  }

  isRevealable(db: AppDatabaseModel): boolean {
    return !!db.generatedConnectionUrl && db.generatedConnectionUrl.includes(SECRET_MASK) && !!db.hasRootPassword;
  }

  toggleReveal(db: AppDatabaseModel): void {
    if (!db.id) return;
    if (this.revealed[db.id]) {
      delete this.revealed[db.id];
      return;
    }
    this.revealing[db.id] = true;
    this.api.revealSecret(this.appId, this.dep.id, { type: 'DB_PASSWORD', targetId: db.id }).subscribe({
      next: (res) => {
        this.revealed[db.id!] = res.value;
        this.revealing[db.id!] = false;
      },
      error: () => {
        this.revealing[db.id!] = false;
      }
    });
  }

  copy(text: string): void {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }
}
