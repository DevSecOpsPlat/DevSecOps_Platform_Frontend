import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, finalize, takeUntil } from 'rxjs/operators';
import {
  AppDeployment,
  AppServiceModel,
  ScanBatchServiceState,
  ScanBatchState
} from '../../models/application-management/application-management.models';
import { PipelineJobInfo, PipelineScanResponse } from '../../models/pipeline/pipeline-scan-response';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { sortStageNames } from '../../shared/ci-stage-order';
import { DeploymentStatusComponent } from '../deployment-status/deployment-status.component';
import { verdictLabelFr, verdictTone } from '../shared/verdict.util';

export interface HistoryScanQgItem {
  id: string;
  label: string;
  status: string;
  message?: string;
  scope?: string;
}

export interface HistoryScanServiceQg {
  serviceId?: string;
  serviceName?: string;
  status?: string;
  finished?: boolean;
  sonarQg?: string | null;
  secrets?: number | null;
  critical?: number | null;
  high?: number | null;
  hardGateViolated?: boolean;
  hardGateIds?: string[];
}

export type HistoryKindFilter = 'ALL' | 'SCAN' | 'DEPLOY';
export type HistoryPeriodFilter = 'ALL' | '24h' | '7d' | '30d';

export interface HistoryTimelineRow {
  kind: 'deploy' | 'scan';
  id: string;
  at: string;
  status: string;
  title: string;
  description: string;
  gitlabPipelineId?: number | null;
  verdict?: string | null;
  gitBranch?: string | null;
  shortSha?: string | null;
  ttlHours?: number | null;
  serviceCount?: number | null;
  finishedCount?: number | null;
  expectedCount?: number | null;
  securityScore?: number | null;
  grade?: string | null;
  bySeverity?: { critical: number; high: number; medium: number; low: number; info: number } | null;
  serviceNames?: string[];
  serviceIds?: string[];
  triggeredByUserId?: string | null;
  previewUrl?: string | null;
  environment?: string | null;
}

