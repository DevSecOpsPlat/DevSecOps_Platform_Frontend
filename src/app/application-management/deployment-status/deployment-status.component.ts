import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
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

interface StateEntry {
  name: string;
  status: string;
  wave: number;
  internalHost: string;
  externalUrl?: string | null;
}

@Component({
  selector: 'app-managed-deployment-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './deployment-status.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class DeploymentStatusComponent implements OnChanges, OnDestroy {
  @Input() appId!: string;
  @Input() deployment!: AppDeployment;
  @Input() services: AppServiceModel[] = [];

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

  constructor(private api: ApplicationManagementService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['deployment'] && this.deployment) {
      this.dep = this.deployment;
      this.closeLogs();
      this.closeCiLogs();
      this.setupPolling();
      this.setupPodsPolling();
      this.setupCiPolling();
      this.setupTtlCountdown();
      if (this.isStopped) {
        this.pods = [];
        this.podsError = null;
        this.podsLoading = false;
        this.rebuildMessage = null;
        this.ciPipeline = null;
      } else {
        this.refreshPods();
        this.refreshCiPipeline();
      }
    }
  }

  get isStopped(): boolean {
    return this.dep?.status === 'STOPPED';
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
        this.logsPod = res.pod;
        this.logsLoading = false;
      },
      error: (e) => {
        this.logsLoading = false;
        this.logsError = e?.error?.message || 'Impossible de lire les logs.';
      }
    });
  }

  closeLogs(): void {
    this.selectedWorkload = null;
    this.logs = '';
    this.logsPod = '';
    this.logsError = null;
  }

  private setupCiPolling(): void {
    this.ciPoll?.unsubscribe();
    if (!this.dep?.gitlabPipelineId || !this.appId) return;

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
    if (this.dep.status === 'DEPLOYING' || this.dep.status === 'PENDING') return true;
    const st = (this.ciPipeline?.status || '').toLowerCase();
    return st === 'running' || st === 'pending' || st === 'created' || st === 'waiting_for_resource';
  }

  refreshCiPipeline(silent = false): void {
    if (!this.appId || !this.dep?.id || !this.dep.gitlabPipelineId) {
      this.ciPipeline = null;
      this.ciError = null;
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
        // Rafraîchir les logs du job sélectionné s'il est encore en cours
        if (this.selectedCiJob && this.isCiJobActive(this.selectedCiJob)) {
          const updated = (res.jobs || []).find((j) => j.id === this.selectedCiJob!.id);
          if (updated) {
            this.selectedCiJob = updated;
            this.loadCiJobLogs(updated.id, true);
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

  selectCiJob(job: PipelineJobInfo): void {
    if (!job?.id) return;
    this.closeLogs();
    this.selectedCiJob = job;
    this.loadCiJobLogs(job.id, false);
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

  /** Extrait le nom K8s (label app) depuis internalHost. */
  workloadFromHost(host: string): string | null {
    if (!host) return null;
    const first = host.split('.')[0];
    return first || null;
  }

  private entries(section: 'services' | 'databases'): StateEntry[] {
    const state = this.dep?.servicesState?.[section];
    if (!state) return [];
    return Object.keys(state).map((name) => ({
      name,
      status: state[name]?.status || 'NotReady',
      wave: state[name]?.wave ?? 0,
      internalHost: state[name]?.internalHost || '',
      externalUrl: state[name]?.externalUrl || null
    }));
  }

  get serviceEntries(): StateEntry[] {
    return this.entries('services');
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
    if (ready && phase === 'Running') return 'status-running';
    if (phase === 'Failed' || phase === 'Unknown') return 'status-failed';
    return 'status-pending';
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
