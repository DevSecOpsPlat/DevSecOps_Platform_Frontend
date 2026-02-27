import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PipelineService } from '../services/pipeline/pipeline.service';
import { PipelineListItem } from '../models/pipeline/pipeline-list-item';
import { ToastService } from '../services/ui/toast.service';
import { ApplicationService } from '../services/application/application.service';

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

  constructor(
    private pipelineService: PipelineService,
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
      next: (list) => {
        // Filtrer par application si on est dans le contexte d'un projet
        if (this.isProjectContext && this.appId) {
          // ICI LA MAGIE : On filtre les pipelines pour ne garder que ceux de l'application courante
          // Note: Il faut que votre API retourne l'applicationId ou que vous ayez un moyen de lier
          this.pipelines = list.filter(item => {
            // Option 1: Si votre PipelineListItem a un champ applicationId
            // return item.applicationId === this.appId;
            
            // Option 2: Sinon, on doit charger les déploiements de l'application
            // et ne garder que les pipelines qui correspondent aux environmentId de l'app
            this.loadApplicationPipelines(list);
            return true; // Temporaire, sera remplacé par la méthode ci-dessus
          });
        } else {
          this.pipelines = list;
        }
        
        this.filtered = this.applyStatusFilter(this.pipelines);
        this.pipelines.forEach(item => {
          if (item.pipelineId != null) {
            this.previousStatuses.set(item.pipelineId, (item.status || item.pipelineStatus || '').toUpperCase());
          }
        });
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement des pipelines';
      }
    });
  }
    // Méthode pour charger les pipelines spécifiques à l'application
  private loadApplicationPipelines(allPipelines: PipelineListItem[]): void {
    if (!this.appId) return;
    
    // Récupérer d'abord les environnements/déploiements de l'application
    this.applicationService.getDeploymentHistory(this.appId).subscribe({
      next: (deployments) => {
        // Récupérer tous les environmentIds de l'application
        const appEnvIds = deployments.map(d => d.environmentId);
        
        // Filtrer les pipelines qui appartiennent à ces environnements
        this.pipelines = allPipelines.filter(pipeline => 
          pipeline.environmentId && appEnvIds.includes(pipeline.environmentId)
        );
        
        this.filtered = this.applyStatusFilter(this.pipelines);
      },
      error: () => {
        // En cas d'erreur, on garde tous les pipelines
        this.pipelines = allPipelines;
        this.filtered = this.applyStatusFilter(this.pipelines);
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
    return list.filter(item => {
      const itemStatus = (item.status || item.pipelineStatus || '').toUpperCase();
      return statuses.includes(itemStatus);
    });
  }
  
  // Filtre simple
  if (['SUCCESS', 'FAILED', 'CANCELED', 'PENDING', 'RUNNING'].includes(s)) {
    return list.filter(item => (item.status || item.pipelineStatus || '').toUpperCase() === s);
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
      next: (list) => {
        // Appliquer le même filtre si on est dans le contexte projet
        let pipelinesToProcess = list;
        
        if (this.isProjectContext && this.appId) {
          // Re-filtrer
          this.applicationService.getDeploymentHistory(this.appId).subscribe({
            next: (deployments) => {
              const appEnvIds = deployments.map(d => d.environmentId);
              pipelinesToProcess = list.filter(p => 
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
  list.forEach(item => {
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
}
