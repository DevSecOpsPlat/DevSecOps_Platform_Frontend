// project-overview.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApplicationService } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/application/deployment-history-item';
import { EnvironmentService } from '../../services/environment/environment.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';
import { ApplicationResponse } from 'src/app/models/application/application-response';
import { 
  ActivityItem, 
  DashboardPipelineItem, 
  DashboardEnvironmentItem,
  DashboardVulnerabilityItem 
} from 'src/app/models/dashboard.models';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SecurityService } from 'src/app/security/security.service';
import { FormatService } from 'src/app/models/environment/format.service';

export interface ChartSegment {
  label: string;
  value: number;
  color: string;
  percent?: number;
}

@Component({
  selector: 'app-project-overview',
  templateUrl: './project-overview.component.html',
  styleUrls: ['./project-overview.component.css']
})
export class ProjectOverviewComponent implements OnInit, OnDestroy {
  appId: string | null = null;
  appName: string = '';
  appDetails: ApplicationResponse | null = null;
  
  // Données principales
  latestDeployment: DeploymentHistoryItem | null = null;
  deployments: DeploymentHistoryItem[] = [];
  environmentSummary: EnvironmentSummaryResponse | null = null;
  pendingDeployments: number = 0;
  pendingDeploymentsList: any[] = [];
  
  // Chart data
  deploymentChartData: ChartSegment[] = [];
  vulnerabilityChartData: ChartSegment[] = [];
  
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
    private securityService: SecurityService,
    private format: FormatService
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
          this.appDetails = quickData.appInfo;
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
      deployments: this.applicationService.getDeploymentHistory(this.appId, 0, 10).pipe(
        catchError(err => {
          console.error('Erreur chargement déploiements:', err);
          return of([]);
        })
      ),
      pipelines: this.pipelineService.listPipelines(0, 10).pipe(
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
        
        // Chart data: deployment status
        this.deploymentChartData = this.buildDeploymentChartData();
        this.vulnerabilityChartData = this.buildVulnerabilityChartData();
        
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
   * Données pour le graphique des déploiements (success / failed / pending)
   */
  private buildDeploymentChartData(): ChartSegment[] {
    const total = this.totalDeployments || 1;
    return [
      { label: 'Réussis', value: this.successfulDeployments, color: '#22c55e', percent: (this.successfulDeployments / total) * 100 },
      { label: 'Échoués', value: this.failedDeployments, color: '#ef4444', percent: (this.failedDeployments / total) * 100 },
      { label: 'En cours', value: this.pendingDeployments, color: '#f97316', percent: (this.pendingDeployments / total) * 100 }
    ].filter(s => s.value > 0);
  }

  /**
   * Données pour le graphique des vulnérabilités par sévérité
   */
  private buildVulnerabilityChartData(): ChartSegment[] {
    const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    this.recentVulnerabilities.forEach(v => {
      const s = (v.severity || 'INFO').toUpperCase();
      if (counts.hasOwnProperty(s)) (counts as any)[s]++;
    });
    const total = this.recentVulnerabilities.length || 1;
    const colors: Record<string, string> = {
      CRITICAL: '#dc2626',
      HIGH: '#ea580c',
      MEDIUM: '#facc15',
      LOW: '#84cc16',
      INFO: '#64748b'
    };
    return (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const)
      .filter(level => (counts[level] || 0) > 0)
      .map(level => ({
        label: level.charAt(0) + level.slice(1).toLowerCase(),
        value: counts[level],
        color: colors[level],
        percent: (counts[level] / total) * 100
      }));
  }

  /**
   * Nom court du repo pour affichage (ex: owner/repo)
   */
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

  /**
   * Date de création de l'application (formatée comme dans environment-details)
   */

  getAppCreatedAtTimeAgo(): string {
    if (!this.appDetails?.createdAt) return '';
    return this.format.formatTimeAgo(this.appDetails.createdAt);
  }

  

  /**
   * Offset pour le donut SVG (démarrage en haut, segments consécutifs)
   */
  getDonutOffset(index: number): number {
    let sum = 0;
    for (let j = 0; j < index; j++) {
      sum += this.deploymentChartData[j].percent || 0;
    }
    return -25 - sum; // 25 = start at 12 o'clock in 0–100 circle
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

  // Dans project-overview.component.ts - Ajoutez cette méthode
private safeParseDate(dateValue: any): Date | null {
  if (!dateValue) return null;
  
  try {
    // Si c'est déjà une string ISO
    if (typeof dateValue === 'string') {
      const date = new Date(dateValue);
      return isNaN(date.getTime()) ? null : date;
    }
    
    // Si c'est un tableau [année, mois, jour, heure, minute, seconde]
    if (Array.isArray(dateValue) && dateValue.length >= 3) {
      const [year, month, day, hour = 0, minute = 0, second = 0] = dateValue;
      // Mois est 0-indexé en JS, donc month - 1
      const date = new Date(year, month - 1, day, hour, minute, second);
      return isNaN(date.getTime()) ? null : date;
    }
    
    return null;
  } catch (e) {
    console.warn('Erreur parsing date:', dateValue, e);
    return null;
  }
}

  // Dans le composant
get stats() {
  return [
    { 
      label: 'Déploiements', 
      value: this.totalDeployments, 
      icon: '📦', 
      color: '#3b82f6',
      iconBg: 'rgba(59, 130, 246, 0.2)'
    },
    { 
      label: 'Réussis', 
      value: this.successfulDeployments, 
      icon: '✅', 
      color: '#22c55e',
      iconBg: 'rgba(34, 197, 94, 0.2)',
      trend: this.totalDeployments ? `${Math.round(this.successfulDeployments/this.totalDeployments*100)}%` : '0%'
    },
    { 
      label: 'En attente', 
      value: this.pendingDeployments, 
      icon: '⏳', 
      color: '#f97316',
      iconBg: 'rgba(249, 115, 22, 0.2)'
    },
    { 
      label: 'Échoués', 
      value: this.failedDeployments, 
      icon: '❌', 
      color: '#ef4444',
      iconBg: 'rgba(239, 68, 68, 0.2)'
    },
    { 
      label: 'Vulnérabilités', 
      value: this.criticalVulnerabilities, 
      icon: '🛡️', 
      color: '#8b5cf6',
      iconBg: 'rgba(139, 92, 246, 0.2)'
    }
  ];
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
  /**
 * Formate une date en "il y a X temps"
 */
formatTimeAgo(iso: string | null | any): string {
  const date = this.safeParseDate(iso);
  if (!date) return '—';
  
  try {
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
    
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  } catch (e) {
    return '—';
  }
}

/**
 * Formate une date complète
 */
formatFullDate(dateValue: any): string {
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

/**
 * Date de création de l'application (formatée)
 */
getAppCreatedAt(): string {
  if (!this.appDetails?.createdAt) return 'Date non disponible';
  return this.formatFullDate(this.appDetails.createdAt);
}

/**
 * Date de création du déploiement (pour l'affichage)
 */
getDeploymentCreatedAt(deployment: DeploymentHistoryItem): string {
  return this.formatFullDate(deployment.createdAt);
}

getDeploymentTimeAgo(deployment: DeploymentHistoryItem): string {
  return this.formatTimeAgo(deployment.createdAt);
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