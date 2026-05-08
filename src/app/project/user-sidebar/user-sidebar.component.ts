import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';
import { ApplicationService } from '../../services/application/application.service';
import { ApplicationResponse } from 'src/app/models/application/application-response';
import { PipelineService } from 'src/app/services/pipeline/pipeline.service';
import { EnvironmentService } from 'src/app/services/environment/environment.service'; // ← AJOUTER

@Component({
  selector: 'app-user-sidebar',
  templateUrl: './user-sidebar.component.html',
  styleUrls: ['./user-sidebar.component.css']
})
export class UserSidebarComponent implements OnInit {
  /** Dernier projet ouvert (URL /project/:id/...) — pour garder le contexte hors des routes projet. */
  private static readonly LAST_PROJECT_APP_ID_KEY = 'envirotest-last-project-app-id';

  currentAppId: string | null = null;
  lastEnvId: string | null = null;
  currentApp: ApplicationResponse | null = null;
  project: ApplicationResponse | null = null;
  
  pipelineCounts = {
    total: 0,
    success: 0,
    failed: 0,
    pending: 0
  };
  
  totalDeploymentsCount: number = 0;
  activeDeploymentsCount: number = 0;
  lastDeploymentEnvId: string | null = null;
  currentDeploymentsFilter: string | null = null;

  // ✅ AJOUTER CES PROPRIÉTÉS
  lastPipelineId: string | null = null;
  lastPipelineEnvId: string | null = null;
  lastEnvironmentId: string | null = null;

  constructor(
    public authService: AuthService,
    private router: Router,
    private applicationService: ApplicationService,
    private pipelineService: PipelineService,
    private environmentService: EnvironmentService // ← AJOUTER
  ) {}

  ngOnInit(): void {
    this.lastEnvId = localStorage.getItem('envirotest-last-pipeline-env');
    this.lastDeploymentEnvId = localStorage.getItem('envirotest-last-env-id') || this.lastEnvId;
    
    // ✅ Charger les derniers éléments
    this.loadLatestItems();
    
    this.updateCurrentAppId(this.router.url);
    
    this.router.events.subscribe(ev => {
      if (ev instanceof NavigationEnd) {
        this.updateCurrentAppId(ev.urlAfterRedirects);
        this.lastEnvId = localStorage.getItem('envirotest-last-pipeline-env');
        this.lastDeploymentEnvId = localStorage.getItem('envirotest-last-env-id') || this.lastEnvId;
        this.detectCurrentFilter(ev.urlAfterRedirects);
      }
    });
  }

  loadLatestItems(): void {
    // Récupérer le dernier pipeline (pour affichage éventuel)
    this.pipelineService.getLatestPipeline().subscribe({
      next: latestPipeline => {
        if (latestPipeline) {
          this.lastPipelineId = latestPipeline.id;
          this.lastPipelineEnvId = latestPipeline.environmentId;
          localStorage.setItem('last-pipeline-id', latestPipeline.id);
          localStorage.setItem('last-pipeline-env-id', latestPipeline.environmentId);
        }
      },
      error: () => {
        // Fallback sur la valeur stockée localement
        this.lastPipelineId = localStorage.getItem('last-pipeline-id');
        this.lastPipelineEnvId = localStorage.getItem('last-pipeline-env-id');
      }
    });
    
    // Récupérer le dernier environnement (pour affichage éventuel)
    this.environmentService.getLatestEnvironment().subscribe({
      next: latestEnv => {
        if (latestEnv) {
          this.lastEnvironmentId = latestEnv.id;
          localStorage.setItem('last-environment-id', latestEnv.id);
        }
      },
      error: () => {
        this.lastEnvironmentId = localStorage.getItem('last-environment-id');
      }
    });
  }

  // ✅ UNE SEULE MÉTHODE goToLastPipeline (supprimer l'autre)
  goToLastPipeline(): void {
    // Toujours récupérer dynamiquement le dernier pipeline existant
    this.pipelineService.getLatestPipeline().subscribe({
      next: latest => {
        if (latest && latest.environmentId) {
          const queryParams: any = {};
          if (this.currentAppId) {
            queryParams.appId = this.currentAppId;
          }
          this.router.navigate(['/pipeline', latest.environmentId], { queryParams });
        } else {
          this.goToProjectPipelines();
        }
      },
      error: () => {
        this.goToProjectPipelines();
      }
    });
  }

  goToLastEnvironment(): void {
    // Toujours récupérer dynamiquement le dernier environnement existant
    this.environmentService.getLatestEnvironment().subscribe({
      next: latest => {
        if (latest && latest.id) {
          const queryParams: any = {};
          if (this.currentAppId) {
            queryParams.appId = this.currentAppId;
          }
          this.router.navigate(['/environment', latest.id], { queryParams });
        } else if (this.lastDeploymentEnvId) {
          const queryParams: any = {};
          if (this.currentAppId) {
            queryParams.appId = this.currentAppId;
          }
          this.router.navigate(['/environment', this.lastDeploymentEnvId], { queryParams });
        }
      },
      error: () => {
        if (this.lastDeploymentEnvId) {
          const queryParams: any = {};
          if (this.currentAppId) {
            queryParams.appId = this.currentAppId;
          }
          this.router.navigate(['/environment', this.lastDeploymentEnvId], { queryParams });
        }
      }
    });
  }

