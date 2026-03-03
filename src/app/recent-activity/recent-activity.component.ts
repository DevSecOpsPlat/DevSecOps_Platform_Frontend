// recent-activity-page.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { PipelineService } from '../services/pipeline/pipeline.service';
import { ApplicationService } from '../services/application/application.service';
import { EnvironmentService } from '../services/environment/environment.service';
import { FormatService } from '../models/environment/format.service';
import { ActivityItem } from '../models/ActivityItem';

@Component({
  selector: 'app-recent-activity-',
  templateUrl: './recent-activity.component.html',
  styleUrls: ['./recent-activity.component.css']
})
export class RecentActivityComponent implements OnInit {
  appId: string | null = null;
  appName: string = '';
  activities: ActivityItem[] = [];
  loading = true;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    public router: Router,
    private applicationService: ApplicationService,
    private pipelineService: PipelineService,
    private environmentService: EnvironmentService,
    public format: FormatService
  ) {}

  ngOnInit(): void {
    // appId est sur la route parente (project/:appId), pas sur l'enfant (activity)
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') ?? this.route.snapshot.paramMap.get('appId');
    if (this.appId) {
      this.loadActivityData();
    } else {
      this.error = 'ID d\'application invalide';
      this.loading = false;
    }
  }

  loadActivityData(): void {
    const appId = this.appId ?? this.route.parent?.snapshot.paramMap.get('appId') ?? this.route.snapshot.paramMap.get('appId');
    if (!appId) {
      this.error = 'ID d\'application invalide';
      this.loading = false;
      return;
    }
    this.appId = appId;
    this.loading = true;
    this.error = null;

    forkJoin({
      appInfo: this.applicationService.getApplicationById(appId),
      deployments: this.applicationService.getDeploymentHistory(appId, 0, 20),
      pipelines: this.pipelineService.listPipelines(0, 20)
    }).subscribe({
      next: (data) => {
        this.appName = data.appInfo.name;
        this.buildActivities(data.deployments, data.pipelines);
        this.loading = false;
      },
      error: (err) => {
        console.error('Erreur chargement activités:', err);
        this.error = 'Erreur lors du chargement des activités';
        this.loading = false;
      }
    });
  }

  private buildActivities(deployments: any[], pipelines: any[]): void {
    const activities: ActivityItem[] = [];

    // Ajouter les déploiements
    deployments.forEach(d => {
      activities.push({
        id: d.environmentId,
        type: 'deployment',
        title: 'Nouveau déploiement',
        description: `Environnement ${d.environmentName} créé`,
        timestamp: d.createdAt,
        status: d.pipelineStatus || 'UNKNOWN',
        icon: this.getStatusIcon(d.pipelineStatus),
        link: `/pipeline/${d.environmentId}?appId=${this.appId}`,
        metadata: {
          branch: d.gitBranch,
          environment: d.environmentName,
          triggeredBy: d.triggeredByUsername
        }
      });
    });

    // Ajouter les pipelines
    pipelines.forEach(p => {
      activities.push({
        id: String(p.pipelineId || ''),
        type: 'pipeline',
        title: 'Pipeline exécuté',
        description: `Pipeline #${p.pipelineId} pour ${p.environmentName}`,
        timestamp: p.createdAt,
        status: p.status || p.pipelineStatus,
        icon: '⚙️',
        link: `/pipeline/${p.environmentId}?appId=${this.appId}`,
        metadata: {
          branch: p.gitBranch,
          environment: p.environmentName,
          triggeredBy: p.createdByUsername,
          duration: p.duration
        }
      });
    });

    // Trier par date (plus récent d'abord) - utiliser une méthode de parsing directe
    this.activities = activities
      .sort((a, b) => {
        const dateA = this.parseDate(a.timestamp)?.getTime() || 0;
        const dateB = this.parseDate(b.timestamp)?.getTime() || 0;
        return dateB - dateA;
      });
  }

  // Méthode de parsing de date locale (sans utiliser FormatService)
  private parseDate(dateValue: any): Date | null {
    if (!dateValue) return null;
    
    try {
      if (typeof dateValue === 'string') {
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? null : date;
      }
      if (typeof dateValue === 'number') {
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? null : date;
      }
      if (Array.isArray(dateValue) && dateValue.length >= 3) {
        const [year, month, day, hour = 0, minute = 0, second = 0] = dateValue;
        const date = new Date(year, month - 1, day, hour, minute, second);
        return isNaN(date.getTime()) ? null : date;
      }
      return null;
    } catch {
      return null;
    }
  }

  private getStatusIcon(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return '✅';
    if (s === 'FAILED') return '❌';
    if (s === 'CANCELED') return '⛔';
    if (s === 'RUNNING') return '🔄';
    if (s === 'PENDING') return '⏳';
    return '•';
  }

  getStatusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status-success';
    if (s === 'FAILED') return 'status-failed';
    if (s === 'CANCELED') return 'status-canceled';
    if (s === 'RUNNING') return 'status-running';
    if (s === 'PENDING') return 'status-pending';
    return 'status-unknown';
  }

  getTimeAgo(timestamp: any): string {
    const date = this.parseDate(timestamp);
    if (!date) return '—';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 30) return 'À l\'instant';
    if (diffSec < 60) return `Il y a ${diffSec} secondes`;
    
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Il y a ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
    
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `Il y a ${diffHour} heure${diffHour > 1 ? 's' : ''}`;
    
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `Il y a ${diffDay} jour${diffDay > 1 ? 's' : ''}`;
    
    return date.toLocaleDateString('fr-FR');
  }

  getFullDate(timestamp: any): string {
    const date = this.parseDate(timestamp);
    if (!date) return 'Date inconnue';
    
    return date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '—';
    
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) {
      const min = Math.floor(seconds / 60);
      const sec = seconds % 60;
      return `${min}m ${sec}s`;
    }
    const hour = Math.floor(seconds / 3600);
    const min = Math.floor((seconds % 3600) / 60);
    return `${hour}h ${min}m`;
  }

  goBack(): void {
    if (this.appId) {
      this.router.navigate(['/project', this.appId, 'overview']);
    } else {
      this.router.navigate(['/home']);
    }
  }

  refresh(): void {
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') ?? this.route.snapshot.paramMap.get('appId');
    if (this.appId) {
      this.loadActivityData();
    }
  }

  navigateToActivity(activity: ActivityItem): void {
  try {
    if (activity.link) {
      this.router.navigateByUrl(activity.link);
      return;
    }
    
    // Fallback par défaut
    if (activity.id) {
      switch (activity.type) {
        case 'deployment':
        case 'pipeline':
          this.router.navigate(['/pipeline', activity.id], {
            queryParams: { appId: this.appId }
          });
          break;
        case 'environment':
          this.router.navigate(['/environment', activity.id], {
            queryParams: { appId: this.appId }
          });
          break;
        default:
          console.warn('Type d\'activité inconnu:', activity.type);
      }
    }
  } catch (error) {
    console.error('Erreur de navigation:', error);
  }
}


}