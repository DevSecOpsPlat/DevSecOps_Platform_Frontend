import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { PipelineService } from '../services/pipeline/pipeline.service';
import { PipelineListItem } from '../models/pipeline/pipeline-list-item';
import { ToastService } from '../services/ui/toast.service';

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

  constructor(
    private pipelineService: PipelineService,
    private router: Router,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.loadPipelines();
    setInterval(() => this.refreshPipelinesForNotifications(), 10000);
  }

  loadPipelines(): void {
    this.loading = true;
    this.error = null;
    this.pipelineService.listPipelines().subscribe({
      next: (list) => {
        this.pipelines = list;
        this.pipelines.forEach(item => {
          if (item.pipelineId != null) {
            this.previousStatuses.set(item.pipelineId, (item.status || item.pipelineStatus || '').toUpperCase());
          }
        });
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement des pipelines';
      }
    });
  }

  private refreshPipelinesForNotifications(): void {
    this.pipelineService.listPipelines().subscribe({
      next: (list) => {
        list.forEach(item => {
          if (!item.pipelineId) {
            return;
          }
          const id = item.pipelineId;
          const newStatus = (item.status || item.pipelineStatus || '').toUpperCase();
          const oldStatus = this.previousStatuses.get(id);
          if (oldStatus && (oldStatus === 'RUNNING' || oldStatus === 'PENDING')
              && (newStatus === 'SUCCESS' || newStatus === 'FAILED' || newStatus === 'CANCELED')) {
            const type = newStatus === 'SUCCESS' ? 'success' : 'error';
            const title = newStatus === 'SUCCESS' ? 'Deployment succeeded' : 'Deployment finished';
            const msg = `Pipeline #${id} for env ${item.environmentName} is now ${newStatus}.`;
            this.toastService.push(type, title, msg);
          }
          this.previousStatuses.set(id, newStatus);
        });
        this.pipelines = list;
      },
      error: () => {
        // silencieux
      }
    });
  }

  statusClass(status: string | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status status-success';
    if (s === 'FAILED' || s === 'CANCELED') return 'status status-danger';
    if (s === 'RUNNING' || s === 'PENDING') return 'status status-warning';
    return 'status status-muted';
  }

  jobStatusClass(status: string | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'job-status job-success';
    if (s === 'FAILED' || s === 'CANCELED') return 'job-status job-danger';
    if (s === 'RUNNING' || s === 'PENDING') return 'job-status job-warning';
    return 'job-status job-muted';
  }

  isRunning(item: PipelineListItem): boolean {
    const s = (item.status || item.pipelineStatus || '').toUpperCase();
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
}
