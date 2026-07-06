import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import {
  AppDatabaseModel,
  AppServiceModel,
  ManagedApp
} from '../../models/application-management/application-management.models';
import { ServiceFormComponent } from '../service-form/service-form.component';
import { DatabaseFormComponent } from '../database-form/database-form.component';
import { DeploymentStatusComponent } from '../deployment-status/deployment-status.component';
import { DeployRunModalComponent, DeployRunParams } from '../deploy-run-modal/deploy-run-modal.component';

@Component({
  selector: 'app-managed-application-detail',
  standalone: true,
  imports: [CommonModule, ServiceFormComponent, DatabaseFormComponent, DeploymentStatusComponent, DeployRunModalComponent],
  templateUrl: './application-detail.component.html',
  styleUrls: ['../shared/app-management.shared.css']
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
  deploying = false;
  deployError: string | null = null;

  // --- Actions par service (scan / déploiement ciblé) ---
  serviceActionTarget: AppServiceModel | null = null;
  serviceActionKind: 'scan' | 'deploy' | null = null;
  serviceActionRunning = false;
  serviceActionError: string | null = null;

  constructor(
    private api: ApplicationManagementService,
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
      },
      error: () => {
        this.error = 'Application introuvable.';
        this.loading = false;
      }
    });
  }

  back(): void {
    this.router.navigate(['/projects']);
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

  // ---------- Actions par service (scan / deploy ciblé / voir vulns) ----------

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
    this.serviceActionRunning = true;
    this.serviceActionError = null;

    if (this.serviceActionKind === 'scan') {
      this.api.scanService(svc.id, {
        branch: params.branch,
        sessionDurationHours: params.sessionDurationHours
      }).subscribe({
        next: (resp) => {
          this.serviceActionRunning = false;
          this.serviceActionTarget = null;
          this.serviceActionKind = null;
          this.router.navigate(['/pipeline', resp.environmentId]);
        },
        error: (e) => {
          this.serviceActionError = e?.error?.message || 'Scan impossible.';
          this.serviceActionRunning = false;
        }
      });
      return;
    }

    // deploy single service
    this.api.deployService(this.appId, svc.id).subscribe({
      next: () => {
        this.serviceActionRunning = false;
        this.serviceActionTarget = null;
        this.serviceActionKind = null;
        this.load();
      },
      error: (e) => {
        this.serviceActionError = e?.error?.message || 'Déploiement du service impossible.';
        this.serviceActionRunning = false;
      }
    });
  }

  viewServiceSecurityDashboard(svc: AppServiceModel): void {
    if (!svc.id) return;
    this.router.navigate(['/project', svc.id, 'security-dashboard']);
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

  // ---------- Deploy ----------

  deploy(): void {
    this.deploying = true;
    this.deployError = null;
    this.api.deploy(this.appId).subscribe({
      next: () => {
        this.deploying = false;
        this.load();
      },
      error: (e) => {
        this.deployError = e?.error?.message || 'Déploiement impossible.';
        this.deploying = false;
      }
    });
  }

  teardown(): void {
    const dep = this.app?.lastDeployment;
    if (!dep || !confirm('Supprimer le déploiement (namespace K8s) ?')) return;
    this.api.teardownDeployment(this.appId, dep.id).subscribe({ next: () => this.load() });
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
}
