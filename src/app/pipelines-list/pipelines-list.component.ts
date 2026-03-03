import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PipelineService } from '../services/pipeline/pipeline.service';
import { PipelineListItem } from '../models/pipeline/pipeline-list-item';
import { ToastService } from '../services/ui/toast.service';
import { ApplicationService } from '../services/application/application.service';
import { DeploymentHistoryItem } from '../models/application/deployment-history-item';
import { EnvironmentService } from '../services/environment/environment.service';

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
  statusFilter: string | null = null;
  filtered: PipelineListItem[] = [];

  appId: string | null = null;
  isProjectContext = false;
  appName: string | null = null;

   deletingId: number | null = null;
  showDeleteConfirm: boolean = false;
  pipelineToDelete: PipelineListItem | null = null;

  constructor(
    private pipelineService: PipelineService,
     private environmentService: EnvironmentService,
    private applicationService: ApplicationService,
    private router: Router,
    private route: ActivatedRoute,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    // Vérifier si on est dans le contexte d'un projet
    this.route.queryParamMap.subscribe(params => {
      this.statusFilter = params.get('status');
      
      // Vérifier si on a un appId dans l'URL parent
      this.appId = this.route.snapshot.paramMap.get('appId');
      
      // Alternative: vérifier via l'URL parent
      const urlSegments = this.router.url.split('/');
      const projectIndex = urlSegments.indexOf('project');
      if (projectIndex > -1 && urlSegments.length > projectIndex + 1) {
        this.appId = urlSegments[projectIndex + 1];
        this.isProjectContext = true;
        
        // Charger le nom de l'application
        if (this.appId) {
          this.applicationService.getApplicationById(this.appId).subscribe({
            next: (app) => {
              this.appName = app.name;
            },
            error: () => {
              this.appName = null;
            }
          });
        }
      }
      
      this.loadPipelines();
    });
    
    setInterval(() => this.refreshPipelinesForNotifications(), 10000);
  }
 
  loadPipelines(): void {
    this.loading = true;
    this.error = null;
    
    this.pipelineService.listPipelines().subscribe({
      next: (list: PipelineListItem[]) => {
        // Filtrer par application si on est dans le contexte d'un projet
        if (this.isProjectContext && this.appId) {
          // Appeler la méthode de filtrage
          this.loadApplicationPipelines(list);
        } else {
          this.pipelines = list;
          this.filtered = this.applyStatusFilter(this.pipelines);
          this.updatePreviousStatuses(this.pipelines);
          this.loading = false;
        }
      },
      error: (err: any) => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement des pipelines';
      }
    });
  }

  // Méthode pour charger les pipelines spécifiques à l'application
  private loadApplicationPipelines(allPipelines: PipelineListItem[]): void {
    if (!this.appId) {
      this.pipelines = allPipelines;
      this.filtered = this.applyStatusFilter(this.pipelines);
      this.updatePreviousStatuses(this.pipelines);
      this.loading = false;
      return;
    }
    
    // Récupérer d'abord les environnements/déploiements de l'application
    this.applicationService.getDeploymentHistory(this.appId, 0, 100).subscribe({
      next: (deployments: DeploymentHistoryItem[]) => {
        // Récupérer tous les environmentIds de l'application
        const appEnvIds = deployments.map((d: DeploymentHistoryItem) => d.environmentId);
        
        // Filtrer les pipelines qui appartiennent à ces environnements
        this.pipelines = allPipelines.filter((pipeline: PipelineListItem) => 
          pipeline.environmentId && appEnvIds.includes(pipeline.environmentId)
        );
        
        this.filtered = this.applyStatusFilter(this.pipelines);
        this.updatePreviousStatuses(this.pipelines);
        this.loading = false;
      },
      error: () => {
        // En cas d'erreur, on garde tous les pipelines
        this.pipelines = allPipelines;
        this.filtered = this.applyStatusFilter(this.pipelines);
        this.updatePreviousStatuses(this.pipelines);
        this.loading = false;
      }
    });
  }

  // Mettre à jour le map des statuts précédents
  private updatePreviousStatuses(pipelines: PipelineListItem[]): void {
    pipelines.forEach((item: PipelineListItem) => {
      if (item.pipelineId != null) {
        this.previousStatuses.set(
          item.pipelineId, 
          (item.status || item.pipelineStatus || '').toUpperCase()
        );
      }
    });
  }

  getPageTitle(): string {
    if (this.isProjectContext && this.appName) {
      return `Pipelines - ${this.appName}`;
    }
    return 'Tous les pipelines';
  }

  getSubtitle(): string {
    if (this.isProjectContext && this.appName) {
      return `Historique des pipelines pour l'application ${this.appName}`;
    }
    return 'Tous les pipelines lancés par votre compte';
  }

  private applyStatusFilter(list: PipelineListItem[]): PipelineListItem[] {
    const s = (this.statusFilter || '').toUpperCase();
    
    // Si pas de filtre ou filtre ALL, retourner tout
    if (!s || s === 'ALL') return list;
    
    // Si le filtre contient une virgule (filtre multiple)
    if (s.includes(',')) {
      const statuses = s.split(',');
      return list.filter((item: PipelineListItem) => {
        const itemStatus = (item.status || item.pipelineStatus || '').toUpperCase();
        return statuses.includes(itemStatus);
      });
    }
    
    // Filtre simple
    if (['SUCCESS', 'FAILED', 'CANCELED', 'PENDING', 'RUNNING'].includes(s)) {
      return list.filter((item: PipelineListItem) => 
        (item.status || item.pipelineStatus || '').toUpperCase() === s
      );
    }
    
    return list;
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

  private refreshPipelinesForNotifications(): void {
    this.pipelineService.listPipelines().subscribe({
      next: (list: PipelineListItem[]) => {
        // Appliquer le même filtre si on est dans le contexte projet
        if (this.isProjectContext && this.appId) {
          // Re-filtrer
          this.applicationService.getDeploymentHistory(this.appId).subscribe({
            next: (deployments: DeploymentHistoryItem[]) => {
              const appEnvIds = deployments.map((d: DeploymentHistoryItem) => d.environmentId);
              const pipelinesToProcess = list.filter((p: PipelineListItem) => 
                p.environmentId && appEnvIds.includes(p.environmentId)
              );
              this.processNotifications(pipelinesToProcess);
            },
            error: () => {
              this.processNotifications(list);
            }
          });
        } else {
          this.processNotifications(list);
        }
      },
      error: () => {
        // silencieux
      }
    });
  }
  
  private processNotifications(list: PipelineListItem[]): void {
    list.forEach((item: PipelineListItem) => {
      if (!item.pipelineId) {
        return;
      }
      const id = item.pipelineId;
      const newStatus = (item.status || item.pipelineStatus || '').toUpperCase();
      const oldStatus = this.previousStatuses.get(id);
      
      // Notification quand le pipeline change de statut
      if (oldStatus && (oldStatus === 'RUNNING' || oldStatus === 'PENDING')
          && (newStatus === 'SUCCESS' || newStatus === 'FAILED' || newStatus === 'CANCELED')) {
        const type = newStatus === 'SUCCESS' ? 'success' : 'error';
        const title = newStatus === 'SUCCESS' ? 'Déploiement réussi' : 'Déploiement terminé';
        const msg = `Pipeline #${id} pour ${item.environmentName} est maintenant ${newStatus}.`;
        this.toastService.push(type, title, msg);
      }
      
      this.previousStatuses.set(id, newStatus);
    });
    
    // Mettre à jour la liste avec le filtre actuel
    this.pipelines = list;
    this.filtered = this.applyStatusFilter(list);
  }
   confirmDelete(item: PipelineListItem): void {
    this.pipelineToDelete = item;
    this.showDeleteConfirm = true;
  }

// Dans pipelines-list.component.ts - Après suppression
// Dans pipelines-list.component.ts - après suppression
deletePipeline(): void {
  if (!this.pipelineToDelete?.pipelineId || this.deletingId != null) return;
  
  this.deletingId = this.pipelineToDelete.pipelineId;
  this.showDeleteConfirm = false;
  
  this.pipelineService.deletePipeline(this.pipelineToDelete.pipelineId).subscribe({
    next: () => {
      this.deletingId = null;
      
      // ✅ Recalculer le dernier élément
      this.pipelineService.getLatestPipeline().subscribe(latest => {
        if (latest) {
          localStorage.setItem('last-pipeline-id', latest.id);
          localStorage.setItem('last-pipeline-env-id', latest.environmentId);
        }
      });
      
      this.environmentService.getLatestEnvironment().subscribe(latest => {
        if (latest) {
          localStorage.setItem('last-environment-id', latest.id);
        }
      });
      
      this.toastService.push('success', 'Pipeline supprimé', 
        `Pipeline #${this.pipelineToDelete?.pipelineId} supprimé`);
      
      this.pipelineToDelete = null;
      this.loadPipelines();
    },
    error: (err) => {
      this.deletingId = null;
      this.pipelineToDelete = null;
      this.toastService.push('error', 'Erreur', 'Impossible de supprimer le pipeline');
    }
  });
}

private recalculateLastDeployment(): void {
  if (!this.appId) return;
  
  // Récupérer le dernier déploiement depuis l'API
  this.applicationService.getDeploymentHistory(this.appId, 0, 1).subscribe({
    next: (deployments) => {
      if (deployments.length > 0) {
        const newLast = deployments[0];
        localStorage.setItem('envirotest-last-env-id', newLast.environmentId);
        console.log('✅ Nouveau dernier déploiement stocké:', newLast.environmentId);
      } else {
        // Plus aucun déploiement
        localStorage.removeItem('envirotest-last-env-id');
        localStorage.removeItem('envirotest-last-app-id');
        console.log('ℹ️ Plus aucun déploiement');
      }
    },
    error: (err) => {
      console.error('Erreur recalcul dernier déploiement:', err);
    }
  });
}

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.pipelineToDelete = null;
  }

  showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  // Utiliser votre ToastService existant
  this.toastService.push(type, type === 'success' ? 'Succès' : 'Information', message);
}


  
}