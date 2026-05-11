// project-overview.component.ts
import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { ApplicationService, DeploymentMetrics } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import { EnvironmentService } from '../../services/environment/environment.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';
import { ApplicationResponse } from 'src/app/models/application/application-response';
import { 
  ActivityItem, 
  DashboardPipelineItem, 
  DashboardEnvironmentItem,
  DashboardVulnerabilityItem 
} from 'src/app/models/dashboard/dashboard.models';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { FormatService } from 'src/app/models/environment/format.service';
import { SecurityService } from 'src/app/services/security/security.service';
import { FindingsService } from 'src/app/services/findings/findings.service';

export interface ChartSegment {
  label: string;
  value: number;
  color: string;
  percent?: number;
}

/** Libellés dashboard pour les stages du template (voir `docs/pipeline.md`). */
const PIPELINE_STAGE_LABELS: Record<string, string> = {
  hello: 'Accueil',
  clone: 'Clone / détection',
  'sonarqube-setup': 'Sonar — setup',
  'sonarqube-scan': 'Sonar — analyse',
  'sca-trivy': 'SCA — Trivy',
  'sca-node': 'SCA — Node',
  'sca-python': 'SCA — Python',
  'sca-java': 'SCA — Java / Maven',
  'sca-owasp': 'SCA — OWASP Dependency-Check',
  'sast-generic': 'SAST — Semgrep',
  'sast-angular': 'SAST — Angular / React',
  secrets: 'Secrets (Gitleaks)',
  container: 'Conteneur',
  iac: 'IaC (Checkov)',
  'license-node': 'Licences — Node',
  'license-python': 'Licences — Python',
  'build-image': 'Build image',
  'container-scan': 'Scan image',
  'push-image': 'Push image',
  'deploy-k8s': 'Déploiement K8s',
  'schedule-delete': 'Planification suppression',
  report: 'Rapport agrégé'
};

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
  environmentsForApp: EnvironmentSummaryResponse[] = [];
  selectedEnvironmentId: string | null = null;
  recentVulnerabilities: DashboardVulnerabilityItem[] = [];
  /** Comptages OPEN distincts par sévérité (tous envs de cette application). */
  vulnerabilityStatsBySeverity: Record<string, number> = {};
  /** Total findings OPEN distincts (aligné avec le dashboard vulnérabilités). */
  totalOpenVulnerabilities = 0;
  /** OPEN crit + high (sous-indicateur). */
  highCriticalVulnerabilityCount = 0;

  loadingPipelineDetails: boolean = false;
  
  // Statistiques
  totalDeployments: number = 0;
  successfulDeployments: number = 0;
  failedDeployments: number = 0;
  /** Pipelines SKIPPED (comptabilisés dans le donut avec les autres statuts). */
  skippedDeployments: number = 0;
  
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
    private findingsService: FindingsService,
    private format: FormatService,
    private sanitizer: DomSanitizer
  ) {}

  get previewUrl(): string | null {
    return this.environmentSummary?.previewUrl ?? null;
  }

  /** URL publique de l’app (résumé env ou dernier déploiement). */
  get liveDeploymentUrl(): string | null {
    const fromSummary = (this.environmentSummary?.previewUrl || '').trim();
    const fromHistory = (this.latestDeployment?.deploymentUrl || '').trim();
    const u = fromSummary || fromHistory;
    return u || null;
  }

  get trustedEmbedUrl(): SafeResourceUrl | null {
    const u = this.liveDeploymentUrl;
    if (!u) {
      return null;
    }
    return this.sanitizer.bypassSecurityTrustResourceUrl(u);
  }

  openLiveDeployment(): void {
    const u = this.liveDeploymentUrl;
    if (!u) {
      return;
    }
    window.open(u, '_blank', 'noopener,noreferrer');
  }

  ngOnInit(): void {
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') || null;
    if (this.appId) {
      const qpEnv = this.route.snapshot.queryParamMap.get('env');
      const stored = localStorage.getItem(`selectedEnv:${this.appId}`);
      this.selectedEnvironmentId = (qpEnv || stored || null);
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

  onEnvironmentSelected(envId: string): void {
    if (!envId || !this.appId) {
      return;
    }
    this.selectedEnvironmentId = envId;
    localStorage.setItem(`selectedEnv:${this.appId}`, envId);
    // refléter dans l’URL pour partage / refresh
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { env: envId },
      queryParamsHandling: 'merge'
    });

    // Recharge les sections dépendantes de l’environnement sélectionné
    this.loadEnvironmentSummary(envId);

    // Vulnérabilités récentes: basculer sur cet environnement
    this.securityService.getRecentVulnerabilities(5, this.appId, envId).subscribe({
      next: (items) => (this.recentVulnerabilities = items || []),
      error: () => {}
    });

    // “Dernier déploiement” = dernier pipeline pour cet env (si l’historique est déjà chargé)
    const byEnv = (this.deployments || []).filter(d => d.environmentId === envId);
    this.latestDeployment = byEnv.length > 0 ? byEnv[0] : null;
    if (this.latestDeployment) {
      this.loadLatestPipelineDetails();
    }
  }

  /**
   * Charge les données de l'application de manière progressive
   */
  loadAppData(): void {
    if (!this.appId) return;

    this.applicationService.clearDeploymentsCache(this.appId);

    this.loading = true;
    this.loadingSlow = false;
    this.error = null;
    
    // 1. D'abord charger les données rapides
    forkJoin({
      appInfo: this.applicationService.getApplicationById(this.appId).pipe(
        catchError(err => {
          console.error('Erreur chargement application:', err);
          return of(null);
        })
      ),
      environments: this.environmentService.getMyEnvironments(this.appId).pipe(
        catchError(err => {
          console.error('Erreur chargement environnements:', err);
          return of([]);
        })
      ),
      vulnerabilities: this.securityService.getRecentVulnerabilities(5, this.appId, this.selectedEnvironmentId || undefined).pipe(
        catchError(err => {
          console.error('Erreur chargement vulnérabilités:', err);
          return of([]);
        })
      ),
      findingStats: this.findingsService.getStatsByApplication(this.appId, 'OPEN').pipe(
        catchError(err => {
          console.error('Erreur chargement stats findings:', err);
          return of(null);
        })
      )
    }).subscribe({
      next: (quickData) => {
        if (quickData.appInfo) {
          this.appDetails = quickData.appInfo;
          this.appName = quickData.appInfo.name;
        }
        
        this.environmentsForApp = (quickData.environments || []);

        // Sélection par défaut: valeur sauvegardée, sinon le plus récent RUNNING, sinon le premier.
        const ids = new Set(this.environmentsForApp.map(e => e.id));
        if (!this.selectedEnvironmentId || !ids.has(this.selectedEnvironmentId)) {
          const running = this.environmentsForApp.find(e => (e.status || '').toUpperCase() === 'RUNNING');
          this.selectedEnvironmentId = running?.id || this.environmentsForApp[0]?.id || null;
          if (this.selectedEnvironmentId && this.appId) {
            localStorage.setItem(`selectedEnv:${this.appId}`, this.selectedEnvironmentId);
          }
        }

        this.activeEnvironments = (this.environmentsForApp || [])
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

        const fs = quickData.findingStats;
        this.vulnerabilityStatsBySeverity = fs?.bySeverity ? { ...fs.bySeverity } : {};
        this.totalOpenVulnerabilities =
          fs?.openDistinctTotal ??
          Object.values(this.vulnerabilityStatsBySeverity).reduce((s, n) => s + (n || 0), 0);
        this.highCriticalVulnerabilityCount =
          (this.vulnerabilityStatsBySeverity['CRITICAL'] ?? 0) +
          (this.vulnerabilityStatsBySeverity['HIGH'] ?? 0);
        // Graphique vuln : ne pas attendre la phase lente (sinon KPI ≠ graphique).
        this.vulnerabilityChartData = this.buildVulnerabilityChartData();

        // Afficher le dashboard dès que les données rapides sont là
        this.loading = false;

        // 2. Ensuite charger les données plus lentes (en arrière-plan)
        this.loadDeploymentsAndPipelines();
      },
      error: (err) => {
        console.error('Erreur chargement données rapides:', err);
        // On n'empêche pas l'UI de s'afficher : on passe en mode "données lentes" best-effort
        this.loading = false;
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
    deploymentMetrics: this.applicationService.getDeploymentMetrics(this.appId).pipe(
      catchError(err => {
        console.error('Erreur chargement métriques déploiements:', err);
        return of(null);
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
      // Dernier déploiement: par env sélectionné si dispo, sinon global
      if (this.selectedEnvironmentId) {
        const byEnv = this.deployments.filter(d => d.environmentId === this.selectedEnvironmentId);
        this.latestDeployment = byEnv.length > 0 ? byEnv[0] : (this.deployments.length > 0 ? this.deployments[0] : null);
      } else {
        this.latestDeployment = this.deployments.length > 0 ? this.deployments[0] : null;
      }
      
      console.log('📦 Données pipelines brutes:', slowData.pipelines);

      // Corréler aux envs de cette app (BDD), pas seulement à l’historique déploiements :
      // si l’API deployments est vide ou en erreur, l’ancien filtre masquait tous les pipelines.
      const envIdsForApp = new Set<string>();
      (this.environmentsForApp || []).forEach(e => envIdsForApp.add(String(e.id)));
      (this.deployments || []).forEach((d: any) => {
        if (d?.environmentId) {
          envIdsForApp.add(String(d.environmentId));
        }
      });

      const rawPipelines = (slowData.pipelines || []).filter((p: any) => {
        if (!p?.environmentId) {
          return false;
        }
        // listPipelines = tous les envs de l’utilisateur : sans ids d’app on ne filtre pas (risque fuite inter-apps).
        if (envIdsForApp.size === 0) {
          return false;
        }
        return envIdsForApp.has(String(p.environmentId));
      });
      
      // Afficher les dates pour debug
      rawPipelines.forEach((p: any) => {
        console.log('Pipeline createdAt:', p.createdAt, 'type:', typeof p.createdAt);
      });
      
      this.recentPipelines = rawPipelines
        .sort((a: any, b: any) => {
          const dateA = this.safeParseDate(a.createdAt)?.getTime() || 0;
          const dateB = this.safeParseDate(b.createdAt)?.getTime() || 0;
          return dateB - dateA;
        })
        .slice(0, 5)
        .map((p: any) => ({
          id: p.pipelineId,
          name: `Pipeline #${p.pipelineId}`,
          branch: p.gitBranch || p.ref || 'main',
          status: p.status || p.pipelineStatus,
          createdAt: this.safeParseDate(p.createdAt)?.toISOString() || 
                this.safeParseDate(p.startedAt)?.toISOString() || 
                this.safeParseDate(p.finishedAt)?.toISOString() || 
                new Date().toISOString(),
          environmentId: p.environmentId,
          environmentName: p.environmentName,
          triggeredBy: p.createdByUsername
        }));
      
      // Statistiques : agrégats BDD (toute l’app), pas la longueur de la page d’historique (ex. 10 lignes).
      const m: DeploymentMetrics | null = slowData.deploymentMetrics;
      if (m != null && typeof m.total === 'number') {
        this.totalDeployments = m.total;
        this.successfulDeployments = m.success ?? 0;
        this.failedDeployments = (m.failed ?? 0) + (m.canceled ?? 0);
        this.pendingDeployments = (m.pending ?? 0) + (m.running ?? 0);
        this.skippedDeployments = m.skipped ?? 0;
      } else {
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
        this.skippedDeployments = this.deployments.filter(d =>
          d.pipelineStatus?.toUpperCase() === 'SKIPPED'
        ).length;
      }
      
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
      
      this.loadingSlow = false;
    },
    error: (err) => {
      console.error('Erreur chargement données lentes:', err);
      this.loadingSlow = false;
      this.error = 'Erreur lors du chargement des données';
    }
  });
}

  // Dans le composant
getPipelineCreatedAt(pipeline: DashboardPipelineItem): string {
  if (!pipeline?.createdAt) return '—';
  return this.formatFullDate(pipeline.createdAt);
}

getPipelineTimeAgo(pipeline: DashboardPipelineItem): string {
  if (!pipeline?.createdAt) return '—';
  return this.formatTimeAgo(pipeline.createdAt);
}

// Pour ActivityItem
getActivityTimeAgo(activity: ActivityItem): string {
  if (!activity?.timestamp) return '—';
  return this.formatTimeAgo(activity.timestamp);
}

activityKindLabel(type: ActivityItem['type']): string {
  switch (type) {
    case 'deployment':
      return 'Déploiement';
    case 'pipeline':
      return 'Pipeline';
    case 'environment':
      return 'Environnement';
    default:
      return '';
  }
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
      timestamp: p.createdAt || new Date().toISOString(), // Fallback
      status: p.status,
      icon: '⚙️',
      link: `/pipeline/${p.environmentId}?appId=${this.appId}`
    });
  });

  // Environnements récents (tous statuts), triés par date de création
  const envByDate = [...(this.environmentsForApp || [])].sort((a, b) => {
    const ta = this.safeParseDate(a.createdAt)?.getTime() || 0;
    const tb = this.safeParseDate(b.createdAt)?.getTime() || 0;
    return tb - ta;
  });
  envByDate.slice(0, 4).forEach(e => {
    const { title, description } = this.environmentActivityCopy(e);
    const st = (e.status || '').toUpperCase();
    const preview =
      st === 'RUNNING' && (e.previewUrl || '').trim() ? (e.previewUrl as string).trim() : undefined;
    activities.push({
      id: e.id,
      type: 'environment',
      title,
      description,
      timestamp: e.createdAt,
      status: e.status,
      icon: this.getEnvironmentActivityIcon(e.status),
      link: `/pipeline/${e.id}?appId=${this.appId ?? ''}`,
      previewUrl: preview
    });
  });
  
  // Trier par date
  this.recentActivities = activities
    .sort((a, b) => {
      const dateA = this.safeParseDate(a.timestamp)?.getTime() || 0;
      const dateB = this.safeParseDate(b.timestamp)?.getTime() || 0;
      return dateB - dateA;
    })
    .slice(0, 5);
    
  // 🔍 Log final
  console.log('📊 Activities avec dates:', this.recentActivities.map(a => ({
    type: a.type,
    timestamp: a.timestamp,
    formatted: this.formatTimeAgo(a.timestamp)
  })));
}

  /**
   * Données pour le graphique des déploiements (success / failed / pending)
   */
  private buildDeploymentChartData(): ChartSegment[] {
    const total = this.totalDeployments || 1;
    const rows: ChartSegment[] = [
      { label: 'Réussis', value: this.successfulDeployments, color: '#22c55e', percent: (this.successfulDeployments / total) * 100 },
      { label: 'Échoués', value: this.failedDeployments, color: '#ef4444', percent: (this.failedDeployments / total) * 100 },
      { label: 'En cours', value: this.pendingDeployments, color: '#f97316', percent: (this.pendingDeployments / total) * 100 }
    ];
    if (this.skippedDeployments > 0) {
      rows.push({
        label: 'Ignorés',
        value: this.skippedDeployments,
        color: '#64748b',
        percent: (this.skippedDeployments / total) * 100
      });
    }
    return rows.filter(s => s.value > 0);
  }

  /**
   * Données pour le graphique des vulnérabilités par sévérité
   */
  private buildVulnerabilityChartData(): ChartSegment[] {
    const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    const src = this.vulnerabilityStatsBySeverity || {};
    for (const key of Object.keys(src)) {
      const k = key.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(counts, k)) {
        counts[k] = src[key] ?? 0;
      }
    }
    const total =
      this.totalOpenVulnerabilities ||
      Object.values(counts).reduce((s, n) => s + n, 0) ||
      1;
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
    const mapped = PIPELINE_STAGE_LABELS[stage.trim().toLowerCase()];
    if (mapped) return mapped;
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
        const expiresMs = this.parseBackendInstantMs(env.expiresAt as unknown);
        const createdMs = this.parseBackendInstantMs(env.createdAt as unknown);
        if (expiresMs != null && createdMs != null && expiresMs > createdMs) {
          const now = Date.now();
          this.totalSeconds = Math.max(1, Math.floor((expiresMs - createdMs) / 1000));
          this.remainingSeconds = Math.max(0, Math.floor((expiresMs - now) / 1000));
          this.startCountdown();
        } else {
          if (this.countdownIntervalId) {
            clearInterval(this.countdownIntervalId);
            this.countdownIntervalId = undefined;
          }
          this.totalSeconds = undefined;
          this.remainingSeconds = undefined;
        }
      },
      error: () => {}
    });
  }

  /** Spring / Jackson envoie souvent les dates en tableau [y, mo, d, h, min, s]. */
  private parseBackendInstantMs(value: unknown): number | null {
    if (value == null) {
      return null;
    }
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
  calculateTimeRemaining(expiresAt: unknown): string {
    const expiryMs = this.parseBackendInstantMs(expiresAt);
    if (expiryMs == null) return '—';
    try {
      const nowMs = Date.now();
      if (expiryMs <= nowMs) return 'Expiré';

      const diffMs = expiryMs - nowMs;
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
    // Si c'est un nombre (timestamp Unix)
    if (typeof dateValue === 'number') {
      const date = new Date(dateValue);
      return isNaN(date.getTime()) ? null : date;
    }
    
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
get stats(): Array<{
  label: string;
  value: number | string;
  icon: string;
  color: string;
  iconBg: string;
  trend?: string;
}> {
  const depPending = this.loadingSlow;
  return [
    { 
      label: 'Déploiements', 
      value: depPending ? '…' : this.totalDeployments, 
      icon: '📦', 
      color: '#3b82f6',
      iconBg: 'rgba(59, 130, 246, 0.2)'
    },
    { 
      label: 'Réussis', 
      value: depPending ? '…' : this.successfulDeployments, 
      icon: '✅', 
      color: '#22c55e',
      iconBg: 'rgba(34, 197, 94, 0.2)',
      trend: depPending
        ? '…'
        : (this.totalDeployments ? `${Math.round(this.successfulDeployments / this.totalDeployments * 100)}%` : '0%')
    },
    { 
      label: 'En attente', 
      value: depPending ? '…' : this.pendingDeployments, 
      icon: '⏳', 
      color: '#f97316',
      iconBg: 'rgba(249, 115, 22, 0.2)'
    },
    { 
      label: 'Échoués', 
      value: depPending ? '…' : this.failedDeployments, 
      icon: '❌', 
      color: '#ef4444',
      iconBg: 'rgba(239, 68, 68, 0.2)'
    },
    { 
      label: 'Vulnérabilités (ouvertes)', 
      value: this.totalOpenVulnerabilities, 
      icon: '🛡️', 
      color: '#8b5cf6',
      iconBg: 'rgba(139, 92, 246, 0.2)',
      trend:
        this.highCriticalVulnerabilityCount > 0
          ? `Crit./Élevées: ${this.highCriticalVulnerabilityCount}`
          : undefined
    }
  ];
}

  /**
   * Formate le temps restant pour l'affichage
   */
  formatRemaining(): string {
    if (this.remainingSeconds == null || Number.isNaN(this.remainingSeconds)) {
      return '—';
    }
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

  /** Pour la barre TTL (évite NaN si totalSeconds absent). */
  ttlProgressPercent(): number {
    const total = this.totalSeconds;
    const rem = this.remainingSeconds;
    if (total == null || total <= 0 || rem == null || Number.isNaN(rem) || Number.isNaN(total)) {
      return 0;
    }
    return Math.min(100, Math.max(0, (rem / total) * 100));
  }

  /**
   * Copie l'URL de prévisualisation
   */
  copyPreviewUrl(): void {
    const u = this.liveDeploymentUrl;
    if (!u) return;
    navigator.clipboard.writeText(u).then(() => {
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
    if (s === 'RUNNING' || s === 'PENDING' || s === 'BUILDING') return 'status-warning';
    if (s === 'DESTROYED' || s === 'EXPIRED') return 'status-muted';
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

  /** Libellés activité « environnement » selon le statut de l’env. */
  private environmentActivityCopy(env: EnvironmentSummaryResponse): { title: string; description: string } {
    const name = env.environmentName || 'Environnement';
    const branch = env.gitBranch || '—';
    const st = (env.status || '').toUpperCase();
    switch (st) {
      case 'RUNNING':
        return { title: 'Environnement actif', description: `${name} — branche ${branch}` };
      case 'PENDING':
        return { title: 'Environnement en attente', description: `${name} — branche ${branch}` };
      case 'BUILDING':
        return { title: 'Environnement en construction', description: `${name} — branche ${branch}` };
      case 'FAILED':
        return { title: 'Environnement en échec', description: `${name} — branche ${branch}` };
      case 'DESTROYED':
        return { title: 'Environnement détruit', description: `${name} — branche ${branch}` };
      case 'EXPIRED':
        return { title: 'Environnement expiré', description: `${name} — branche ${branch}` };
      default:
        return { title: 'Environnement', description: `${name} — branche ${branch} (${st || '?'})` };
    }
  }

  private getEnvironmentActivityIcon(status: string | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'RUNNING') return '🌍';
    if (s === 'BUILDING') return '🔧';
    if (s === 'PENDING') return '⏳';
    if (s === 'FAILED') return '⚠️';
    if (s === 'DESTROYED' || s === 'EXPIRED') return '🗑️';
    return '🌍';
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

  /** Centre de sécurité (liste complète) : route projet, pas /security/vulnerabilities (redirect). */
  viewAllVulnerabilities(): void {
    if (!this.appId) return;
    const envId =
      this.latestDeployment?.environmentId ||
      (this.activeEnvironments.length ? this.activeEnvironments[0].id : undefined);
    this.router.navigate(['/project', this.appId, 'vulnerabilities'], {
      queryParams: envId ? { envId } : {}
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