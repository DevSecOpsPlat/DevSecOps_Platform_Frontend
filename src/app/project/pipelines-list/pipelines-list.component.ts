import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { PipelineListItem } from '../../models/pipeline/pipeline-list-item';
import { ToastService } from '../../services/ui/toast.service';
import { ApplicationService } from '../../services/application/application.service';

type PipelineKindFilter = 'ALL' | 'SCAN' | 'DEPLOY';
type PipelineStatusFilter = 'ALL' | 'SUCCESS' | 'FAILED' | 'RUNNING';

@Component({
  selector: 'app-pipelines-list',
  templateUrl: './pipelines-list.component.html',
  styleUrls: ['./pipelines-list.component.css']
})
export class PipelinesListComponent implements OnInit {

  pipelines: PipelineListItem[] = [];
  loading = false;
  error: string | null = null;
  cancelingId: number | null = null;
  private previousStatuses = new Map<number, string>();
  kindFilter: PipelineKindFilter = 'ALL';
  statusFilter: PipelineStatusFilter = 'ALL';
  filtered: PipelineListItem[] = [];

  appId: string | null = null;
  isProjectContext = false;
  appName: string | null = null;

  deletingId: number | null = null;
  showDeleteConfirm: boolean = false;
  pipelineToDelete: PipelineListItem | null = null;

