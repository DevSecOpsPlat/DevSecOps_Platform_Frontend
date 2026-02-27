import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApplicationService } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/application/deployment-history-item';
import { EnvironmentService } from '../../services/environment/environment.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';

@Component({
  selector: 'app-project-overview',
  templateUrl: './project-overview.component.html',
  styleUrls: ['./project-overview.component.css']
})
export class ProjectOverviewComponent implements OnInit {

  

  appId: string | null = null;
  latestDeployment: DeploymentHistoryItem | null = null;
  deployments: DeploymentHistoryItem[] = [];
  environmentSummary: EnvironmentSummaryResponse | null = null;
  loading = true;
  copied = false;
  remainingSeconds?: number;
  totalSeconds?: number;
  private countdownIntervalId?: any;

  readonly pipelineSteps: string[] = ['Clone', 'Build', 'Security Scan', 'Deploy'];

  constructor(
    private route: ActivatedRoute,
    private applicationService: ApplicationService,
    private environmentService: EnvironmentService,
    private pipelineService: PipelineService
  ) {}

  get previewUrl(): string | null {
    return this.environmentSummary?.previewUrl ?? null;
  }

  ngOnInit(): void {
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') || null;
    if (this.appId) {
      this.loadDeployments();
    }
  }

  loadDeployments(): void {
    if (!this.appId) return;
    this.loading = true;
    this.applicationService.getDeploymentHistory(this.appId).subscribe({
      next: items => {
        this.deployments = items;
        this.latestDeployment = items.length > 0 ? items[0] : null;
        this.loading = false;
        if (this.latestDeployment) {
          this.loadEnvironmentSummary(this.latestDeployment.environmentId);
        }
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  loadEnvironmentSummary(envId: string): void {
    this.environmentService.getEnvironment(envId).subscribe({
      next: env => {
        this.environmentSummary = env;
        const expires = new Date(env.expiresAt).getTime();
        const created = new Date(env.createdAt).getTime();
        const now = Date.now();
        this.totalSeconds = Math.max(1, Math.floor((expires - created) / 1000));
        this.remainingSeconds = Math.max(0, Math.floor((expires - now) / 1000));
        this.startCountdown();
      },
      error: () => {}
    });
  }

  private startCountdown(): void {
    if (this.countdownIntervalId) clearInterval(this.countdownIntervalId);
    this.countdownIntervalId = setInterval(() => {
      if (this.remainingSeconds == null || this.remainingSeconds <= 0) {
        this.remainingSeconds = 0;
        clearInterval(this.countdownIntervalId);
        return;
      }
      this.remainingSeconds--;
    }, 1000);
  }

  getTtlDashArray(): string {
    if (this.totalSeconds == null || this.totalSeconds === 0 || this.remainingSeconds == null) return '0 100';
    const pct = (this.remainingSeconds / this.totalSeconds) * 100;
    const dash = (pct / 100) * 100;
    return `${dash} 100`;
  }

  formatRemaining(): string {
    if (this.remainingSeconds == null) return '—';
    const sec = this.remainingSeconds;
    if (sec <= 0) return 'Expired';
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
  }

  copyPreviewUrl(): void {
    if (!this.previewUrl) return;
    navigator.clipboard.writeText(this.previewUrl).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    });
  }

  statusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status-success';
    if (s === 'FAILED' || s === 'CANCELED') return 'status-danger';
    if (s === 'RUNNING' || s === 'PENDING') return 'status-warning';
    return 'status-muted';
  }

  isRunning(status: string): boolean {
    const s = (status || '').toUpperCase();
    return s === 'RUNNING' || s === 'PENDING';
  }

  formatTimeAgo(iso: string | null): string {
    if (!iso) return '—';
    const date = new Date(iso);
    const now = new Date();
    const sec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (sec < 60) return 'à l\'instant';
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    return date.toLocaleDateString();
  }

  viewPipeline(envId: string): void {
    window.open(`/pipeline/${envId}`, '_self');
  }

  getStepState(index: number): 'done' | 'active' | 'pending' | 'failed' {
    const status = (this.latestDeployment?.pipelineStatus || '').toUpperCase();
    if (!status) {
      return 'pending';
    }

    const lastIndex = this.pipelineSteps.length - 1;
    let progressIndex = 0;

    switch (status) {
      case 'PENDING':
        progressIndex = 0;
        break;
      case 'RUNNING':
        progressIndex = Math.min(2, lastIndex);
        break;
      case 'SUCCESS':
        progressIndex = lastIndex;
        break;
      case 'FAILED':
      case 'CANCELED':
        progressIndex = lastIndex;
        break;
      default:
        progressIndex = 0;
    }

    if (index < progressIndex) {
      return 'done';
    }

    if (index === progressIndex) {
      if (status === 'FAILED' || status === 'CANCELED') {
        return 'failed';
      }
      return status === 'SUCCESS' ? 'done' : 'active';
    }

    return 'pending';
  }
}
