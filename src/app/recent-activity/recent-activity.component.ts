import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of, Subject } from 'rxjs';
import { takeUntil, catchError, finalize } from 'rxjs/operators';
import { PipelineService } from '../services/pipeline/pipeline.service';
import { ApplicationService } from '../services/application/application.service';
import { FormatService } from '../models/environment/format.service';
import { ActivityItem } from '../models/ActivityItem';

@Component({
  selector: 'app-recent-activity',
  templateUrl: './recent-activity.component.html',
  styleUrls: ['./recent-activity.component.css']
})
export class RecentActivityComponent implements OnInit, OnDestroy {
  appId: string | null = null;
  appName: string = '';
  activities: ActivityItem[] = [];
  filteredActivities: ActivityItem[] = [];
  loading = true;
  error: string | null = null;
  activeFilter: 'all' | 'deployment' | 'pipeline' = 'all';
  
  // Pagination
  currentPage: number = 0;
  pageSize: number = 10;
  allActivities: ActivityItem[] = [];
  hasMore: boolean = true;
  
  private destroy$ = new Subject<void>();
  private cache = new Map<string, { data: ActivityItem[]; timestamp: number }>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor(
    private route: ActivatedRoute,
    public router: Router,
    private applicationService: ApplicationService,
    private pipelineService: PipelineService,
    public format: FormatService
  ) {}

