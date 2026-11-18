import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  AdminActivityEvent,
  AdminService,
  AdminUserApplicationDetail,
  AdminUserEnvironmentDetail,
  AdminUserMetrics
} from '../../services/admin/admin.service';
import { environmentStatusLabel, pipelineStatusLabel, statusTone } from '../shared/admin-status';
import { platformPreviewUrl } from '../../shared/preview-url.util';

interface EnvRow extends AdminUserEnvironmentDetail {}

interface PipelineSegment {
  label: string;
  count: number;
  pct: number;
  tone: 'ok' | 'crit' | 'warn' | 'neutral';
}

const ROLE_LABELS: Record<string, string> = {
  FRONTEND: 'Frontend',
  BACKEND: 'Backend',
  WORKER: 'Worker'
};

/** Statut live d'un service, apparié au workload K8s de l'environnement actif (cf. §C du plan). */
interface ServiceLiveStatus {
  status: 'RUNNING' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  cpuUsage?: string | null;
  memoryUsage?: string | null;
}

@Component({
  selector: 'app-admin-application-detail',
  templateUrl: './admin-application-detail.component.html',
  styleUrls: ['./admin-application-detail.component.css']
})
export class AdminApplicationDetailComponent implements OnInit {
  loading = true;
  error: string | null = null;

  app: AdminUserApplicationDetail | null = null;
  ownerUsername = '';
  ownerEmail = '';
  accountStatus = '';
  environments: EnvRow[] = [];
  activity: AdminActivityEvent[] = [];
  activityLoading = false;

  serviceStatus = new Map<string, ServiceLiveStatus>();

  /** Aperçu en direct de l'application quand son environnement actif est RUNNING (retour
   * utilisateur du 7 septembre 2026 : disponible sur le détail Environnement, demandé aussi ici). */
  previewUrl: SafeResourceUrl | null = null;
  previewRawUrl: string | null = null;

