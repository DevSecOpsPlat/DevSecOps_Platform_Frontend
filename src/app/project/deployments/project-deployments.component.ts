import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApplicationService } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import { ENVIRONMENT_STATUS } from 'src/app/models/environment/status-types';
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
  expiredCount: number = 0;
  totalCount: number = 0;

  // Constantes pour les statuts
  readonly ENV_STATUS = ENVIRONMENT_STATUS;

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
      this.isEnvironmentActive(env.environmentStatus)
    ).length;
    this.expiredCount = this.environments.filter(env => 
      env.environmentStatus === 'EXPIRED' || env.environmentStatus === 'DESTROYED'
    ).length;
  }

  applyFilter(): void {
    let filtered = [...this.environments];
    
    // Filtre par branche
    if (this.branchFilter?.trim()) {
      const filter = this.branchFilter.toLowerCase().trim();
      filtered = filtered.filter(env => 
        env.gitBranch?.toLowerCase().includes(filter)
      );
    }
    
    // Filtre par statut d'ENVIRONNEMENT
    if (this.statusFilter) {
      const statuses = this.statusFilter.split(',');
      filtered = filtered.filter(env => {
        const envStatus = env.environmentStatus?.toUpperCase() || '';
        return statuses.some(s => {
          // CORRECTION: Utiliser ENV_STATUS au lieu de this.ENV_STATUS
          if (s === 'ACTIVE') return ENVIRONMENT_STATUS.ACTIVE.includes(envStatus as any);
          if (s === 'IN_PROGRESS') return ENVIRONMENT_STATUS.IN_PROGRESS.includes(envStatus as any);
          if (s === 'TERMINATED') return ENVIRONMENT_STATUS.TERMINATED.includes(envStatus as any);
          return envStatus === s;
        });
      });
    }
    
    this.filteredEnvironments = filtered;
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
    const s = (status || '').toUpperCase();
    // CORRECTION: Utiliser ENVIRONMENT_STATUS directement
    if (ENVIRONMENT_STATUS.ACTIVE.includes(s as any)) return 'env-status-active';
    if (ENVIRONMENT_STATUS.IN_PROGRESS.includes(s as any)) return 'env-status-building';
    if (s === 'EXPIRED') return 'env-status-expired';
    if (s === 'FAILED') return 'env-status-failed';
    if (s === 'DESTROYED') return 'env-status-destroyed';
    return 'env-status-default';
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
    return (status || '').toUpperCase() === 'RUNNING';
  }

  isEnvironmentExpired(env: DeploymentHistoryItem): boolean {
  // Vérifier d'abord le statut
  if (env.environmentStatus === 'EXPIRED' || env.environmentStatus === 'DESTROYED') {
    return true;
  }
  
  // Vérifier par la date d'expiration si elle existe
  if (env.expiresAt) {
    return new Date(env.expiresAt) < new Date();
  }
  
  return false;
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
    return u || null;
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