@Component({
  selector: 'app-managed-app-history',
  standalone: true,
  imports: [CommonModule, FormsModule, DeploymentStatusComponent],
  templateUrl: './managed-app-history.component.html',
  styleUrls: ['../shared/app-management.shared.css', './managed-app-history.component.css']
})
export class ManagedAppHistoryComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) appId!: string;
  @Input() appName = '';
  @Input() services: AppServiceModel[] = [];
  @Output() navigateSection = new EventEmitter<'monitoring' | 'alerts' | 'history' | 'deployments'>();

  private readonly destroy$ = new Subject<void>();
  private readonly scanDetailLoad$ = new Subject<void>();
  private readonly scanJobLogsLoad$ = new Subject<void>();

  loading = false;
  error: string | null = null;
  rows: HistoryTimelineRow[] = [];
  private deployments: AppDeployment[] = [];
  private scanBatches: ScanBatchState[] = [];

  /** Détail environnement ouvert inline (même panel Runtime). */
  selectedDeployId: string | null = null;

  /** Détail scan : pipeline (stages/logs) + Quality Gate. */
  selectedScanId: string | null = null;
  scanDetailTab: 'pipeline' | 'quality-gate' = 'pipeline';
  scanPipeline: PipelineScanResponse | null = null;
  scanPipelineLoading = false;
  scanPipelineError: string | null = null;
  selectedScanJob: PipelineJobInfo | null = null;
  scanJobLogs = '';
  scanJobLogsLoading = false;
  scanJobLogsError: string | null = null;

  kindFilter: HistoryKindFilter = 'ALL';
  statusFilter = 'ALL';
  serviceFilter = 'ALL';
  periodFilter: HistoryPeriodFilter = 'ALL';
  searchQuery = '';

  readonly periodOptions: Array<{ id: HistoryPeriodFilter; label: string }> = [
    { id: 'ALL', label: 'Tout' },
    { id: '24h', label: '24 h' },
    { id: '7d', label: '7 j' },
    { id: '30d', label: '30 j' }
  ];

  constructor(
    private api: ApplicationManagementService,
    private pipelineApi: PipelineService,
    private router: Router
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['appId'] && this.appId) {
      this.reload();
    }
  }

  ngOnDestroy(): void {
    this.scanJobLogsLoad$.next();
    this.scanJobLogsLoad$.complete();
    this.scanDetailLoad$.next();
    this.scanDetailLoad$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get selectedDeployment(): AppDeployment | null {
    if (!this.selectedDeployId) return null;
    return this.deployments.find(d => d.id === this.selectedDeployId) || null;
  }

  get selectedBatch(): ScanBatchState | null {
    if (!this.selectedScanId) return null;
    return this.scanBatches.find(b => (b.batchId || b.id) === this.selectedScanId) || null;
  }

  get selectedScanRow(): HistoryTimelineRow | null {
    if (!this.selectedScanId) return null;
    return this.rows.find(r => r.kind === 'scan' && r.id === this.selectedScanId) || null;
  }

  /** Checklist hard gates dérivée du lot sélectionné. */
  get scanQualityGates(): HistoryScanQgItem[] {
    return this.buildScanQualityGates(this.selectedBatch);
  }

  get scanServiceQgs(): HistoryScanServiceQg[] {
    return this.buildScanServiceQgs(this.selectedBatch);
  }

  /** Jobs CI regroupés par stage (même UX que Runtime). */
  get scanCiStages(): { name: string; status: string; jobs: PipelineJobInfo[] }[] {
    const jobs = this.scanPipeline?.jobs || [];
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

  get statusOptions(): string[] {
    const set = new Set<string>();
    for (const r of this.rows) {
      const s = (r.status || '').toUpperCase();
      if (s && s !== '—') set.add(s);
    }
    return ['ALL', ...Array.from(set).sort()];
  }

  /** Services de l'app pour le filtre (id + nom). */
  get serviceOptions(): Array<{ id: string; name: string }> {
    return (this.services || [])
      .filter(s => !!s.id && !!s.name)
      .map(s => ({ id: s.id!, name: s.name! }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  get filteredRows(): HistoryTimelineRow[] {
    let list = [...this.rows];

    if (this.kindFilter === 'SCAN') {
      list = list.filter(r => r.kind === 'scan');
    } else if (this.kindFilter === 'DEPLOY') {
      list = list.filter(r => r.kind === 'deploy');
    }

    if (this.statusFilter !== 'ALL') {
      const want = this.statusFilter.toUpperCase();
      list = list.filter(r => (r.status || '').toUpperCase() === want);
    }

    if (this.serviceFilter !== 'ALL') {
      const svc = this.services.find(s => s.id === this.serviceFilter);
      const wantId = this.serviceFilter;
      const wantName = (svc?.name || '').toLowerCase();
      list = list.filter(r => {
        if (r.serviceIds?.some(id => id === wantId)) return true;
        if (wantName && r.serviceNames?.some(n => (n || '').toLowerCase() === wantName)) return true;
        return false;
      });
    }

    const cutoff = this.periodCutoffMs();
    if (cutoff != null) {
      list = list.filter(r => {
        const t = r.at ? new Date(r.at).getTime() : 0;
        return t >= cutoff;
      });
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(r => {
        const hay = [
          r.title,
          r.description,
          r.id,
          r.status,
          r.gitBranch,
          r.shortSha,
          r.verdict,
          r.grade,
          r.environment,
          ...(r.serviceNames || [])
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    return list;
  }

  get hasActiveFilters(): boolean {
    return (
      this.kindFilter !== 'ALL'
      || this.statusFilter !== 'ALL'
      || this.serviceFilter !== 'ALL'
      || this.periodFilter !== 'ALL'
      || !!this.searchQuery.trim()
    );
  }

  getCountByType(kind: 'scan' | 'deploy'): number {
    return this.rows.filter(r => r.kind === kind).length;
  }

  reload(): void {
    if (!this.appId) return;
    this.loading = true;
    this.error = null;

    forkJoin({
      deployments: this.api.listDeployments(this.appId).pipe(catchError(() => of([] as AppDeployment[]))),
      batches: this.api.listScanBatches(this.appId).pipe(catchError(() => of([] as ScanBatchState[])))
    })
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loading = false))
      )
      .subscribe({
        next: ({ deployments, batches }) => {
          this.deployments = deployments || [];
          this.scanBatches = batches || [];
          this.rows = this.buildRows(this.deployments, this.scanBatches);
          if (this.selectedDeployId && !this.deployments.some(d => d.id === this.selectedDeployId)) {
            this.selectedDeployId = null;
          }
          if (
            this.selectedScanId
            && !this.scanBatches.some(b => (b.batchId || b.id) === this.selectedScanId)
          ) {
            this.closeScanDetail();
          }
          if (this.statusFilter !== 'ALL' && !this.statusOptions.includes(this.statusFilter)) {
            this.statusFilter = 'ALL';
          }
        },
        error: (e) => {
          this.error = e?.error?.message || 'Impossible de charger l\'historique.';
          this.rows = [];
          this.deployments = [];
          this.scanBatches = [];
        }
      });
  }

  clearFilters(): void {
    this.kindFilter = 'ALL';
    this.statusFilter = 'ALL';
    this.serviceFilter = 'ALL';
    this.periodFilter = 'ALL';
    this.searchQuery = '';
    this.closeInlineDetails();
  }

  setKind(k: HistoryKindFilter): void {
    this.kindFilter = k;
    this.closeInlineDetails();
  }

  setPeriod(p: HistoryPeriodFilter): void {
    this.periodFilter = p;
    this.closeInlineDetails();
  }

  setStatus(s: string): void {
    this.statusFilter = s;
    this.closeInlineDetails();
  }

  setService(s: string): void {
    this.serviceFilter = s;
    this.closeInlineDetails();
  }

  onSearchChange(): void {
    this.closeInlineDetails();
  }

  openActivity(row: HistoryTimelineRow): void {
    if (row.kind === 'deploy') {
      this.toggleDeployDetail(row.id);
      return;
    }
    this.toggleScanDetail(row.id);
  }

  toggleDeployDetail(deploymentId: string): void {
    this.closeScanDetail();
    const opening = this.selectedDeployId !== deploymentId;
    this.selectedDeployId = opening ? deploymentId : null;
    if (opening) {
      setTimeout(() => {
        document.getElementById('mah-env-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  }

  closeDeployDetail(): void {
    this.selectedDeployId = null;
  }

  toggleScanDetail(scanId: string): void {
    this.closeDeployDetail();
    const opening = this.selectedScanId !== scanId;
    if (!opening) {
      this.closeScanDetail();
      return;
    }
    this.selectedScanId = scanId;
    this.scanDetailTab = 'pipeline';
    this.loadScanDetail(scanId);
    setTimeout(() => {
      document.getElementById('mah-scan-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  closeScanDetail(): void {
    this.scanJobLogsLoad$.next();
    this.scanDetailLoad$.next();
    this.selectedScanId = null;
    this.scanDetailTab = 'pipeline';
    this.scanPipeline = null;
    this.scanPipelineError = null;
    this.scanPipelineLoading = false;
    this.clearScanJobSelection();
  }

  closeInlineDetails(): void {
    this.closeDeployDetail();
    this.closeScanDetail();
  }

  setScanDetailTab(tab: 'pipeline' | 'quality-gate'): void {
    this.scanDetailTab = tab;
  }

  refreshScanPipeline(): void {
    if (!this.selectedScanId) return;
    this.loadScanPipelineOnly(this.selectedScanId, true);
  }

  selectScanStage(stage: { name: string; jobs: PipelineJobInfo[] }): void {
    const jobs = stage?.jobs || [];
    if (!jobs.length) return;
    const preferred =
      jobs.find(j => {
        const s = this.normCiStatus(j.status);
        return s === 'failed' || s === 'canceled' || s === 'cancelled';
      })
      || jobs.find(j => this.isCiJobActive(j))
      || jobs[0];
    this.selectScanJob(preferred);
  }

  selectScanJob(job: PipelineJobInfo): void {
    const id = Number(job?.id);
    if (!job || !Number.isFinite(id) || id <= 0) {
      this.selectedScanJob = job || null;
      this.scanJobLogs = '';
      this.scanJobLogsError = 'Job sans identifiant GitLab — logs indisponibles.';
      this.scanJobLogsLoading = false;
      return;
    }
    this.selectedScanJob = job;
    this.loadScanJobLogs(id);
  }

  closeScanJobLogs(): void {
    this.clearScanJobSelection();
  }

  private clearScanJobSelection(): void {
    this.scanJobLogsLoad$.next();
    this.selectedScanJob = null;
    this.scanJobLogs = '';
    this.scanJobLogsError = null;
    this.scanJobLogsLoading = false;
  }

  private loadScanJobLogs(jobId: number): void {
    this.scanJobLogsLoad$.next();
    this.scanJobLogsLoading = true;
    this.scanJobLogsError = null;
    this.scanJobLogs = '';
    this.pipelineApi.getJobLogs(jobId)
      .pipe(
        takeUntil(this.scanJobLogsLoad$),
        takeUntil(this.destroy$),
        finalize(() => {
          if (this.selectedScanJob?.id === jobId) this.scanJobLogsLoading = false;
        }),
        catchError(err => {
          const st = this.normCiStatus(this.selectedScanJob?.status);
          this.scanJobLogsError = (st === 'pending' || st === 'running' || st === 'created')
            ? 'Logs pas encore disponibles — job en cours.'
            : (err?.error?.message || err?.message || 'Logs CI indisponibles.');
          return of('');
        })
      )
      .subscribe(logs => {
        if (this.selectedScanJob?.id !== jobId) return;
        if (this.scanJobLogsError) return;
        this.scanJobLogs = logs || '(vide)';
      });
  }

  private loadScanDetail(scanId: string): void {
    this.scanDetailLoad$.next();
    this.clearScanJobSelection();
    this.scanPipeline = null;
    this.scanPipelineError = null;
    this.scanPipelineLoading = false;

    this.api.getScanBatch(this.appId, scanId)
      .pipe(
        takeUntil(this.scanDetailLoad$),
        takeUntil(this.destroy$),
        catchError(() => of(null))
      )
      .subscribe(batch => {
        if (!batch || this.selectedScanId !== scanId) return;
        const idx = this.scanBatches.findIndex(b => (b.batchId || b.id) === scanId);
        if (idx >= 0) this.scanBatches[idx] = batch;
        else this.scanBatches = [...this.scanBatches, batch];
        this.rows = this.buildRows(this.deployments, this.scanBatches);
      });

    this.loadScanPipelineOnly(scanId, false);
  }

  private loadScanPipelineOnly(scanId: string, keepSelection: boolean): void {
    const pipelineId =
      this.scanBatches.find(b => (b.batchId || b.id) === scanId)?.gitlabPipelineId
      ?? this.rows.find(r => r.kind === 'scan' && r.id === scanId)?.gitlabPipelineId
      ?? null;

    if (pipelineId == null) {
      this.scanPipelineError = 'Aucun pipeline GitLab associé à ce lot de scan.';
      this.scanPipelineLoading = false;
      return;
    }

    this.scanPipelineLoading = true;
    this.scanPipelineError = null;
    this.pipelineApi.getPipelineAndScanLiveById(pipelineId, this.appId)
      .pipe(
        takeUntil(this.scanDetailLoad$),
        takeUntil(this.destroy$),
        finalize(() => {
          if (this.selectedScanId === scanId) this.scanPipelineLoading = false;
        }),
        catchError(err => {
          this.scanPipelineError =
            err?.error?.message || 'Impossible de charger le détail du pipeline.';
          return of(null);
        })
      )
      .subscribe(pipe => {
        if (this.selectedScanId !== scanId) return;
        this.scanPipeline = pipe;
        if (!pipe?.jobs?.length) return;
        if (keepSelection && this.selectedScanJob) {
          const still = pipe.jobs.find(j => j.id === this.selectedScanJob!.id);
          if (still) {
            this.selectedScanJob = still;
            return;
          }
        }
        this.autoSelectScanJob(pipe.jobs);
      });
  }

  private autoSelectScanJob(jobs: PipelineJobInfo[]): void {
    const preferred =
      jobs.find(j => {
        const s = this.normCiStatus(j.status);
        return s === 'failed' || s === 'canceled' || s === 'cancelled';
      })
      || jobs.find(j => this.isCiJobActive(j))
      || jobs[0];
    if (preferred) this.selectScanJob(preferred);
  }

  /** Page complète pipeline (lien secondaire). */
  openFullPipelinePage(event?: Event): void {
    event?.stopPropagation();
    const batch = this.selectedBatch;
    const row = this.selectedScanRow;
    const pipelineId = batch?.gitlabPipelineId ?? row?.gitlabPipelineId ?? null;
    if (pipelineId != null) {
      this.router.navigate(
        ['/projects', this.appId, 'pipeline-detail', String(pipelineId)],
        { queryParams: { kind: 'SCAN' } }
      );
      return;
    }
    this.router.navigate(['/projects', this.appId, 'pipeline-detail'], {
      queryParams: { kind: 'SCAN' }
    });
  }

  openServiceQualityGate(serviceId: string | undefined, event?: Event): void {
    event?.stopPropagation();
    if (!serviceId) return;
    this.router.navigate(['/project', serviceId, 'quality-gate']);
  }

  qualityGateStatusLabel(status: string | null | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'FAIL') return 'Échec';
    if (s === 'PASS') return 'OK';
    if (s === 'WARN') return 'Attention';
    return 'Inconnu';
  }

  verdictToneClass(verdict: string | null | undefined): string {
    return 'mah-verdict-' + verdictTone(verdict);
  }

  normCiStatus(status: string | null | undefined): string {
    return (status || '').toLowerCase();
  }

  isCiJobActive(job: PipelineJobInfo | null | undefined): boolean {
    const st = this.normCiStatus(job?.status);
    return st === 'pending' || st === 'running' || st === 'created' || st === 'waiting_for_resource';
  }

  ciJobStatusClass(status: string | null | undefined): string {
    const s = this.normCiStatus(status);
    if (s === 'success') return 'status-running';
    if (s === 'failed' || s === 'canceled' || s === 'cancelled') return 'status-failed';
    return 'status-pending';
  }

  jobRowClass(status: string | null | undefined): string {
    const s = this.normCiStatus(status);
    if (s === 'success' || s === 'ready') return 'job-success';
    if (s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'stopped') return 'job-failed';
    if (s === 'running' || s === 'pending' || s === 'created' || s === 'notready') return 'job-running';
    return '';
  }

  formatJobDuration(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds)) return '';
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  private aggregateJobStatus(jobs: PipelineJobInfo[]): string {
    const norms = jobs.map(j => this.normCiStatus(j.status));
    if (norms.some(s => s === 'failed' || s === 'canceled' || s === 'cancelled')) return 'failed';
    if (norms.some(s => s === 'running')) return 'running';
    if (norms.some(s => s === 'pending' || s === 'created')) return 'pending';
    if (norms.length && norms.every(s => s === 'success')) return 'success';
    return 'pending';
  }

  onNavigateSection(section: 'monitoring' | 'alerts' | 'history' | 'deployments'): void {
    this.navigateSection.emit(section);
  }

  /** Lien aperçu uniquement si l'env tourne vraiment. */
  canVisit(row: HistoryTimelineRow): boolean {
    return row.kind === 'deploy'
      && (row.status || '').toUpperCase() === 'RUNNING'
      && !!row.previewUrl;
  }

  getStatusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS' || s === 'COMPLETE' || s === 'READY') return 'status-success';
    if (s === 'RUNNING') return 'status-running';
    if (s === 'FAILED' || s === 'CANCELED' || s === 'CANCELLED') return 'status-failed';
    if (s === 'PENDING' || s === 'DEPLOYING' || s === 'PARTIAL') return 'status-pending';
    if (s === 'STOPPED') return 'status-canceled';
    return 'status-unknown';
  }

  verdictLabel(verdict: string | null | undefined): string {
    return verdictLabelFr(verdict);
  }

  formatAgo(iso: string | null | undefined): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const diffMs = Math.max(0, Date.now() - date.getTime());
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 30) return 'À l\'instant';
    if (diffSec < 60) return `Il y a ${diffSec} s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `Il y a ${diffHour} h`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `Il y a ${diffDay} j`;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  formatAbsolute(iso: string | null | undefined): string {
    if (!iso) return 'Date inconnue';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Date inconnue';
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  trackRow(_: number, row: HistoryTimelineRow): string {
    return `${row.kind}-${row.id}`;
  }

  private periodCutoffMs(): number | null {
    const now = Date.now();
    switch (this.periodFilter) {
      case '24h':
        return now - 24 * 3600_000;
      case '7d':
        return now - 7 * 24 * 3600_000;
      case '30d':
        return now - 30 * 24 * 3600_000;
      default:
        return null;
    }
  }

  private buildRows(deployments: AppDeployment[], batches: ScanBatchState[]): HistoryTimelineRow[] {
    const rows: HistoryTimelineRow[] = [];

    for (const d of deployments) {
      const ns = d.namespace || d.id;
      const svcNames = this.deployServiceNames(d);
      const svcIds = this.idsForServiceNames(svcNames);
      const svcCount = svcNames.length || this.countDeployServices(d);
      const branch = d.gitBranch || null;
      const st = (d.status || '').toUpperCase();
      const preview = st === 'RUNNING' ? this.extractPreviewUrl(d) : null;
      rows.push({
        kind: 'deploy',
        id: d.id,
        at: d.createdAt || d.deployedAt || '',
        status: d.status || '—',
        title: this.deployTitle(st),
        description: branch
          ? `${ns} — branche ${branch}`
          : `${ns}${d.ttlHours != null ? ` · TTL ${d.ttlHours}h` : ''}`,
        gitlabPipelineId: d.gitlabPipelineId,
        gitBranch: branch,
        ttlHours: d.ttlHours ?? null,
        serviceCount: svcCount,
        serviceNames: svcNames,
        serviceIds: svcIds,
        environment: ns,
        previewUrl: preview
      });
    }

    for (const b of batches) {
      const id = b.batchId || b.id || '';
      const finished = b.finishedServiceCount ?? 0;
      const expected = b.expectedServiceCount ?? (b.services?.length || 0);
      const branches = Array.from(
        new Set((b.services || []).map(s => s.gitBranch).filter((x): x is string => !!x?.trim()))
      );
      const shas = Array.from(
        new Set((b.services || []).map(s => s.commitSha).filter((x): x is string => !!x?.trim()))
      );
      const shortSha = shas[0] ? shas[0].slice(0, 8) : null;
      const names = (b.services || []).map(s => s.serviceName).filter((x): x is string => !!x);
      const ids = (b.services || [])
        .map(s => s.serviceId)
        .filter((x): x is string => !!x);
      const branch = branches.length ? branches.join(', ') : null;
      const st = (b.status || '').toUpperCase();
      const verdictBit = st === 'COMPLETE' && b.verdict ? ` — ${verdictLabelFr(b.verdict)}` : '';

      rows.push({
        kind: 'scan',
        id,
        at: b.createdAt || b.finishedAt || '',
        status: b.status || '—',
        title: this.scanTitle(st),
        description: `Lot ${id ? id.slice(0, 8) : '—'} · ${finished}/${expected} services${branch ? ` · ${branch}` : ''}${verdictBit}`,
        gitlabPipelineId: b.gitlabPipelineId,
        verdict: b.verdict,
        gitBranch: branch,
        shortSha,
        finishedCount: finished,
        expectedCount: expected,
        securityScore: b.securityScore ?? null,
        grade: b.grade ?? null,
        bySeverity: this.extractSeverity(b),
        serviceNames: names,
        serviceIds: ids.length ? ids : this.idsForServiceNames(names),
        triggeredByUserId: b.triggeredByUserId ?? null,
        environment: names.length ? names.join(', ') : null
      });
    }

    return rows.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    });
  }

  private deployTitle(status: string): string {
    switch (status) {
      case 'RUNNING':
        return 'Environnement actif';
      case 'DEPLOYING':
      case 'PENDING':
        return 'Déploiement en cours';
      case 'FAILED':
        return 'Déploiement en échec';
      case 'STOPPED':
        return 'Environnement arrêté';
      default:
        return 'Déploiement';
    }
  }

  private scanTitle(status: string): string {
    switch (status) {
      case 'COMPLETE':
        return 'Scan terminé';
      case 'FAILED':
        return 'Scan en échec';
      case 'PENDING':
      case 'PARTIAL':
        return 'Scan en cours';
      default:
        return 'Lot de scan';
    }
  }

  private deployServiceNames(d: AppDeployment): string[] {
    const ss = d.servicesState;
    if (!ss || typeof ss !== 'object') return [];
    const services = (ss as { services?: Record<string, unknown> }).services;
    if (!services || typeof services !== 'object') return [];
    return Object.keys(services);
  }

  private idsForServiceNames(names: string[]): string[] {
    if (!names.length || !this.services?.length) return [];
    const byName = new Map(
      this.services
        .filter(s => s.id && s.name)
        .map(s => [(s.name || '').toLowerCase(), s.id!] as const)
    );
    return names
      .map(n => byName.get((n || '').toLowerCase()))
      .filter((id): id is string => !!id);
  }

  private countDeployServices(d: AppDeployment): number | null {
    const ss = d.servicesState;
    if (!ss || typeof ss !== 'object') return null;
    const services = (ss as { services?: Record<string, unknown> }).services;
    if (services && typeof services === 'object') {
      return Object.keys(services).length;
    }
    return null;
  }

  private extractPreviewUrl(d: AppDeployment): string | null {
    const ss = d.servicesState;
    if (!ss || typeof ss !== 'object') return null;
    const services = (ss as { services?: Record<string, { externalUrl?: string }> }).services;
    if (!services || typeof services !== 'object') return null;
    for (const svc of Object.values(services)) {
      const url = (svc?.externalUrl || '').trim();
      if (url) return url;
    }
    return null;
  }

  private extractSeverity(
    b: ScanBatchState
  ): { critical: number; high: number; medium: number; low: number; info: number } | null {
    const payload = b.verdictPayload;
    if (!payload || typeof payload !== 'object') return null;
    const agg = (payload as { aggregatedBySeverity?: Record<string, number> }).aggregatedBySeverity;
    if (!agg || typeof agg !== 'object') return null;
    const n = (k: string) => Number(agg[k] ?? agg[k.charAt(0).toUpperCase() + k.slice(1)] ?? 0) || 0;
    return {
      critical: n('critical'),
      high: n('high'),
      medium: n('medium'),
      low: n('low'),
      info: n('info')
    };
  }

  /** Checklist QG app à partir du lot (même logique que posture, version locale). */
  private buildScanQualityGates(batch: ScanBatchState | null): HistoryScanQgItem[] {
    if (!batch) return [];
    const sev = this.extractSeverity(batch) || { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const payload = batch.verdictPayload || {};
    const failedIds = new Set<string>();
    const unknownSources = new Set<string>();
    const failedServices: string[] = [];

    const payloadServices = (payload as { services?: unknown[] }).services;
    if (Array.isArray(payloadServices)) {
      for (const o of payloadServices) {
        if (!o || typeof o !== 'object') continue;
        const m = o as Record<string, unknown>;
        const svcName = m['serviceName'] != null ? String(m['serviceName']) : null;
        if (m['hardGateViolated'] === true) {
          if (svcName && !failedServices.includes(svcName)) failedServices.push(svcName);
          const ids = m['hardGateIds'];
          if (Array.isArray(ids)) ids.forEach(id => { if (id != null) failedIds.add(String(id)); });
        }
        const src = m['indeterminateSources'];
        if (Array.isArray(src)) src.forEach(s => { if (s != null) unknownSources.add(String(s)); });
      }
    }

    let anySonarAvailable = false;
    let secretsTotal = 0;
    let secretsKnown = false;
    for (const svc of batch.services || []) {
      const gate = svc.qualityGateJson || {};
      const qg = String(gate['sonarQualityGate'] ?? gate['sonar_quality_gate'] ?? '').toUpperCase();
      if (qg && qg !== 'NONE' && qg !== 'UNKNOWN') anySonarAvailable = true;
      if (gate['sonarAvailable'] === true || gate['sonar_available'] === true) anySonarAvailable = true;
      if ('secrets' in gate) {
        secretsKnown = true;
        secretsTotal += Number(gate['secrets'] ?? 0) || 0;
      }
    }

    const scope = failedServices.length ? failedServices.join(', ') : 'application';
    const items: HistoryScanQgItem[] = [];

    if (sev.critical > 0 || failedIds.has('dd_critical')) {
      items.push({
        id: 'dd_critical',
        label: 'Vulnérabilités critiques (DefectDojo)',
        status: 'FAIL',
        message: `${sev.critical} Critical open — hard gate (tolérance zéro).`,
        scope
      });
    } else {
      items.push({
        id: 'dd_critical',
        label: 'Vulnérabilités critiques (DefectDojo)',
        status: 'PASS',
        message: 'Aucun Critical open sur le rollup app.',
        scope: 'application'
      });
    }

    const secretsUnknown =
      !secretsKnown || [...unknownSources].some(s => s.toLowerCase().includes('secret'));
    if (secretsUnknown) {
      items.push({
        id: 'secrets',
        label: 'Secrets exposés (Gitleaks)',
        status: failedIds.has('secrets') ? 'FAIL' : 'UNKNOWN',
        message: failedIds.has('secrets')
          ? `${secretsTotal} secret(s) — hard gate`
          : 'Scan secrets non évalué / incomplet sur au moins un service',
        scope: 'application'
      });
    } else if (secretsTotal > 0 || failedIds.has('secrets')) {
      items.push({
        id: 'secrets',
        label: 'Secrets exposés (Gitleaks)',
        status: 'FAIL',
        message: `${secretsTotal} secret(s) exposé(s)`,
        scope: 'application'
      });
    } else {
      items.push({
        id: 'secrets',
        label: 'Secrets exposés (Gitleaks)',
        status: 'PASS',
        message: 'Aucun secret détecté',
        scope: 'application'
      });
    }

    const sonarUnknown =
      !anySonarAvailable || [...unknownSources].some(s => s.toLowerCase().includes('sonar'));
    if (failedIds.has('sonar_blocker') || failedIds.has('sonar_qg')) {
      items.push({
        id: 'sonar',
        label: 'Quality Gate SonarQube',
        status: 'FAIL',
        message: 'Blocker ou Quality Gate ERROR sur au moins un service',
        scope: 'application'
      });
    } else if (sonarUnknown) {
      items.push({
        id: 'sonar',
        label: 'Quality Gate SonarQube',
        status: 'UNKNOWN',
        message: 'Sonar indisponible ou incomplet — pas un FAIL seul.',
        scope: 'application'
      });
    } else {
      items.push({
        id: 'sonar',
        label: 'Quality Gate SonarQube',
        status: 'PASS',
        message: 'Quality Gate Sonar OK sur les services scannés',
        scope: 'application'
      });
    }

    if (sev.high > 0) {
      items.push({
        id: 'dd_high',
        label: 'Vulnérabilités High (DefectDojo)',
        status: 'WARN',
        message: `${sev.high} High open — à traiter, hors hard gate Critical.`,
        scope: 'application'
      });
    }

    return items;
  }

  private buildScanServiceQgs(batch: ScanBatchState | null): HistoryScanServiceQg[] {
    if (!batch?.services?.length) return [];
    const payloadServices = Array.isArray((batch.verdictPayload as { services?: unknown[] } | undefined)?.services)
      ? ((batch.verdictPayload as { services: Record<string, unknown>[] }).services)
      : [];

    return batch.services.map((svc: ScanBatchServiceState) => {
      const gate = svc.qualityGateJson || {};
      const dd = (gate['ddBySeverity'] as Record<string, number> | undefined) || {};
      const payloadMatch = payloadServices.find(p =>
        (p['serviceId'] != null && String(p['serviceId']) === String(svc.serviceId))
        || (p['serviceName'] != null && String(p['serviceName']) === String(svc.serviceName))
      );
      const hardIds = Array.isArray(payloadMatch?.['hardGateIds'])
        ? (payloadMatch!['hardGateIds'] as unknown[]).map(String)
        : [];
      return {
        serviceId: svc.serviceId,
        serviceName: svc.serviceName,
        status: svc.status,
        finished: svc.finished,
        sonarQg: (gate['sonarQualityGate'] ?? gate['sonar_quality_gate'] ?? null) as string | null,
        secrets: 'secrets' in gate ? (Number(gate['secrets']) || 0) : null,
        critical: Number(dd['critical'] ?? gate['critical'] ?? 0) || 0,
        high: Number(dd['high'] ?? gate['high'] ?? 0) || 0,
        hardGateViolated: payloadMatch?.['hardGateViolated'] === true || hardIds.length > 0,
        hardGateIds: hardIds
      };
    });
  }
}