  /** Une application peut accumuler des dizaines d'environnements : pagination côté client. */
  readonly envPageSize = 8;
  envPage = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private adminService: AdminService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/admin/applications']);
      return;
    }
    this.load(id);
  }

  private load(id: string): void {
    this.loading = true;
    this.error = null;
    this.adminService.getAllUsersWithMetrics().subscribe({
      next: users => {
        const found = this.findApplication(users, id);
        if (!found) {
          this.error = 'Application introuvable.';
          this.loading = false;
          return;
        }
        this.app = found.app;
        this.ownerUsername = found.owner.username;
        this.ownerEmail = found.owner.email;
        this.accountStatus = found.owner.accountStatus;
        this.environments = this.sortEnvironments(
          (found.owner.environments || []).filter(e => e.applicationId === id)
        );
        this.envPage = 0;
        this.loading = false;
        this.loadActivity(id);
        this.loadLiveServiceStatus();
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Chargement impossible.';
      }
    });
  }

  private findApplication(users: AdminUserMetrics[], id: string): { app: AdminUserApplicationDetail; owner: AdminUserMetrics } | null {
    for (const u of users) {
      const app = (u.applications || []).find(a => a.id === id);
      if (app) {
        return { app, owner: u };
      }
    }
    return null;
  }

  private loadActivity(id: string): void {
    this.activityLoading = true;
    this.adminService.getActivity({ applicationId: id, limit: 20 }).subscribe({
      next: events => {
        this.activity = events;
        this.activityLoading = false;
      },
      error: () => {
        this.activityLoading = false;
      }
    });
  }

  /** Statut réel de chaque service, apparié via le nom K8s au workload de l'environnement actif. */
  private loadLiveServiceStatus(): void {
    const active = this.environments.find(e => (e.status || '').toUpperCase() === 'RUNNING' && e.namespace);
    if (!active?.namespace) {
      return;
    }
    this.adminService.getMonitoringNamespaceDetail(active.namespace).subscribe({
      next: detail => {
        const url = detail.appUrl || active.url;
        if (url && this.canEmbedPreview(url)) {
          this.previewRawUrl = url;
          this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(platformPreviewUrl(url) || url);
        }

        const workloads = detail.workloads || [];
        for (const svc of this.app?.services || []) {
          const k8sName = this.k8sName(svc.name);
          const workload = workloads.find(w => w.name === k8sName || w.name.startsWith(k8sName));
          if (workload) {
            this.serviceStatus.set(svc.id, {
              status: workload.healthy ? 'RUNNING' : (workload.ready > 0 ? 'PENDING' : 'FAILED')
            });
          }
        }
        const pods = detail.pods || [];
        for (const svc of this.app?.services || []) {
          const k8sName = this.k8sName(svc.name);
          const pod = pods.find(p => (p.workload || '').startsWith(k8sName));
          if (pod) {
            const existing = this.serviceStatus.get(svc.id) || { status: 'UNKNOWN' as const };
            this.serviceStatus.set(svc.id, { ...existing, cpuUsage: pod.cpuUsage, memoryUsage: pod.memoryUsage });
          }
        }
      },
      error: () => { /* pas de donnée live disponible — la page reste utilisable sans */ }
    });
  }

  private canEmbedPreview(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /** Normalise comme AppNaming.k8sName côté backend (même logique que deployment-status.component.ts). */
  private k8sName(input: string): string {
    if (!input?.trim()) return 'x';
    let s = input.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
    if (!s) s = 'x';
    if (s.length > 50) s = s.slice(0, 50).replace(/-+$/, '');
    return s || 'x';
  }

  liveStatus(serviceId: string): ServiceLiveStatus | null {
    return this.serviceStatus.get(serviceId) || null;
  }

  pipelineSuccess(): number {
    return this.app?.pipelineCounts?.success || 0;
  }

  pipelineTotal(): number {
    const pc = this.app?.pipelineCounts;
    if (!pc) return 0;
    if (pc.total != null) return pc.total;
    return (pc.success || 0) + (pc.failed || 0) + (pc.running || 0) + (pc.pending || 0) + (pc.canceled || 0) + (pc.skipped || 0);
  }

  activeEnvironmentsCount(): number {
    return this.environments.filter(e => (e.status || '').toUpperCase() === 'RUNNING').length;
  }

  openEnvironment(e: EnvRow): void {
    this.router.navigate(['/admin/environments', e.id]);
  }

  statusClass(status: string | null | undefined): string {
    return statusTone(status);
  }

  statusLabel(status: string | null | undefined): string {
    return environmentStatusLabel(status);
  }

  pipelineLabel(status: string | null | undefined): string {
    return pipelineStatusLabel(status);
  }

  get envPageCount(): number {
    return Math.ceil(this.environments.length / this.envPageSize);
  }

  get pagedEnvironments(): EnvRow[] {
    const start = this.envPage * this.envPageSize;
    return this.environments.slice(start, start + this.envPageSize);
  }

  get recentActivity(): AdminActivityEvent[] {
    return this.activity.slice(0, 8);
  }

  successRate(): number {
    const total = this.pipelineTotal();
    return total ? Math.round((this.pipelineSuccess() / total) * 100) : 0;
  }

  /** Répartition des exécutions pour la barre empilée de la carte « Pipelines ». */
  get pipelineSegments(): PipelineSegment[] {
    const pc = this.app?.pipelineCounts;
    const total = this.pipelineTotal();
    if (!pc) return [];
    const seg = (label: string, count: number, tone: PipelineSegment['tone']): PipelineSegment =>
      ({ label, count, tone, pct: total ? (count / total) * 100 : 0 });
    return [
      seg('Réussis', pc.success || 0, 'ok'),
      seg('Échecs', pc.failed || 0, 'crit'),
      seg('En cours', (pc.running || 0) + (pc.pending || 0), 'warn'),
      seg('Annulés', (pc.canceled || 0) + (pc.skipped || 0), 'neutral')
    ];
  }

  roleLabel(role: string | null | undefined): string {
    return role ? ROLE_LABELS[role.toUpperCase()] ?? role : 'Service';
  }

  repoLabel(url: string | null | undefined): string {
    if (!url) return '—';
    return url.replace(/^https?:\/\//, '').replace(/\.git$/, '');
  }

  /** État d'un service : le workload réel si un environnement tourne, sinon « Non déployé ». */
  serviceStateLabel(serviceId: string): string {
    const live = this.liveStatus(serviceId);
    if (live) return environmentStatusLabel(live.status);
    return this.activeEnvironmentsCount() > 0 ? 'Vérification…' : 'Non déployé';
  }

  serviceTone(serviceId: string): string {
    const live = this.liveStatus(serviceId);
    if (live) return statusTone(live.status);
    return this.activeEnvironmentsCount() > 0 ? 'pending' : 'neutral';
  }

  formatDate(value: string | number[] | null | undefined): string {
    const t = this.toTime(value);
    return t ? new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  private sortEnvironments(envs: EnvRow[]): EnvRow[] {
    return [...envs].sort((a, b) => {
      const aRunning = (a.status || '').toUpperCase() === 'RUNNING';
      const bRunning = (b.status || '').toUpperCase() === 'RUNNING';
      if (aRunning !== bRunning) return aRunning ? -1 : 1;
      return this.toTime(b.createdAt) - this.toTime(a.createdAt);
    });
  }

  private toTime(value: string | number[] | null | undefined): number {
    if (!value) return 0;
    if (typeof value === 'string') {
      const t = new Date(value).getTime();
      return isNaN(t) ? 0 : t;
    }
    if (Array.isArray(value) && value.length >= 3) {
      const [y, m, d, h = 0, min = 0, s = 0] = value;
      return new Date(y, m - 1, d, h, min, s).getTime();
    }
    return 0;
  }
}
