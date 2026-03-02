// project-overview.component.ts (version nettoyée)
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApplicationService } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/application/deployment-history-item';
import { EnvironmentService } from '../../services/environment/environment.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';
import { 
  ActivityItem, 
  DashboardPipelineItem, 
  DashboardEnvironmentItem,
  DashboardVulnerabilityItem 
} from 'src/app/models/dashboard.models';
import { forkJoin } from 'rxjs';
import { SecurityService } from 'src/app/security/security.service';

@Component({
  selector: 'app-project-overview',
  templateUrl: './project-overview.component.html',
  styleUrls: ['./project-overview.component.css']
})
export class ProjectOverviewComponent implements OnInit, OnDestroy {
  appId: string | null = null;
  appName: string = '';
  
  latestDeployment: DeploymentHistoryItem | null = null;
  deployments: DeploymentHistoryItem[] = [];
  environmentSummary: EnvironmentSummaryResponse | null = null;
  pendingDeployments: number = 0;
  pendingDeploymentsList: any[] = [];
  recentActivities: ActivityItem[] = [];
  recentPipelines: DashboardPipelineItem[] = [];
  activeEnvironments: DashboardEnvironmentItem[] = [];
  recentVulnerabilities: DashboardVulnerabilityItem[] = [];

  loadingPipelineDetails: boolean = false;
  
  totalDeployments: number = 0;
  successfulDeployments: number = 0;
  failedDeployments: number = 0;
  criticalVulnerabilities: number = 0;
  
  loading = true;
  error: string | null = null;
  copied = false;
  
  remainingSeconds?: number;
  totalSeconds?: number;
  private countdownIntervalId?: any;

  readonly pipelineSteps: string[] = ['Clone', 'Build', 'Security Scan', 'Deploy'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private applicationService: ApplicationService,
    private environmentService: EnvironmentService,
    private pipelineService: PipelineService,
    private securityService: SecurityService
  ) {}

  get previewUrl(): string | null {
    return this.environmentSummary?.previewUrl ?? null;
  }