  constructor(
    private pipelineService: PipelineService,
    private applicationService: ApplicationService,
    private router: Router,
    private route: ActivatedRoute,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      const status = (params.get('status') || '').toUpperCase();
      if (status === 'SUCCESS') {
        this.statusFilter = 'SUCCESS';
      } else if (status.includes('FAILED') || status.includes('CANCELED')) {
        this.statusFilter = 'FAILED';
      } else if (status.includes('RUNNING') || status.includes('PENDING')) {
        this.statusFilter = 'RUNNING';
      }

      const kind = (params.get('kind') || '').toUpperCase();
      if (kind === 'SCAN' || kind === 'DEPLOY') {
        this.kindFilter = kind;
      }

      this.appId = this.route.snapshot.paramMap.get('appId');
      const urlSegments = this.router.url.split('/');
      const projectIndex = urlSegments.indexOf('project');
      if (projectIndex > -1 && urlSegments.length > projectIndex + 1) {
        this.appId = urlSegments[projectIndex + 1];
        this.isProjectContext = true;
        if (this.appId) {
          this.applicationService.getApplicationById(this.appId).subscribe({
            next: (app) => { this.appName = app.name; },
            error: () => { this.appName = null; }
          });
        }
      }

      this.loadPipelines();
    });

    setInterval(() => this.refreshPipelinesForNotifications(), 10000);
  }

  loadPipelines(): void {
    this.loading = true;
    this.error = null;

    const executionKind = this.kindFilter === 'ALL' ? null : this.kindFilter;
    const applicationId = this.isProjectContext ? this.appId : null;

    this.pipelineService.listPipelines(0, 100, applicationId, executionKind).subscribe({
      next: (list: PipelineListItem[]) => {
        this.pipelines = list ?? [];
        this.applyFilters();
        this.updatePreviousStatuses(this.pipelines);
        this.loading = false;
      },
      error: (err: any) => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement des pipelines';
      }
    });
  }

  onKindFilterChange(): void {
    this.syncQueryParams();
    this.loadPipelines();
  }

  onStatusFilterChange(): void {
    this.syncQueryParams();
    this.applyFilters();
  }

  private syncQueryParams(): void {
    const queryParams: Record<string, string | null> = {};
    if (this.statusFilter !== 'ALL') {
      if (this.statusFilter === 'FAILED') {
        queryParams['status'] = 'FAILED,CANCELED';
      } else if (this.statusFilter === 'RUNNING') {
        queryParams['status'] = 'PENDING,RUNNING';
      } else {
        queryParams['status'] = this.statusFilter;
      }
    } else {
      queryParams['status'] = null;
    }
    queryParams['kind'] = this.kindFilter === 'ALL' ? null : this.kindFilter;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge'
    });
  }

  private applyFilters(): void {
    let list = [...this.pipelines];
    const status = this.statusFilter;
    if (status === 'SUCCESS') {
      list = list.filter(item => this.itemStatus(item) === 'SUCCESS');
    } else if (status === 'FAILED') {
      list = list.filter(item => ['FAILED', 'CANCELED'].includes(this.itemStatus(item)));
    } else if (status === 'RUNNING') {
      list = list.filter(item => ['RUNNING', 'PENDING'].includes(this.itemStatus(item)));
    }
    this.filtered = list;
  }

  private itemStatus(item: PipelineListItem): string {
    return (item.status || item.pipelineStatus || '').toUpperCase();
  }

  private updatePreviousStatuses(pipelines: PipelineListItem[]): void {
    pipelines.forEach((item: PipelineListItem) => {
      if (item.pipelineId != null) {
        this.previousStatuses.set(item.pipelineId, this.itemStatus(item));
      }
    });
  }

  getPageTitle(): string {
    if (this.isProjectContext && this.appName) {
      return `Pipelines — ${this.appName}`;
    }
    return 'Tous les pipelines';
  }

  getSubtitle(): string {
    if (this.isProjectContext && this.appName) {
      return `Historique des pipelines scan et déploiement pour ${this.appName}`;
    }
    return 'Tous les pipelines lancés par votre compte';
  }

  statusClass(status: string | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status status-success';
    if (s === 'FAILED' || s === 'CANCELED') return 'status status-danger';
    if (s === 'RUNNING' || s === 'PENDING') return 'status status-warning';
    return 'status status-muted';
  }

  executionKindLabel(item: PipelineListItem): string {
    return (item.executionKind || '').toUpperCase() === 'DEPLOY' ? 'DEPLOY' : 'SCAN';
  }

  displayName(item: PipelineListItem): string {
    if (item.serviceName) {
      return item.serviceName;
    }
    return item.environmentName || (this.executionKindLabel(item) === 'SCAN' ? 'Scan' : 'Déploiement');
  }

  isRunning(item: PipelineListItem): boolean {
    const s = this.itemStatus(item);
    return s === 'RUNNING' || s === 'PENDING';
  }

  canCancel(item: PipelineListItem): boolean {
    return this.isRunning(item) && item.pipelineId != null;
  }

  cancel(item: PipelineListItem): void {
    if (!item.pipelineId || this.cancelingId != null) return;
    this.cancelingId = item.pipelineId;
    this.pipelineService.cancelPipeline(item.pipelineId).subscribe({
      next: () => {
        this.cancelingId = null;
        this.loadPipelines();
      },
      error: () => {
        this.cancelingId = null;
        this.error = 'Impossible d\'annuler le pipeline';
      }
    });
  }

  viewDetails(item: PipelineListItem): void {
    if (item.environmentId) {
      this.router.navigate(['/pipeline', item.environmentId]);
      return;
    }
    if (item.pipelineId) {
      const queryParams = this.appId || item.applicationId
        ? { appId: this.appId || item.applicationId || undefined }
        : undefined;
      this.router.navigate(['/pipeline/id', item.pipelineId], { queryParams });
    }
  }

  formatTimeAgo(iso: string | null | undefined): string {
    if (!iso) return '—';
    const date = new Date(iso);
    const now = new Date();
    const sec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (sec < 60) return 'à l\'instant';
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    return date.toLocaleDateString();
  }

  formatDuration(seconds: number | undefined): string {
    if (seconds == null) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    parts.push(m > 0 ? `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `00:${s.toString().padStart(2, '0')}`);
    return parts.join(' ');
  }

  private refreshPipelinesForNotifications(): void {
    const executionKind = this.kindFilter === 'ALL' ? null : this.kindFilter;
    const applicationId = this.isProjectContext ? this.appId : null;
    this.pipelineService.listPipelines(0, 100, applicationId, executionKind).subscribe({
      next: (list: PipelineListItem[]) => {
        this.processNotifications(list ?? []);
      },
      error: () => {}
    });
  }

  private processNotifications(list: PipelineListItem[]): void {
    list.forEach((item: PipelineListItem) => {
      if (!item.pipelineId) {
        return;
      }
      const id = item.pipelineId;
      const newStatus = this.itemStatus(item);
      const oldStatus = this.previousStatuses.get(id);

      if (oldStatus && (oldStatus === 'RUNNING' || oldStatus === 'PENDING')
          && (newStatus === 'SUCCESS' || newStatus === 'FAILED' || newStatus === 'CANCELED')) {
        const type = newStatus === 'SUCCESS' ? 'success' : 'error';
        const title = newStatus === 'SUCCESS' ? 'Pipeline réussi' : 'Pipeline terminé';
        const msg = `Pipeline #${id} (${this.displayName(item)}) est maintenant ${newStatus}.`;
        this.toastService.push(type, title, msg);
      }

      this.previousStatuses.set(id, newStatus);
    });

    this.pipelines = list;
    this.applyFilters();
  }

  confirmDelete(item: PipelineListItem): void {
    this.pipelineToDelete = item;
    this.showDeleteConfirm = true;
  }

  deletePipeline(): void {
    if (!this.pipelineToDelete?.pipelineId || this.deletingId != null) return;

    this.deletingId = this.pipelineToDelete.pipelineId;
    this.showDeleteConfirm = false;

    this.pipelineService.deletePipeline(this.pipelineToDelete.pipelineId).subscribe({
      next: () => {
        this.deletingId = null;
        this.pipelineService.getLatestPipeline().subscribe(latest => {
          if (latest) {
            localStorage.setItem('last-pipeline-id', latest.id);
            localStorage.setItem('last-pipeline-env-id', latest.environmentId);
          }
        });
        this.toastService.push('success', 'Pipeline supprimé',
          `Pipeline #${this.pipelineToDelete?.pipelineId} supprimé`);
        this.pipelineToDelete = null;
        this.loadPipelines();
      },
      error: () => {
        this.deletingId = null;
        this.pipelineToDelete = null;
        this.toastService.push('error', 'Erreur', 'Impossible de supprimer le pipeline');
      }
    });
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.pipelineToDelete = null;
  }
}
