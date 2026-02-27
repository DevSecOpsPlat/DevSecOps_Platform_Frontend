import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';
import { ApplicationService } from '../../services/application/application.service';
import { ApplicationResponse } from 'src/app/models/application/application-response';
import { PipelineService } from 'src/app/services/pipeline/pipeline.service';

@Component({
  selector: 'app-user-sidebar',
  templateUrl: './user-sidebar.component.html',
  styleUrls: ['./user-sidebar.component.css']
})
export class UserSidebarComponent implements OnInit {
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

  constructor(
    public authService: AuthService,
    private router: Router,
    private applicationService: ApplicationService,
     private pipelineService: PipelineService
  ) {}

  ngOnInit(): void {
  this.lastEnvId = localStorage.getItem('envirotest-last-pipeline-env');

  this.updateCurrentAppId(this.router.url);

  this.lastDeploymentEnvId = localStorage.getItem('envirotest-last-env-id') || this.lastEnvId;
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
  return this.router.url.includes('/pipeline/');
}
  private updateCurrentAppId(url: string): void {
    let newId: string | null = null;
    
    // 1) cas /project/:appId/...
    const projectMatch = url.match(/\/project\/([^\/]+)/);
    if (projectMatch) {
      newId = projectMatch[1];
    } 
    // 2) cas /pipeline/:envId?appId=...
    else {
      // Extraire les query params de l'URL complète
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
        this.loadCurrentApp();
        this.loadPipelineCounts();
      }
    }
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

  goToProjectOverview(): void {
    if (this.currentAppId) {
      this.router.navigate(['/project', this.currentAppId, 'overview']);
    } else {
      this.navigate('/home');
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
  goToLastPipeline(): void {
    const envId = this.lastEnvId || localStorage.getItem('envirotest-last-pipeline-env');
    if (envId) {
      // IMPORTANT: Si on a un currentAppId, on le passe en queryParam
      const queryParams: any = {};
      if (this.currentAppId) {
        queryParams.appId = this.currentAppId;
      }
      
      this.router.navigate(['/pipeline', envId], { queryParams });
    } else {
      // Si pas de dernier pipeline, rediriger vers la liste
      this.goToProjectPipelines();
    }
  }

  logout(): void {
    this.authService.logout();
  }
  openGrafana(): void {
    // Logique pour ouvrir Grafana
    window.open('https://grafana.example.com', '_blank');
  }

  backToApplications(): void {
    this.router.navigate(['/my-applications']);
  }

  // Détecter le filtre actuel dans l'URL
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
        queryParams: { status: 'ACTIVE' } // Filtrer par environnement RUNNING
      });
    } else {
      this.router.navigate(['/deployments']);
    }
    return;
  }
  
  if (type === 'active') {
    this.router.navigate(
      ['/project', this.currentAppId, 'deployments'],
      { queryParams: { status: 'ACTIVE' } } // ← Changé !
    );
  } else {
    this.router.navigate(['/project', this.currentAppId, 'deployments']);
  }
}

// Vérifier si on est sur la page des déploiements actifs
isActiveDeploymentsPage(): boolean {
  const url = this.router.url;
  return url.includes('/deployments') && 
         (url.includes('status=RUNNING') || url.includes('status=PENDING'));
}

// Vérifier si on est sur la page d'historique
isHistoryDeploymentsPage(): boolean {
  const url = this.router.url;
  return url.includes('/deployments') && !url.includes('status=');
}

// Effacer le filtre actuel
clearDeploymentsFilter(): void {
  if (this.currentAppId) {
    this.router.navigate(['/project', this.currentAppId, 'deployments']);
  } else {
    this.router.navigate(['/deployments']);
  }
  this.currentDeploymentsFilter = null;
}

// Mettre à jour les compteurs de déploiements
private updateDeploymentsCounts(): void {
  if (!this.currentAppId) return;
  
  this.applicationService.getDeploymentHistory(this.currentAppId).subscribe({
    next: (deployments) => {
      this.totalDeploymentsCount = deployments.length;
      
      // Compter les environnements RUNNING (actifs)
      this.activeDeploymentsCount = deployments.filter(d => 
        d.environmentStatus?.toUpperCase() === 'RUNNING'
      ).length;

      // Dernier déploiement
      if (deployments.length > 0) {
        const sorted = [...deployments].sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        this.lastDeploymentEnvId = sorted[0]?.environmentId || null;
      }
    }
  });
}

// Surcharger loadPipelineCounts pour aussi charger les compteurs de déploiements
private loadPipelineCounts(): void {
  if (!this.currentAppId) return;
  
  this.applicationService.getDeploymentHistory(this.currentAppId).subscribe({
    next: (deployments) => {
      // Compteurs pipelines (pour la section pipelines)
      this.pipelineCounts.total = deployments.length;
      this.pipelineCounts.success = deployments.filter(d => 
        d.pipelineStatus?.toUpperCase() === 'SUCCESS').length;
      this.pipelineCounts.failed = deployments.filter(d => 
        ['FAILED', 'CANCELED'].includes(d.pipelineStatus?.toUpperCase() || '')).length;
      this.pipelineCounts.pending = deployments.filter(d => 
        ['PENDING', 'RUNNING'].includes(d.pipelineStatus?.toUpperCase() || '')).length;
      
      // Compteurs déploiements (pour la section déploiements)
      this.totalDeploymentsCount = deployments.length;
      this.activeDeploymentsCount = this.pipelineCounts.pending;
      
      // Dernier déploiement
      if (deployments.length > 0) {
        const sorted = [...deployments].sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        this.lastDeploymentEnvId = sorted[0]?.environmentId || this.lastEnvId;
      }
    }
  });
}

// Remplacer la méthode goToLastDeployment()
goToLastDeployment(): void {
  const envId = this.lastDeploymentEnvId;
  if (envId) {
    const queryParams: any = {};
    if (this.currentAppId) {
      queryParams.appId = this.currentAppId;
    }
    // CORRECTION: Naviguer vers l'environnement, pas vers le pipeline
    this.router.navigate(['/environment', envId], { queryParams });
  }
}
// Dans UserSidebarComponent
isEnvironmentActive(envId: string | null): boolean {
  if (!envId || !this.currentAppId) return false;

  // Vous pouvez soit avoir stocké le statut, soit faire un appel API
  // Pour l'instant, on retourne true si c'est le dernier déploiement
  // Idéalement, il faudrait stocker le statut dans le localStorage aussi
  return true; // À améliorer selon votre besoin
}

// Vérifier si on est sur la page du dernier déploiement (environnement)
isOnLastDeploymentPage(): boolean {
  const url = this.router.url;
  return url.includes('/environment/') && 
         this.lastDeploymentEnvId !== null && 
         url.includes(this.lastDeploymentEnvId);
}


}