  ngOnInit(): void {
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') || null;
    if (this.appId) {
      this.loadAppData();
    } else {
      this.error = 'ID d\'application invalide';
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    if (this.countdownIntervalId) {
      clearInterval(this.countdownIntervalId);
    }
  }

  getPipelineStagesWithStatus(): { name: string; status: 'done' | 'active' | 'pending' | 'failed' }[] {
  if (!this.latestDeployment) {
    return [];
  }

  const jobs = this.latestDeployment.jobs || [];

  if (jobs.length === 0) {
    return [];
  }
  
  const seenStages = new Set<string>();
  const stagesInOrder: { name: string; jobs: any[] }[] = [];
  
  jobs.forEach((job: any) => {
    const stage = job.stage || 'unknown';
    if (!seenStages.has(stage)) {
      seenStages.add(stage);
      stagesInOrder.push({ name: stage, jobs: [] });
    }
    
    const stageEntry = stagesInOrder.find(s => s.name === stage);
    if (stageEntry) {
      stageEntry.jobs.push(job);
    }
  });
  
  const stages = stagesInOrder.map(stageEntry => {
    const jobStatuses = stageEntry.jobs.map((j: any) => j.status?.toLowerCase() || '');
    
    let status: 'done' | 'active' | 'pending' | 'failed' = 'pending';
    
    if (jobStatuses.some(s => s === 'failed' || s === 'canceled')) {
      status = 'failed';
    } else if (jobStatuses.every(s => s === 'success')) {
      status = 'done';
    } else if (jobStatuses.some(s => s === 'running' || s === 'pending')) {
      status = 'active';
    }
    
    return {
      name: this.formatStageName(stageEntry.name),
      status: status
    };
  });
  
  // 🔥 INVERSER L'ORDRE
  return stages.reverse();
}

  loadLatestPipelineDetails(): void {
    if (!this.latestDeployment?.environmentId) {
      return;
    }
    
    this.pipelineService.getPipelineAndScan(this.latestDeployment.environmentId).subscribe({
      next: (pipelineDetails) => {
        if (this.latestDeployment) {
          this.latestDeployment.jobs = pipelineDetails.jobs;
          this.latestDeployment = { ...this.latestDeployment };
        }
      },
      error: (err) => {
        console.error('Erreur chargement pipeline details:', err);
      }
    });
  }

  private formatStageName(stage: string): string {
    if (!stage) return 'Unknown';
    let formatted = stage.replace(/[-_]/g, ' ');
    formatted = formatted.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    return formatted;
  }

  private getDisplayName(stage: string): string {
    switch(stage.toLowerCase()) {
      case 'clone': return 'Clone';
      case 'build': return 'Build';
      case 'scan': return 'Security Scan';
      case 'deploy': return 'Deploy';
      default: return stage.charAt(0).toUpperCase() + stage.slice(1);
    }
  }
  
  private getStepStatusFallback(index: number, pipelineStatus: string): 'done' | 'active' | 'pending' | 'failed' {
    const lastIndex = this.pipelineSteps.length - 1;
    
    switch(pipelineStatus) {
      case 'PENDING':
        return index === 0 ? 'active' : 'pending';
      case 'RUNNING':
        if (index < 2) return 'done';
        if (index === 2) return 'active';
        return 'pending';
      case 'SUCCESS':
        return 'done';
      case 'FAILED':
      case 'CANCELED':
        return index === lastIndex ? 'failed' : 'done';
      default:
        return 'pending';
    }
  }

  loadAppData(): void {
    if (!this.appId) return;
    
    this.loading = true;
    this.error = null;
    
    this.applicationService.getApplicationById(this.appId).subscribe({
      next: (app) => {
        this.appName = app.name;
      },
      error: (err) => {
        console.error('Erreur chargement application:', err);
      }
    });
    
    forkJoin({
      deployments: this.applicationService.getDeploymentHistory(this.appId),
      pipelines: this.pipelineService.listPipelines(),
      environments: this.environmentService.getMyEnvironments(),
      vulnerabilities: this.securityService.getRecentVulnerabilities(5)
    }).subscribe({
      next: (data) => {
        this.processDashboardData(data);
        this.loading = false;
      },
      error: (err) => {
        console.error('Erreur chargement dashboard:', err);
        this.error = 'Erreur lors du chargement des données';
        this.loading = false;
      }
    });
  }

  private processDashboardData(data: any): void {
    const appDeployments = data.deployments || [];
    const appPipelines = (data.pipelines || []).filter((p: any) => 
      p.environmentId && appDeployments.some((d: any) => d.environmentId === p.environmentId)
    );
    const appEnvironments = (data.environments || []).filter((e: any) => 
      e.id && appDeployments.some((d: any) => d.environmentId === e.id)
    );
    
    this.pendingDeployments = appDeployments.filter((d: DeploymentHistoryItem) => 
      ['PENDING', 'RUNNING'].includes(d.pipelineStatus?.toUpperCase() || '')
    ).length;

    this.latestDeployment = appDeployments.length > 0 ? appDeployments[0] : null;

    if (this.latestDeployment) {
      this.loadLatestPipelineDetails();
    }

    this.pendingDeploymentsList = appDeployments
      .filter((d: DeploymentHistoryItem) => ['PENDING', 'RUNNING'].includes(d.pipelineStatus?.toUpperCase() || ''))
      .slice(0, 3)
      .map((d: DeploymentHistoryItem) => ({
        ...d,
        progress: d.pipelineStatus?.toUpperCase() === 'PENDING' ? 30 : 60
      }));

    this.deployments = appDeployments;
    this.latestDeployment = appDeployments.length > 0 ? appDeployments[0] : null;
    
    this.totalDeployments = appDeployments.length;
    this.successfulDeployments = appDeployments.filter((d: any) => 
      d.pipelineStatus?.toUpperCase() === 'SUCCESS'
    ).length;
    this.failedDeployments = appDeployments.filter((d: any) => 
      ['FAILED', 'CANCELED'].includes(d.pipelineStatus?.toUpperCase() || '')
    ).length;
    
    if (this.latestDeployment) {
      this.loadEnvironmentSummary(this.latestDeployment.environmentId);
    }
    
    this.buildRecentActivities(appDeployments, appPipelines, appEnvironments);
    this.buildRecentPipelines(appPipelines);
    this.buildActiveEnvironments(appEnvironments);
    
    this.recentVulnerabilities = data.vulnerabilities || [];
    this.criticalVulnerabilities = this.recentVulnerabilities.filter(v => 
      v.severity === 'CRITICAL' || v.severity === 'HIGH'
    ).length;
  }

  private buildRecentActivities(
    deployments: any[], 
    pipelines: any[], 
    environments: any[]
  ): void {
    const activities: ActivityItem[] = [];
    
    deployments.slice(0, 3).forEach(d => {
      activities.push({
        id: d.environmentId,
        type: 'deployment',
        title: 'Nouveau déploiement',
        description: `Environnement ${d.environmentName} créé`,
        timestamp: d.createdAt,
        status: d.pipelineStatus,
        icon: this.getStatusIcon(d.pipelineStatus),
        link: `/pipeline/${d.environmentId}?appId=${this.appId}`
      });
    });
    
    pipelines.slice(0, 3).forEach(p => {
      activities.push({
        id: String(p.pipelineId || ''),
        type: 'pipeline',
        title: 'Pipeline exécuté',
        description: `Pipeline #${p.pipelineId} pour ${p.environmentName}`,
        timestamp: p.createdAt,
        status: p.status || p.pipelineStatus,
        icon: '⚙️',
        link: `/pipeline/${p.environmentId}?appId=${this.appId}`
      });
    });
    
    this.recentActivities = activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  }

  private buildRecentPipelines(pipelines: any[]): void {
    this.recentPipelines = pipelines
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map(p => ({
        id: p.pipelineId,
        name: `Pipeline #${p.pipelineId}`,
        branch: p.gitBranch || p.ref || 'main',
        status: p.status || p.pipelineStatus,
        createdAt: p.createdAt,
        environmentId: p.environmentId,
        environmentName: p.environmentName,
        triggeredBy: p.createdByUsername
      }));
  }

  private buildActiveEnvironments(environments: any[]): void {
    this.activeEnvironments = environments
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
  }

  loadEnvironmentSummary(envId: string): void {
    this.environmentService.getEnvironment(envId).subscribe({
      next: env => {
        this.environmentSummary = env;
        if (env.expiresAt) {
          const expires = new Date(env.expiresAt).getTime();
          const created = new Date(env.createdAt).getTime();
          const now = Date.now();
          this.totalSeconds = Math.max(1, Math.floor((expires - created) / 1000));
          this.remainingSeconds = Math.max(0, Math.floor((expires - now) / 1000));
          this.startCountdown();
        }
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
    if (sec <= 0) return 'Expiré';
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

  getStatusIcon(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return '✅';
    if (s === 'FAILED') return '❌';
    if (s === 'CANCELED') return '⛔';
    if (s === 'RUNNING') return '🔄';
    if (s === 'PENDING') return '⏳';
    return '•';
  }

  isRunning(status: string): boolean {
    const s = (status || '').toUpperCase();
    return s === 'RUNNING' || s === 'PENDING';
  }

  formatTimeAgo(iso: string | null): string {
    if (!iso) return '—';
    try {
      const date = new Date(iso);
      const now = new Date();
      const sec = Math.floor((now.getTime() - date.getTime()) / 1000);
      if (sec < 60) return 'à l\'instant';
      if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
      if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
      return date.toLocaleDateString();
    } catch (e) {
      return '—';
    }
  }

  calculateTimeRemaining(expiresAt: string): string {
    if (!expiresAt) return '—';
    try {
      const now = new Date();
      const expiry = new Date(expiresAt);
      if (expiry <= now) return 'Expiré';
      
      const diffMs = expiry.getTime() - now.getTime();
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      
      if (diffHrs > 0) {
        return `${diffHrs}h ${diffMins}m`;
      }
      return `${diffMins} min`;
    } catch (e) {
      return '—';
    }
  }

  getSeverityClass(severity: string): string {
    const s = (severity || '').toUpperCase();
    if (s === 'CRITICAL') return 'severity-critical';
    if (s === 'HIGH') return 'severity-high';
    if (s === 'MEDIUM') return 'severity-medium';
    if (s === 'LOW') return 'severity-low';
    return 'severity-info';
  }

  viewPipeline(envId: string): void {
    this.router.navigate(['/pipeline', envId], {
      queryParams: { appId: this.appId }
    });
  }

  viewEnvironment(envId: string): void {
    this.router.navigate(['/environment', envId], {
      queryParams: { appId: this.appId }
    });
  }

  viewAllPipelines(): void {
    this.router.navigate(['/project', this.appId, 'pipelines']);
  }

  viewAllEnvironments(): void {
    this.router.navigate(['/project', this.appId, 'deployments']);
  }

  viewAllVulnerabilities(): void {
    this.router.navigate(['/security/vulnerabilities'], {
      queryParams: { appId: this.appId }
    });
  }

  createNewEnvironment(): void {
    this.router.navigate(['/environment-create'], {
      queryParams: { appId: this.appId }
    });
  }

  getStepState(index: number): 'done' | 'active' | 'pending' | 'failed' {
    const status = (this.latestDeployment?.pipelineStatus || '').toUpperCase();
    if (!status) return 'pending';

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
        if (index === lastIndex) return 'failed';
        return 'done';
      default:
        progressIndex = 0;
    }

    if (index < progressIndex) return 'done';
    if (index === progressIndex) return status === 'SUCCESS' ? 'done' : 'active';
    return 'pending';
  }
}