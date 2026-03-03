// project-overview.component.ts
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
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SecurityService } from 'src/app/security/security.service';

@Component({
  selector: 'app-project-overview',
  templateUrl: './project-overview.component.html',
  styleUrls: ['./project-overview.component.css']
})
export class ProjectOverviewComponent implements OnInit, OnDestroy {
  appId: string | null = null;
  appName: string = '';
  
  // Données principales
  latestDeployment: DeploymentHistoryItem | null = null;
  deployments: DeploymentHistoryItem[] = [];
  environmentSummary: EnvironmentSummaryResponse | null = null;
  pendingDeployments: number = 0;
  pendingDeploymentsList: any[] = [];
  
  // Données du dashboard
  recentActivities: ActivityItem[] = [];
  recentPipelines: DashboardPipelineItem[] = [];
  activeEnvironments: DashboardEnvironmentItem[] = [];
  recentVulnerabilities: DashboardVulnerabilityItem[] = [];

  loadingPipelineDetails: boolean = false;
  
  // Statistiques
  totalDeployments: number = 0;
  successfulDeployments: number = 0;
  failedDeployments: number = 0;
  criticalVulnerabilities: number = 0;
  
  // États
  loading = true;
  loadingSlow = false;
  error: string | null = null;
  copied = false;
  
  // Timer
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

  /**
   * Charge les données de l'application de manière progressive
   */
  loadAppData(): void {
    if (!this.appId) return;
    
    this.loading = true;
    this.error = null;
    
    // 1. D'abord charger les données rapides
    forkJoin({
      appInfo: this.applicationService.getApplicationById(this.appId).pipe(
        catchError(err => {
          console.error('Erreur chargement application:', err);
          return of(null);
        })
      ),
      environments: this.environmentService.getMyEnvironments().pipe(
        catchError(err => {
          console.error('Erreur chargement environnements:', err);
          return of([]);
        })
      ),
      vulnerabilities: this.securityService.getRecentVulnerabilities(5).pipe(
        catchError(err => {
          console.error('Erreur chargement vulnérabilités:', err);
          return of([]);
        })
      )
    }).subscribe({
      next: (quickData) => {
        if (quickData.appInfo) {
          this.appName = quickData.appInfo.name;
        }
        
        this.activeEnvironments = (quickData.environments || [])
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
        
        this.recentVulnerabilities = quickData.vulnerabilities || [];
        this.criticalVulnerabilities = this.recentVulnerabilities.filter(v => 
          v.severity === 'CRITICAL' || v.severity === 'HIGH'
        ).length;
        
        // 2. Ensuite charger les données plus lentes
        this.loadDeploymentsAndPipelines();
      },
      error: (err) => {
        console.error('Erreur chargement données rapides:', err);
        this.loadDeploymentsAndPipelines(); // Continuer quand même
      }
    });
  }
  // Dans project-overview.component.ts
private loadLatestDeployment(): void {
  if (!this.appId) return;
  
  this.applicationService.getDeploymentHistory(this.appId, 0, 1).subscribe({
    next: (deployments) => {
      const newLatest = deployments.length > 0 ? deployments[0] : null;
      
      // Vérifier si le dernier déploiement a changé
      if (this.latestDeployment?.environmentId !== newLatest?.environmentId) {
        console.log('🔄 Dernier déploiement mis à jour:', newLatest);
        this.latestDeployment = newLatest;
        
        if (this.latestDeployment) {
          this.loadEnvironmentSummary(this.latestDeployment.environmentId);
          this.loadLatestPipelineDetails();
        }
      }
    },
    error: (err) => {
      console.error('Erreur chargement dernier déploiement:', err);
    }
  });
}

// Appeler cette méthode après une suppression
onPipelineDeleted(): void {
  this.loadLatestDeployment(); // Recharger le dernier déploiement
}

refreshData(): void {
  console.log('🔄 Rafraîchissement des données overview');
  this.loadAppData();
}