  getPipelineCount(): number {
    return this.pipelineCounts.total;
  }

  getSuccessCount(): number {
    return this.pipelineCounts.success;
  }

  getFailedCount(): number {
    return this.pipelineCounts.failed;
  }

  getPendingCount(): number {
    return this.pipelineCounts.pending;
  }

  isOnPipelinePage(): boolean {
    return this.router.url.includes('/pipeline/') || this.router.url.includes('/pipeline-id/');
  }

  private updateCurrentAppId(url: string): void {
    let newId: string | null = null;
    
    const projectMatch = url.match(/\/project\/([^\/]+)/);
    if (projectMatch) {
      newId = projectMatch[1];
    } else {
      const urlParts = url.split('?');
      if (urlParts.length > 1) {
        const queryParams = new URLSearchParams(urlParts[1]);
        const appIdFromQuery = queryParams.get('appId');
        if (appIdFromQuery) {
          newId = decodeURIComponent(appIdFromQuery);
        }
      }
    }
    
    if (newId !== this.currentAppId) {
      this.currentAppId = newId;
      this.currentApp = null;
      if (this.currentAppId) {
        try {
          localStorage.setItem(UserSidebarComponent.LAST_PROJECT_APP_ID_KEY, this.currentAppId);
        } catch {
          /* ignore */
        }
        this.loadCurrentApp();
        this.loadPipelineCounts();
      }
    }
  }

  /** App courante (URL) ou dernière mémorisée pour les liens sidebar. */
  private lastKnownApplicationId(): string | null {
    return this.currentAppId || localStorage.getItem(UserSidebarComponent.LAST_PROJECT_APP_ID_KEY);
  }

  private loadCurrentApp(): void {
    if (!this.currentAppId) return;
    
    this.applicationService.getApplicationById(this.currentAppId).subscribe({
      next: app => { 
        this.currentApp = app; 
        this.project = app;
      },
      error: () => { 
        this.currentApp = null;
        this.project = null;
      }
    });
  }

  navigate(path: string): void {
    this.router.navigate([path]);
  }

  /**
   * Environnement à utiliser pour vulnérabilités / correctifs IA.
   * Priorité : dernier env global (API latest) — cohérent avec les pages qui appellent getLatestEnvironment().
   * Éviter de mettre en premier lastDeploymentEnvId : l’historique des déploiements peut référencer un env plus ancien
   * que le « dernier environnement » réel.
   */
  private preferredSecurityEnvId(): string | null {
    return (
      this.lastEnvironmentId ||
      this.lastPipelineEnvId ||
      this.lastDeploymentEnvId
    );
  }

  /** Même layout que le projet : /project/:appId/vulnerabilities */
  navigateSecurityVulnerabilities(): void {
    const appId = this.lastKnownApplicationId();
    const envId = this.preferredSecurityEnvId();
    const qp = envId ? { envId } : {};
    if (appId) {
      this.router.navigate(['/project', appId, 'vulnerabilities'], { queryParams: qp });
    } else {
      this.router.navigate(['/my-applications']);
    }
  }

