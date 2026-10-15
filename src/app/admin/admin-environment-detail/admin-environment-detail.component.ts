import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  AdminActivityEvent,
  AdminAppServiceSummary,
  AdminService,
  AdminUserEnvironmentDetail,
  AdminUserMetrics
} from '../../services/admin/admin.service';
import { DeploymentMonitoringResponse, DeploymentPodInfo, MonitoringWorkload } from '../../models/application-management/application-management.models';

interface ServiceRow extends AdminAppServiceSummary {
  live?: { healthy: boolean; ready: number; desired: number };
  pod?: DeploymentPodInfo;
}

@Component({
  selector: 'app-admin-environment-detail',
  templateUrl: './admin-environment-detail.component.html',
  styleUrls: ['../admin-design-system.css', './admin-environment-detail.component.css']
})
export class AdminEnvironmentDetailComponent implements OnInit {
  loading = true;
  error: string | null = null;

  env: AdminUserEnvironmentDetail | null = null;
  ownerUsername = '';
  ownerEmail = '';
  services: ServiceRow[] = [];

  monitoring: DeploymentMonitoringResponse | null = null;
  monitoringLoading = false;
  previewUrl: SafeResourceUrl | null = null;

  activity: AdminActivityEvent[] = [];
  activityLoading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private adminService: AdminService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/admin/environments']);
      return;
    }
    this.load(id);
  }

  private load(id: string): void {
    this.loading = true;
    this.error = null;
    this.adminService.getAllUsersWithMetrics().subscribe({
      next: users => {
        const found = this.findEnvironment(users, id);
        if (!found) {
          this.error = 'Environnement introuvable.';
          this.loading = false;
          return;
        }
        this.env = found.env;
        this.ownerUsername = found.owner.username;
        this.ownerEmail = found.owner.email;
        const app = (found.owner.applications || []).find(a => a.id === found.env.applicationId);
        this.services = (app?.services || []).map(s => ({ ...s }));
        this.loading = false;

        if (this.env.namespace) {
          this.loadMonitoring(this.env.namespace);
        }
        this.loadActivity(id);
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Chargement impossible.';
      }
    });
  }

  private findEnvironment(users: AdminUserMetrics[], id: string): { env: AdminUserEnvironmentDetail; owner: AdminUserMetrics } | null {
    for (const u of users) {
      const env = (u.environments || []).find(e => e.id === id);
      if (env) {
        return { env, owner: u };
      }
    }
    return null;
  }

  private loadMonitoring(namespace: string): void {
    this.monitoringLoading = true;
    this.adminService.getMonitoringNamespaceDetail(namespace).subscribe({
      next: detail => {
        this.monitoring = detail;
        this.monitoringLoading = false;
        this.pairServicesWithLiveData(detail);
        const url = detail.appUrl || this.env?.url;
        if (url && this.canEmbedPreview(url)) {
          this.previewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        }
      },
      error: () => {
        this.monitoringLoading = false;
      }
    });
  }

  private pairServicesWithLiveData(detail: DeploymentMonitoringResponse): void {
    const workloads: MonitoringWorkload[] = detail.workloads || [];
    const pods: DeploymentPodInfo[] = detail.pods || [];
    this.services = this.services.map(s => {
      const k8sName = this.k8sName(s.name);
      const workload = workloads.find(w => w.name === k8sName || w.name.startsWith(k8sName));
      const pod = pods.find(p => (p.workload || '').startsWith(k8sName));
      return {
        ...s,
        live: workload ? { healthy: workload.healthy, ready: workload.ready, desired: workload.desired } : undefined,
        pod
      };
    });
  }

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

  private canEmbedPreview(url: string): boolean {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private loadActivity(id: string): void {
    this.activityLoading = true;
    this.adminService.getActivity({ environmentId: id, limit: 20 }).subscribe({
      next: events => {
        this.activity = events;
        this.activityLoading = false;
      },
      error: () => {
        this.activityLoading = false;
      }
    });
  }

  serviceStatusLabel(s: ServiceRow): string {
    if (!s.live) return 'UNKNOWN';
    if (s.live.healthy) return 'RUNNING';
    if (s.live.ready > 0) return 'PENDING';
    return 'FAILED';
  }

  statusClass(status: string | null | undefined): string {
    return (status || '').toLowerCase();
  }

  copyUrl(): void {
    const url = this.monitoring?.appUrl || this.env?.url;
    if (url) {
      navigator.clipboard?.writeText(url).catch(() => {});
    }
  }

  openApplication(): void {
    if (this.env) {
      this.router.navigate(['/admin/applications', this.env.applicationId]);
    }
  }

  age(value: string | number[] | null | undefined): string {
    const t = this.toTime(value);
    if (!t) return '—';
    const seconds = Math.floor((Date.now() - t) / 1000);
    if (seconds < 3600) return Math.max(1, Math.floor(seconds / 60)) + ' min';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' h';
    return Math.floor(seconds / 86400) + ' j';
  }

  formatDate(value: string | number[] | null | undefined): string {
    const t = this.toTime(value);
    if (!t) return '—';
    return new Date(t).toLocaleString('fr-FR');
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