  ngOnInit(): void {
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') ?? 
                 this.route.snapshot.paramMap.get('appId');
    
    if (this.appId) {
      this.loadActivityData();
    } else {
      this.error = 'ID d\'application invalide';
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Charge les données d'activité avec cache
   */
  loadActivityData(forceRefresh = false): void {
    const appId = this.appId;
    if (!appId) {
      this.error = 'ID d\'application invalide';
      this.loading = false;
      return;
    }

    // Vérifier le cache
    const cacheKey = `activity-${appId}`;
    const cached = this.cache.get(cacheKey);
    
    if (!forceRefresh && cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      console.log('📦 Utilisation du cache pour les activités');
      this.allActivities = cached.data;
      this.initializeActivities();
      this.loading = false;
      return;
    }

    this.loading = true;
    this.error = null;

    forkJoin({
      appInfo: this.applicationService.getApplicationById(appId).pipe(
        catchError(err => {
          console.error('Erreur chargement application:', err);
          return of(null);
        })
      ),
      deployments: this.applicationService.getDeploymentHistory(appId, 0, 20).pipe(
        catchError(err => {
          console.error('Erreur chargement déploiements:', err);
          return of([]);
        })
      ),
      pipelines: this.pipelineService.listPipelines(0, 20).pipe(
        catchError(err => {
          console.error('Erreur chargement pipelines:', err);
          return of([]);
        })
      )
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => this.loading = false)
    ).subscribe({
      next: (data) => {
        if (data.appInfo) {
          this.appName = data.appInfo.name;
        }
        
        this.buildActivities(data.deployments || [], data.pipelines || []);
        
        // Mettre en cache
        this.cache.set(cacheKey, {
          data: this.allActivities,
          timestamp: Date.now()
        });
        
        console.log('✅ Activités chargées et mises en cache');
      },
      error: (err) => {
        console.error('Erreur chargement activités:', err);
        this.error = 'Erreur lors du chargement des activités';
      }
    });
  }

  /**
   * Construit la liste complète des activités
   */
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

    // Trier par date (plus récent d'abord)
    this.allActivities = activities.sort((a, b) => {
      const dateA = this.parseDate(a.timestamp)?.getTime() || 0;
      const dateB = this.parseDate(b.timestamp)?.getTime() || 0;
      return dateB - dateA;
    });

    this.initializeActivities();
  }

  /**
   * Initialise l'affichage avec la première page
   */
  private initializeActivities(): void {
    this.currentPage = 0;
    this.hasMore = this.allActivities.length > this.pageSize;
    this.activities = this.allActivities.slice(0, this.pageSize);
    this.applyFilter();
  }

  /**
   * Applique le filtre actif
   */
  applyFilter(filter?: 'all' | 'deployment' | 'pipeline'): void {
    if (filter) {
      this.activeFilter = filter;
      this.currentPage = 0; // Reset à la première page quand on change de filtre
    }

    // Filtrer toutes les activités
    const filtered = this.activeFilter === 'all' 
      ? this.allActivities 
      : this.allActivities.filter(a => a.type === this.activeFilter);
    
    // Appliquer la pagination
    this.activities = filtered.slice(0, this.pageSize);
    this.filteredActivities = this.activities;
    this.hasMore = filtered.length > this.pageSize;
  }

  /**
   * Charge plus d'activités (pagination)
   */
  loadMore(): void {
    if (!this.hasMore || this.loading) return;
    
    this.loading = true;
    this.currentPage++;
    
    // Simuler un délai pour l'UX
    setTimeout(() => {
      const filtered = this.activeFilter === 'all' 
        ? this.allActivities 
        : this.allActivities.filter(a => a.type === this.activeFilter);
      
      const start = this.currentPage * this.pageSize;
      const end = start + this.pageSize;
      const moreActivities = filtered.slice(start, end);
      
      if (moreActivities.length > 0) {
        this.activities = [...this.activities, ...moreActivities];
        this.filteredActivities = this.activities;
      }
      
      this.hasMore = end < filtered.length;
      this.loading = false;
    }, 300);
  }

  /**
   * Parse une date depuis différents formats
   */
  private parseDate(dateValue: any): Date | null {
    if (!dateValue) return null;
    
    try {
      if (typeof dateValue === 'string' || typeof dateValue === 'number') {
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

  /**
   * Retourne l'icône selon le statut
   */
  private getStatusIcon(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return '✅';
    if (s === 'FAILED') return '❌';
    if (s === 'CANCELED') return '⛔';
    if (s === 'RUNNING') return '🔄';
    if (s === 'PENDING') return '⏳';
    return '•';
  }

  /**
   * Retourne la classe CSS pour le statut
   */
  getStatusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status-success';
    if (s === 'FAILED') return 'status-failed';
    if (s === 'CANCELED') return 'status-canceled';
    if (s === 'RUNNING') return 'status-running';
    if (s === 'PENDING') return 'status-pending';
    return 'status-unknown';
  }

  /**
   * Formate une date en "il y a X temps"
   */
  getTimeAgo(timestamp: any): string {
    const date = this.parseDate(timestamp);
    if (!date) return '—';
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 30) return 'À l\'instant';
    if (diffSec < 60) return `Il y a ${diffSec} secondes`;
    
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `Il y a ${diffMin} minute${diffMin > 1 ? 's' : ''}`;
    }
    
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) {
      return `Il y a ${diffHour} heure${diffHour > 1 ? 's' : ''}`;
    }
    
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) {
      return `Il y a ${diffDay} jour${diffDay > 1 ? 's' : ''}`;
    }
    
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  /**
   * Retourne la date complète formatée
   */
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

  /**
   * Formate une durée en secondes
   */
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

  /**
   * Retourne à la page précédente
   */
  goBack(): void {
    if (this.appId) {
      this.router.navigate(['/project', this.appId, 'overview']);
    } else {
      this.router.navigate(['/home']);
    }
  }

  /**
   * Rafraîchit les données
   */
  refresh(): void {
    this.loadActivityData(true);
  }

  /**
   * Navigue vers le détail d'une activité
   */
  navigateToActivity(activity: ActivityItem): void {
    if (activity.link) {
      this.router.navigateByUrl(activity.link);
      return;
    }
    
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
      }
    }
  }

  /**
   * Retourne le compteur pour chaque type
   */
  getCountByType(type: 'deployment' | 'pipeline'): number {
    return this.allActivities.filter(a => a.type === type).length;
  }
}