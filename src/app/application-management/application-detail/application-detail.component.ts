import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import {
  AppDatabaseModel,
  AppServiceModel,
  ManagedApp
} from '../../models/application-management/application-management.models';
import { ServiceFormComponent } from '../service-form/service-form.component';
import { DatabaseFormComponent } from '../database-form/database-form.component';
import { DeployRunModalComponent, DeployRunParams } from '../deploy-run-modal/deploy-run-modal.component';

interface ServiceStats {
  deploys: number;
  scans: number;
  lastScan?: string | number[] | null;
}

@Component({
  selector: 'app-managed-application-detail',
  standalone: true,
  imports: [CommonModule, ServiceFormComponent, DatabaseFormComponent, DeployRunModalComponent],
  templateUrl: './application-detail.component.html',
  styleUrls: ['../shared/app-management.shared.css', './application-detail.component.css']
})
export class ApplicationDetailComponent implements OnInit {
  appId!: string;
  app: ManagedApp | null = null;
  loading = true;
  error: string | null = null;
  activeTab: 'services' | 'databases' = 'services';

  showServiceForm = false;
  editingService: AppServiceModel | null = null;
  showDatabaseForm = false;
  editingDatabase: AppDatabaseModel | null = null;

  saving = false;
  formError: string | null = null;

  serviceStats: Record<string, ServiceStats> = {};

  serviceActionTarget: AppServiceModel | null = null;
  serviceActionKind: 'scan' | 'deploy' | null = null;
  serviceActionRunning = false;
  serviceActionError: string | null = null;

  constructor(
    private api: ApplicationManagementService,
    private pipelineService: PipelineService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.appId = this.route.snapshot.paramMap.get('id')!;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get(this.appId).subscribe({
      next: (app) => {
        this.app = app;
        this.loading = false;
        this.loadServiceStats();
      },
      error: () => {
        this.error = 'Application introuvable.';
        this.loading = false;
      }
    });
  }

  private loadServiceStats(): void {
    const services = (this.app?.services ?? []).filter(s => !!s.id);
    if (!services.length) {
      this.serviceStats = {};
      return;
    }

    const requests = services.map(s => forkJoin({
      serviceId: of(s.id!),
      deploys: this.pipelineService.listPipelines(0, 200, s.id!, 'DEPLOY').pipe(
        map(list => list.length),
        catchError(() => of(0))
      ),
      scans: this.pipelineService.listPipelines(0, 200, s.id!, 'SCAN').pipe(
        map(list => list.length),
        catchError(() => of(0))
      ),
      lastScan: this.pipelineService.listPipelines(0, 1, s.id!, 'SCAN').pipe(
        map(list => list[0]?.createdAt ?? null),
        catchError(() => of(null))
      )
    }));

    forkJoin(requests).subscribe(results => {
      const stats: Record<string, ServiceStats> = {};
      for (const r of results) {
        stats[r.serviceId] = {
          deploys: r.deploys,
          scans: r.scans,
          lastScan: r.lastScan
        };
      }
      this.serviceStats = stats;
    });
  }

  back(): void {
    this.router.navigate(['/projects']);
  }