  isSecurityVulnerabilitiesRoute(): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return /\/project\/[^/]+\/vulnerabilities(\/[^/]+)?$/.test(path);
  }

  goToProjectOverview(): void {
    const appId = this.lastKnownApplicationId();
    if (appId) {
      this.router.navigate(['/project', appId, 'overview']);
    } else {
      this.router.navigate(['/my-applications']);
    }
  }

  goToProjectPipelines(status?: string): void {
    if (!this.currentAppId) {
      this.router.navigate(['/pipelines'], { 
        queryParams: status ? { status } : {} 
      });
      return;
    }
    
    const queryParams = status ? { status } : {};
    this.router.navigate(
      ['/project', this.currentAppId, 'pipelines'],
      { queryParams }
    );
  }

  logout(): void {
    this.authService.logout();
  }

  goToMonitoring(): void {
    const appId = this.lastKnownApplicationId();
    if (appId) {
      this.router.navigate(['/project', appId, 'monitoring']);
    } else {
      this.router.navigate(['/my-applications']);
    }
  }

  isMonitoringRoute(): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return /\/project\/[^/]+\/monitoring$/.test(path);
  }

  goToSonarqube(): void {
    const appId = this.lastKnownApplicationId();
    if (appId) {
      this.router.navigate(['/project', appId, 'sonarqube']);
    } else {
      this.router.navigate(['/my-applications']);
    }
  }

  isSonarqubeRoute(): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return /\/project\/[^/]+\/sonarqube$/.test(path);
  }

  backToApplications(): void {
    this.router.navigate(['/my-applications']);
  }

  private detectCurrentFilter(url: string): void {
    if (url.includes('status=')) {
      const match = url.match(/status=([^&]*)/);
      if (match) {
        const status = match[1];
        if (status.includes('RUNNING') || status.includes('PENDING')) {
          this.currentDeploymentsFilter = 'En cours';
        } else if (status.includes('SUCCESS')) {
          this.currentDeploymentsFilter = 'Réussis';
        } else if (status.includes('FAILED')) {
          this.currentDeploymentsFilter = 'Échoués';
        }
      }
    } else {
      this.currentDeploymentsFilter = null;
    }
  }

  goToDeployments(type: 'active' | 'history'): void {
    if (!this.currentAppId) {
      if (type === 'active') {
        this.router.navigate(['/deployments'], { 
          queryParams: { status: 'ACTIVE' }
        });
      } else {
        this.router.navigate(['/deployments']);
      }
      return;
    }
    
    if (type === 'active') {
      this.router.navigate(
        ['/project', this.currentAppId, 'deployments'],
        { queryParams: { status: 'ACTIVE' } }
      );
    } else {
      this.router.navigate(['/project', this.currentAppId, 'deployments']);
    }
  }

  isActiveDeploymentsPage(): boolean {
    const url = this.router.url;
    return url.includes('/deployments') && 
           (url.includes('status=RUNNING') || url.includes('status=PENDING'));
  }

  isHistoryDeploymentsPage(): boolean {
    const url = this.router.url;
    return url.includes('/deployments') && !url.includes('status=');
  }

  clearDeploymentsFilter(): void {
    if (this.currentAppId) {
      this.router.navigate(['/project', this.currentAppId, 'deployments']);
    } else {
      this.router.navigate(['/deployments']);
    }
    this.currentDeploymentsFilter = null;
  }

  private updateDeploymentsCounts(): void {
    if (!this.currentAppId) return;
    
    this.applicationService.getDeploymentHistory(this.currentAppId).subscribe({
      next: (deployments) => {
        this.totalDeploymentsCount = deployments.length;
        this.activeDeploymentsCount = deployments.filter(d => 
          d.environmentStatus?.toUpperCase() === 'RUNNING'
        ).length;

        if (deployments.length > 0) {
          const sorted = [...deployments].sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          this.lastDeploymentEnvId = sorted[0]?.environmentId || null;
        }
      }
    });
  }

  private loadPipelineCounts(): void {
    if (!this.currentAppId) return;
    
    this.applicationService.getDeploymentHistory(this.currentAppId).subscribe({
      next: (deployments) => {
        this.pipelineCounts.total = deployments.length;
        this.pipelineCounts.success = deployments.filter(d => 
          d.pipelineStatus?.toUpperCase() === 'SUCCESS').length;
        this.pipelineCounts.failed = deployments.filter(d => 
          ['FAILED', 'CANCELED'].includes(d.pipelineStatus?.toUpperCase() || '')).length;
        this.pipelineCounts.pending = deployments.filter(d => 
          ['PENDING', 'RUNNING'].includes(d.pipelineStatus?.toUpperCase() || '')).length;
        
        this.totalDeploymentsCount = deployments.length;
        this.activeDeploymentsCount = this.pipelineCounts.pending;
        
        if (deployments.length > 0) {
          const sorted = [...deployments].sort((a, b) => 
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          this.lastDeploymentEnvId = sorted[0]?.environmentId || this.lastEnvId;
        }
      }
    });
  }

  // Dans user-sidebar.component.ts
goToActivity(): void {
  const appId = this.lastKnownApplicationId();
  if (appId) {
    this.router.navigate(['/project', appId, 'activity']);
  } else {
    this.router.navigate(['/my-applications']);
  }
}

  goToLastDeployment(): void {
    // Utiliser toujours le dernier environnement retourné par le backend
    this.environmentService.getLatestEnvironment().subscribe({
      next: latest => {
        if (latest && latest.id) {
          const queryParams: any = {};
          if (this.currentAppId) {
            queryParams.appId = this.currentAppId;
          }
          this.router.navigate(['/environment', latest.id], { queryParams });
        } else if (this.lastDeploymentEnvId) {
          const queryParams: any = {};
          if (this.currentAppId) {
            queryParams.appId = this.currentAppId;
          }
          this.router.navigate(['/environment', this.lastDeploymentEnvId], { queryParams });
        }
      },
      error: () => {
        if (this.lastDeploymentEnvId) {
          const queryParams: any = {};
          if (this.currentAppId) {
            queryParams.appId = this.currentAppId;
          }
          this.router.navigate(['/environment', this.lastDeploymentEnvId], { queryParams });
        }
      }
    });
  }

  isEnvironmentActive(envId: string | null): boolean {
    if (!envId || !this.currentAppId) return false;
    return true; // À améliorer
  }

  isOnLastDeploymentPage(): boolean {
    const url = this.router.url;
    return url.includes('/environment/') && 
           this.lastDeploymentEnvId !== null && 
           url.includes(this.lastDeploymentEnvId);
  }
}