import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApplicationService } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import {
  ENVIRONMENT_FILTER_OPTIONS,
  ENVIRONMENT_STATUS,
  environmentStatusView,
  getPipelineStatusLabel,
  matchesEnvironmentFilter
} from 'src/app/models/environment/status-types';
import { FormatService } from 'src/app/models/environment/format.service';

@Component({
  selector: 'app-project-deployments',
  templateUrl: './project-deployments.component.html',
  styleUrls: ['./project-deployments.component.css']
})
export class ProjectDeploymentsComponent implements OnInit {
  appId: string | null = null;
  appName: string = '';
  environments: DeploymentHistoryItem[] = [];
  filteredEnvironments: DeploymentHistoryItem[] = [];
  loading = true;
  error: string | null = null;
  
  // Filtres
  branchFilter: string = '';
  statusFilter: string | null = null;
  
  // Stats
  activeCount: number = 0;
  inProgressCount: number = 0;
  failedCount: number = 0;
  endedCount: number = 0;
  totalCount: number = 0;

  readonly statusFilterOptions = ENVIRONMENT_FILTER_OPTIONS;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private applicationService: ApplicationService,
    private sanitizer: DomSanitizer,
    public format: FormatService
  ) {}

  ngOnInit(): void {
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') || null;
    
    if (this.appId) {
      this.loadAppName();
    }
    
    this.route.queryParamMap.subscribe(params => {
      this.statusFilter = params.get('status');
      if (this.appId) {
        this.loadEnvironments();
      }
    });
  }

  private loadAppName(): void {
    if (!this.appId) return;
    this.applicationService.getApplicationById(this.appId).subscribe({
      next: (app) => this.appName = app.name
    });
  }

  loadEnvironments(): void {
    if (!this.appId) return;
    
    this.loading = true;
    this.error = null;
    
    this.applicationService.getDeploymentHistory(this.appId, this.branchFilter || undefined).subscribe({
      next: (items) => {
        this.environments = items;
        this.calculateStats();
        this.applyFilter();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement';
      }
    });
  }

  calculateStats(): void {
    this.totalCount = this.environments.length;
    this.activeCount = this.environments.filter(env =>
      matchesEnvironmentFilter(env.environmentStatus, 'ACTIVE')
    ).length;
    this.inProgressCount = this.environments.filter(env =>
      matchesEnvironmentFilter(env.environmentStatus, 'IN_PROGRESS')
    ).length;
    this.failedCount = this.environments.filter(env =>
      matchesEnvironmentFilter(env.environmentStatus, 'NEVER_STARTED')
    ).length;
    this.endedCount = this.environments.filter(env =>
      matchesEnvironmentFilter(env.environmentStatus, 'ENDED')
    ).length;
  }

  applyFilter(): void {
    let filtered = [...this.environments];
    
    if (this.branchFilter?.trim()) {
      const filter = this.branchFilter.toLowerCase().trim();
      filtered = filtered.filter(env => 
        env.gitBranch?.toLowerCase().includes(filter)
      );
    }
    
    if (this.statusFilter) {
      filtered = filtered.filter(env =>
        matchesEnvironmentFilter(env.environmentStatus, this.statusFilter)
      );
    }
    
    this.filteredEnvironments = filtered;
  }

  setStatusFilter(filter: string | null): void {
    this.statusFilter = filter;
    if (!this.appId) {
      this.applyFilter();
      return;
    }
    const queryParams: Record<string, string> = {};
    if (filter) queryParams['status'] = filter;
    if (this.branchFilter?.trim()) queryParams['branch'] = this.branchFilter.trim();
    this.router.navigate(['/project', this.appId, 'deployments'], {
      queryParams,
      replaceUrl: true
    });
    this.applyFilter();
  }

  onBranchFilterChange(): void {
    this.applyFilter();
  }

  clearFilters(): void {
    this.branchFilter = '';
    this.statusFilter = null;
    
    if (this.appId) {
      this.router.navigate(['/project', this.appId, 'deployments']);
    }
    
    this.applyFilter();
  }

  // Classes CSS pour les statuts
  environmentStatusClass(status: string | undefined): string {
    return environmentStatusView(status).cssClass;
  }

  pipelineStatusClass(status: string | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'pipeline-success';
    if (s === 'FAILED') return 'pipeline-failed';
    if (s === 'CANCELED') return 'pipeline-canceled';
    if (['RUNNING', 'PENDING'].includes(s)) return 'pipeline-running';
    return 'pipeline-default';
  }

  // Utilisation directe du format service
  getEnvironmentStatusIcon(status: string | undefined): string {
    return this.format.getEnvironmentStatusIcon(status || '');
  }

  getEnvironmentStatusDescription(status: string | undefined): string {
    return this.format.getEnvironmentStatusDescription(status || '');
  }

  // Vérifications
  isEnvironmentActive(status: string | undefined): boolean {
    return ENVIRONMENT_STATUS.ACTIVE.includes((status || '').toUpperCase() as any);
  }

  isEnvironmentExpired(env: DeploymentHistoryItem): boolean {
    return (env.environmentStatus || '').toUpperCase() === 'EXPIRED';
  }

  // Navigation
  viewEnvironment(envId: string): void {
    this.router.navigate(['/environment', envId], {
      queryParams: { appId: this.appId }
    });
  }

  viewPipeline(envId: string): void {
    this.router.navigate(['/pipeline', envId], {
      queryParams: { appId: this.appId }
    });
  }

  goBackToProject(): void {
    if (this.appId) {
      this.router.navigate(['/project', this.appId, 'overview']);
    }
  }

  createNewEnvironment(): void {
    if (this.appId) {
      this.router.navigate(['/environment-create'], {
        queryParams: { appId: this.appId }
      });
    } else {
      this.router.navigate(['/environment-create']);
    }
  }

  matchesBranchFilter(env: DeploymentHistoryItem): boolean {
    return !!(this.branchFilter && 
              env.gitBranch && 
              env.gitBranch.toLowerCase().includes(this.branchFilter.toLowerCase()));
  }

  /** URL publique renseignée par le backend (webhook / déploiement). */
  deploymentLink(env: DeploymentHistoryItem): string | null {
    const u = (env.deploymentUrl || '').trim();
    return this.canExposeDeploymentUrl(env, u) ? u : null;
  }

  canEmbedPreview(url: string): boolean {
    const u = (url || '').trim().toLowerCase();
    return u.startsWith('http://') || u.startsWith('https://');
  }

  trustedEmbed(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  isDeploymentInProgress(env: DeploymentHistoryItem): boolean {
    const s = (env.environmentStatus || '').toUpperCase();
    return s === 'PENDING' || s === 'BUILDING';
  }

  isDeploymentFailed(env: DeploymentHistoryItem): boolean {
    return (env.environmentStatus || '').toUpperCase() === 'FAILED';
  }

  environmentStatusLabel(env: DeploymentHistoryItem): string {
    const view = environmentStatusView(env.environmentStatus);
    if (env.statusReason?.trim()) {
      return view.label;
    }
    if ((env.environmentStatus || '').toUpperCase() === 'DESTROYED') {
      const pipeline = (env.pipelineStatus || '').toUpperCase();
      if (pipeline === 'FAILED' || pipeline === 'CANCELED') {
        return 'Détruit — déploiement en échec';
      }
      return 'Terminé';
    }
    return view.label;
  }

  environmentStatusReason(env: DeploymentHistoryItem): string | null {
    return env.statusReason?.trim() || null;
  }

  pipelineStatusLabel(status: string | undefined): string {
    return getPipelineStatusLabel(status || '');
  }

  previewFailureReason(env: DeploymentHistoryItem): string {
    if (this.isEnvironmentExpired(env)) {
      return 'Aucune URL — le déploiement est expiré.';
    }
    if (this.isDeploymentFailed(env)) {
      return 'Aucune URL — le déploiement n\'a jamais abouti.';
    }
    if ((env.deploymentUrl || '').toLowerCase().includes('.local')) {
      return 'URL locale non résolvable depuis le navigateur. Utilisez le pipeline ou un port-forward.';
    }
    return 'Aucune URL de prévisualisation n\'a été publiée pour cet environnement.';
  }

  showPortForwardHint(env: DeploymentHistoryItem): boolean {
    return ((env.deploymentUrl || '').toLowerCase().includes('.local'));
  }

  portForwardCommand(env: DeploymentHistoryItem): string {
    const ns = env.environmentName;
    const service = this.serviceNameFromNamespace(env.environmentName);
    return `kubectl -n ${ns} port-forward svc/${service} 8080:80`;
  }

  private serviceNameFromNamespace(namespace: string): string {
    if (!namespace) return 'app';
    const normalized = namespace.replace(/^env-/, '');
    const parts = normalized.split('-');
    if (parts.length <= 1) return normalized || 'app';
    return parts.slice(0, -1).join('-') || 'app';
  }

  private canExposeDeploymentUrl(env: DeploymentHistoryItem, url: string): boolean {
    if (!url) return false;
    if (!this.canEmbedPreview(url) && !url.startsWith('http://') && !url.startsWith('https://')) return false;
    return environmentStatusView(env.environmentStatus).canShowUrl;
  }


// Formater la date de création
getCreatedAtDate(env: DeploymentHistoryItem): string {
  if (!env.createdAt) return '—';
  return this.format.formatDate(env.createdAt);
}

// Formater le temps relatif (il y a X minutes)
getCreatedAtTimeAgo(env: DeploymentHistoryItem): string {
  if (!env.createdAt) return '';
  return this.format.formatTimeAgo(env.createdAt);
}

// Formater la date d'expiration
getExpiresAtDate(env: DeploymentHistoryItem): string {
  if (!env.expiresAt) return '—';
  return this.format.formatDate(env.expiresAt);
}

// Obtenir le temps restant avant expiration
getTimeRemaining(env: DeploymentHistoryItem): string {
  if (!env.expiresAt) return '—';
  return this.format.getTimeRemaining(env.expiresAt);
}

// Vérifier si l'environnement est expiré (déjà défini)
// isEnvironmentExpired(env) existe déjà

// Obtenir la classe CSS pour l'expiration
getExpiryClass(env: DeploymentHistoryItem): string {
  if (this.isEnvironmentExpired(env)) return 'expired';
  if (!env.expiresAt) return '';
  
  const expiryDate = new Date(env.expiresAt);
  const now = new Date();
  const diffHours = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  
  if (diffHours < 1) return 'expiring-soon';
  if (diffHours < 3) return 'expiring';
  return '';
}
}