  formatDate(value?: unknown): string {
    const date = this.safeParseDate(value);
    if (!date) return '—';
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  compositionLabel(): string {
    if (!this.app) return '';
    const parts: string[] = [];
    const fe = this.app.services.filter(s => s.role === 'FRONTEND').length;
    const be = this.app.services.filter(s => s.role === 'BACKEND').length;
    const wk = this.app.services.filter(s => s.role === 'WORKER').length;
    if (fe) parts.push(`${fe} frontend`);
    if (be) parts.push(`${be} backend`);
    if (wk) parts.push(`${wk} worker`);
    const engines = [...new Set(this.app.databases.map(d => d.engine))];
    if (engines.length) parts.push(engines.join(', '));
    return parts.join(' · ');
  }

  // ---------- Services ----------

  openAddService(): void {
    this.editingService = null;
    this.formError = null;
    this.showServiceForm = true;
  }

  openEditService(svc: AppServiceModel): void {
    this.editingService = svc;
    this.formError = null;
    this.showServiceForm = true;
  }

  saveService(payload: AppServiceModel): void {
    this.saving = true;
    this.formError = null;
    const req = this.editingService?.id
      ? this.api.updateService(this.appId, this.editingService.id, payload)
      : this.api.addService(this.appId, payload);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showServiceForm = false;
        this.load();
      },
      error: (e) => {
        this.formError = e?.error?.message || 'Enregistrement impossible.';
        this.saving = false;
      }
    });
  }

  deleteService(svc: AppServiceModel): void {
    if (!svc.id || !confirm(`Supprimer le service « ${svc.name} » ?`)) return;
    this.api.deleteService(this.appId, svc.id).subscribe({ next: () => this.load() });
  }

  openScanService(svc: AppServiceModel): void {
    if (!svc.id) return;
    this.serviceActionTarget = svc;
    this.serviceActionKind = 'scan';
    this.serviceActionError = null;
  }

  openDeployService(svc: AppServiceModel): void {
    if (!svc.id) return;
    this.serviceActionTarget = svc;
    this.serviceActionKind = 'deploy';
    this.serviceActionError = null;
  }

  cancelServiceAction(): void {
    if (this.serviceActionRunning) return;
    this.serviceActionTarget = null;
    this.serviceActionKind = null;
    this.serviceActionError = null;
  }

  confirmServiceAction(params: DeployRunParams): void {
    const svc = this.serviceActionTarget;
    if (!svc?.id || !this.serviceActionKind) return;
    const serviceId = svc.id;
    this.serviceActionRunning = true;
    this.serviceActionError = null;

    if (this.serviceActionKind === 'scan') {
      this.api.scanService(serviceId, { branch: params.branch }).subscribe({
        next: (resp) => {
          this.serviceActionRunning = false;
          if (this.navigateToPipelineDetails(resp.gitlabPipelineId, serviceId, params.branch)) {
            this.serviceActionTarget = null;
            this.serviceActionKind = null;
            this.serviceActionError = null;
          } else {
            this.serviceActionError = 'Scan lancé mais ID pipeline GitLab absent.';
          }
        },
        error: (e) => {
          this.serviceActionError = e?.error?.message || 'Scan impossible.';
          this.serviceActionRunning = false;
        }
      });
      return;
    }

    this.api.deployService(this.appId, serviceId, {
      branch: params.branch,
      sessionDurationHours: params.sessionDurationHours
    }).subscribe({
      next: (resp) => {
        this.serviceActionRunning = false;
        if (this.navigateToPipelineDetails(resp.gitlabPipelineId, serviceId, params.branch)) {
          this.serviceActionTarget = null;
          this.serviceActionKind = null;
          this.serviceActionError = null;
        } else {
          this.serviceActionError = 'Déploiement lancé mais ID pipeline GitLab absent.';
        }
      },
      error: (e) => {
        this.serviceActionError = e?.error?.message || 'Déploiement du service impossible.';
        this.serviceActionRunning = false;
      }
    });
  }

  viewServiceDashboard(svc: AppServiceModel): void {
    if (!svc.id) return;
    this.router.navigate(['/project', svc.id, 'overview']);
  }

  // ---------- Databases ----------

  openAddDatabase(): void {
    this.editingDatabase = null;
    this.formError = null;
    this.showDatabaseForm = true;
  }

  openEditDatabase(db: AppDatabaseModel): void {
    this.editingDatabase = db;
    this.formError = null;
    this.showDatabaseForm = true;
  }

  saveDatabase(payload: AppDatabaseModel): void {
    this.saving = true;
    this.formError = null;
    const req = this.editingDatabase?.id
      ? this.api.updateDatabase(this.appId, this.editingDatabase.id, payload)
      : this.api.addDatabase(this.appId, payload);
    req.subscribe({
      next: () => {
        this.saving = false;
        this.showDatabaseForm = false;
        this.load();
      },
      error: (e) => {
        this.formError = e?.error?.message || 'Enregistrement impossible.';
        this.saving = false;
      }
    });
  }

  deleteDatabase(db: AppDatabaseModel): void {
    if (!db.id || !confirm(`Supprimer la base « ${db.name} » ?`)) return;
    this.api.deleteDatabase(this.appId, db.id).subscribe({
      next: () => this.load(),
      error: (e) => alert(e?.error?.message || 'Suppression impossible.')
    });
  }

  deleteApp(): void {
    if (!confirm(`Supprimer l'application « ${this.app?.name} » et tout son contenu ?`)) return;
    this.api.delete(this.appId).subscribe({ next: () => this.back() });
  }

  // ---------- Helpers ----------

  databaseName(id?: string | null): string {
    if (!id) return '';
    return this.app?.databases.find((d) => d.id === id)?.name || '';
  }

  serviceName(id?: string | null): string {
    if (!id) return '';
    return this.app?.services.find((s) => s.id === id)?.name || '';
  }

  roleClass(role: string): string {
    return 'role-' + role.toLowerCase();
  }

  roleIcon(role: string): string {
    const r = (role || '').toUpperCase();
    if (r === 'FRONTEND') return 'F';
    if (r === 'BACKEND') return 'B';
    if (r === 'WORKER') return 'W';
    return 'S';
  }

  serviceMetricCount(serviceId: string, field: 'deploys' | 'scans'): string | number {
    const stats = this.serviceStats[serviceId];
    if (!stats) return '…';
    return stats[field];
  }

  serviceHasActiveEnvironment(serviceName: string): boolean {
    const dep = this.app?.lastDeployment;
    if (!dep || dep.status !== 'RUNNING') return false;
    const states = this.extractServiceStates(dep.servicesState);
    return states.some(s => String(s?.['name'] ?? '').toLowerCase() === serviceName.toLowerCase());
  }

  serviceLastScanLabel(svc: AppServiceModel): string | null {
    if (!svc.id) return null;
    const stats = this.serviceStats[svc.id];
    if (!stats) return null;
    if (!stats.lastScan) return 'Jamais';
    const date = this.safeParseDate(stats.lastScan);
    if (!date) return 'Jamais';
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  /** Accepte ISO string, epoch, ou tableau Jackson LocalDateTime [y,m,d,h,mi,s]. */
  private safeParseDate(dateValue: unknown): Date | null {
    if (dateValue == null || dateValue === '') return null;
    try {
      if (typeof dateValue === 'number') {
        const date = new Date(dateValue < 1e12 ? dateValue * 1000 : dateValue);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (typeof dateValue === 'string') {
        const date = new Date(dateValue);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (Array.isArray(dateValue) && dateValue.length >= 3) {
        const [year, month, day, hour = 0, minute = 0, second = 0] = dateValue as number[];
        const date = new Date(year, month - 1, day, hour, minute, Math.floor(Number(second) || 0));
        return Number.isNaN(date.getTime()) ? null : date;
      }
      return null;
    } catch {
      return null;
    }
  }

  private extractServiceStates(raw: unknown): Array<Record<string, unknown>> {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.filter(x => !!x && typeof x === 'object') as Array<Record<string, unknown>>;
    }
    if (typeof raw === 'object') {
      return Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
        if (value && typeof value === 'object') {
          return { name, ...(value as Record<string, unknown>) };
        }
        return { name, status: value };
      });
    }
    return [];
  }

  private navigateToPipelineDetails(
    gitlabPipelineId: number | null | undefined,
    applicationServiceId: string,
    branch?: string
  ): boolean {
    if (!gitlabPipelineId) {
      return false;
    }
    const queryParams: Record<string, string> = { appId: applicationServiceId };
    if (branch?.trim()) {
      queryParams['branch'] = branch.trim();
    }
    this.router.navigate(['/pipeline/id', gitlabPipelineId], { queryParams });
    return true;
  }
}