  /**
   * Charge les déploiements et pipelines (données plus lentes)
   */
  loadDeploymentsAndPipelines(): void {
    if (!this.appId) return;
    
    this.loadingSlow = true;
    
    forkJoin({
      deployments: this.applicationService.getDeploymentHistory(this.appId, 1, 10).pipe(
        catchError(err => {
          console.error('Erreur chargement déploiements:', err);
          return of([]);
        })
      ),
      pipelines: this.pipelineService.listPipelines(1, 10).pipe(
        catchError(err => {
          console.error('Erreur chargement pipelines:', err);
          return of([]);
        })
      )
    }).subscribe({
      next: (slowData) => {
        this.deployments = slowData.deployments || [];
        this.latestDeployment = this.deployments.length > 0 ? this.deployments[0] : null;
        
        // Traiter les pipelines récents
        this.recentPipelines = (slowData.pipelines || [])
          .filter((p: any) => p.environmentId && this.deployments.some((d: any) => d.environmentId === p.environmentId))
          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5)
          .map((p: any) => ({
            id: p.pipelineId,
            name: `Pipeline #${p.pipelineId}`,
            branch: p.gitBranch || p.ref || 'main',
            status: p.status || p.pipelineStatus,
            createdAt: p.createdAt,
            environmentId: p.environmentId,
            environmentName: p.environmentName,
            triggeredBy: p.createdByUsername
          }));
        
        // Statistiques
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
        
        // Construire les activités récentes
        this.buildRecentActivities();
        
        // Charger les détails du dernier pipeline
        if (this.latestDeployment) {
          this.loadEnvironmentSummary(this.latestDeployment.environmentId);
          this.loadLatestPipelineDetails();
        }
        
        this.loading = false;
        this.loadingSlow = false;
      },
      error: (err) => {
        console.error('Erreur chargement données lentes:', err);
        this.loading = false;
        this.loadingSlow = false;
        this.error = 'Erreur lors du chargement des données';
      }
    });
  }

  /**
   * Construit la liste des activités récentes
   */
  private buildRecentActivities(): void {
    const activities: ActivityItem[] = [];
    
    // Ajouter les déploiements récents
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
    
    // Ajouter les pipelines récents
    this.recentPipelines.slice(0, 3).forEach(p => {
      activities.push({
        id: String(p.id || ''),
        type: 'pipeline',
        title: 'Pipeline exécuté',
        description: `Pipeline #${p.id} pour ${p.environmentName}`,
        timestamp: p.createdAt,
        status: p.status,
        icon: '⚙️',
        link: `/pipeline/${p.environmentId}?appId=${this.appId}`
      });
    });
    
    // Trier par date (plus récent d'abord)
    this.recentActivities = activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  }

  /**
   * Récupère les stages du pipeline avec leurs statuts
   */
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
    
    return stages.reverse();
  }

  /**
   * Charge les détails du dernier pipeline
   */
  loadLatestPipelineDetails(): void {
    if (!this.latestDeployment?.environmentId) {
      return;
    }
    
    this.loadingPipelineDetails = true;
    
    this.pipelineService.getPipelineAndScan(this.latestDeployment.environmentId).subscribe({
      next: (pipelineDetails) => {
        if (this.latestDeployment) {
          this.latestDeployment.jobs = pipelineDetails.jobs;
          this.latestDeployment = { ...this.latestDeployment };
        }
        this.loadingPipelineDetails = false;
      },
      error: (err) => {
        console.error('Erreur chargement pipeline details:', err);
        this.loadingPipelineDetails = false;
      }
    });
  }

  /**
   * Formate le nom d'un stage
   */
  private formatStageName(stage: string): string {
    if (!stage) return 'Unknown';
    let formatted = stage.replace(/[-_]/g, ' ');
    formatted = formatted.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    return formatted;
  }

  /**
   * Charge le résumé d'un environnement
   */
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

  /**
   * Démarre le compte à rebours
   */
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

  /**
   * Calcule le temps restant
   */
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

  /**
   * Formate le temps restant pour l'affichage
   */
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

  /**
   * Obtient le tableau pour le cercle TTL
   */
  getTtlDashArray(): string {
    if (this.totalSeconds == null || this.totalSeconds === 0 || this.remainingSeconds == null) return '0 100';
    const pct = (this.remainingSeconds / this.totalSeconds) * 100;
    const dash = (pct / 100) * 100;
    return `${dash} 100`;
  }

  /**
   * Copie l'URL de prévisualisation
   */
  copyPreviewUrl(): void {
    if (!this.previewUrl) return;
    navigator.clipboard.writeText(this.previewUrl).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    });
  }

  /**
   * Retourne la classe CSS pour un statut
   */
  statusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status-success';
    if (s === 'FAILED' || s === 'CANCELED') return 'status-danger';
    if (s === 'RUNNING' || s === 'PENDING') return 'status-warning';
    return 'status-muted';
  }

  /**
   * Retourne l'icône pour un statut
   */
  getStatusIcon(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return '✅';
    if (s === 'FAILED') return '❌';
    if (s === 'CANCELED') return '⛔';
    if (s === 'RUNNING') return '🔄';
    if (s === 'PENDING') return '⏳';
    return '•';
  }

  /**
   * Vérifie si un pipeline est en cours
   */
  isRunning(status: string): boolean {
    const s = (status || '').toUpperCase();
    return s === 'RUNNING' || s === 'PENDING';
  }

  /**
   * Formate une date en "il y a X temps"
   */
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

  /**
   * Retourne la classe CSS pour la sévérité d'une vulnérabilité
   */
  getSeverityClass(severity: string): string {
    const s = (severity || '').toUpperCase();
    if (s === 'CRITICAL') return 'severity-critical';
    if (s === 'HIGH') return 'severity-high';
    if (s === 'MEDIUM') return 'severity-medium';
    if (s === 'LOW') return 'severity-low';
    return 'severity-info';
  }

  // ===== MÉTHODES DE NAVIGATION =====

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

  /**
   * Retourne l'état d'une étape du pipeline (pour fallback)
   */
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