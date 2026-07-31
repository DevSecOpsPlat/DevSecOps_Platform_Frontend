import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import {
  AppDatabaseModel,
  AppDeployment,
  AppServiceModel,
  DeploymentAlertsResponse,
  DeploymentMonitorAlert,
  ManagedApp
} from '../../models/application-management/application-management.models';
import { ServiceFormComponent } from '../service-form/service-form.component';
import { DatabaseFormComponent } from '../database-form/database-form.component';
import { DeploymentStatusComponent } from '../deployment-status/deployment-status.component';
import { MonitoringDashboardComponent } from '../monitoring-dashboard/monitoring-dashboard.component';

@Component({
  selector: 'app-managed-application-detail',
  standalone: true,
  imports: [CommonModule, ServiceFormComponent, DatabaseFormComponent, DeploymentStatusComponent, MonitoringDashboardComponent],
  templateUrl: './application-detail.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class ApplicationDetailComponent implements OnInit {
  appId!: string;
  app: ManagedApp | null = null;
  loading = true;
  error: string | null = null;
  activeTab: 'services' | 'databases' | 'monitoring' | 'history' | 'alerts' = 'services';

  showServiceForm = false;
  editingService: AppServiceModel | null = null;
  showDatabaseForm = false;
  editingDatabase: AppDatabaseModel | null = null;

  saving = false;
  formError: string | null = null;
  deploying = false;
  deployError: string | null = null;
  deployTtlHours = 4;
  syncMessage: string | null = null;
  syncingServiceId: string | null = null;
  customHostnameDraft = '';
  savingHostname = false;
  hostnameMessage: string | null = null;
  hostnameError: string | null = null;

  /** Historique des déploiements (onglet). */
  history: AppDeployment[] = [];
  historyLoading = false;
  historyError: string | null = null;
  selectedHistoryId: string | null = null;

  /** Alertes runtime (onglet). */
  alertsData: DeploymentAlertsResponse | null = null;
  alertsLoading = false;
  alertsError: string | null = null;

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
        this.customHostnameDraft = app.customHostname || '';
        this.loading = false;
      },
      error: () => {
        this.error = 'Application introuvable.';
        this.loading = false;
      }
    });
  }

  back(): void {
    this.router.navigate(['/app-management']);
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
    this.syncMessage = null;
    const editingId = this.editingService?.id;
    const req = editingId
      ? this.api.updateService(this.appId, editingId, payload)
      : this.api.addService(this.appId, payload);
    req.subscribe({
      next: (saved) => {
        const serviceId = editingId || saved?.id;
        if (!serviceId || !editingId) {
          this.saving = false;
          this.showServiceForm = false;
          this.load();
          return;
        }
        // Après sauvegarde DB : appliquer direct sur le cluster RUNNING (sans rebuild).
        this.api.syncServiceRuntime(this.appId, serviceId).subscribe({
          next: (sync) => {
            this.saving = false;
            this.showServiceForm = false;
            this.syncMessage = sync?.message || (sync?.synced
              ? 'Variables appliquées sur le cluster.'
              : 'Enregistré en base (pas d’env RUNNING à synchroniser).');
            this.load();
          },
          error: (e) => {
            this.saving = false;
            this.showServiceForm = false;
            this.syncMessage = e?.error?.message
              || 'Enregistré en base, mais sync cluster échouée.';
            this.load();
          }
        });
      },
      error: (e) => {
        this.formError = e?.error?.message || 'Enregistrement impossible.';
        this.saving = false;
      }
    });
  }

  syncServiceToCluster(svc: AppServiceModel): void {
    if (!svc.id) return;
    this.syncingServiceId = svc.id;
    this.syncMessage = null;
    this.api.syncServiceRuntime(this.appId, svc.id).subscribe({
      next: (sync) => {
        this.syncingServiceId = null;
        this.syncMessage = sync?.message || 'Sync terminée.';
      },
      error: (e) => {
        this.syncingServiceId = null;
        this.syncMessage = e?.error?.message || 'Sync cluster impossible.';
      }
    });
  }

  deleteService(svc: AppServiceModel): void {
    if (!svc.id || !confirm(`Supprimer le service « ${svc.name} » ?\nSes pods/ressources seront aussi retirés du cluster RUNNING.`)) return;
    this.syncMessage = null;
    this.api.deleteService(this.appId, svc.id).subscribe({
      next: (res) => {
        this.syncMessage = res?.message || 'Service supprimé.';
        this.load();
      },
      error: (e) => {
        this.syncMessage = e?.error?.message || 'Suppression impossible.';
      }
    });
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
    if (!db.id || !confirm(`Supprimer la base « ${db.name} » ?\nSes pods/PVC seront aussi retirés du cluster RUNNING.`)) return;
    this.syncMessage = null;
    this.api.deleteDatabase(this.appId, db.id).subscribe({
      next: (res) => {
        this.syncMessage = res?.message || 'Base supprimée.';
        this.load();
      },
      error: (e) => {
        this.syncMessage = e?.error?.message || 'Suppression impossible.';
      }
    });
  }

  // ---------- Deploy ----------

  deploy(): void {
    this.deploying = true;
    this.deployError = null;
    const ttl = Math.min(72, Math.max(1, this.deployTtlHours || 4));
    this.api.deploy(this.appId, { sessionDurationHours: ttl }).subscribe({
      next: () => {
        this.deploying = false;
        this.load();
        if (this.activeTab === 'history') this.loadHistory();
      },
      error: (e) => {
        this.deployError = e?.error?.message || 'Déploiement impossible.';
        this.deploying = false;
      }
    });
  }

  teardown(): void {
    const dep = this.app?.lastDeployment;
    if (!dep || !confirm('Supprimer le déploiement (namespace K8s) ?\nLes pods et services cluster seront détruits.')) return;
    this.syncMessage = null;
    this.api.teardownDeployment(this.appId, dep.id).subscribe({
      next: () => {
        this.syncMessage = 'Déploiement arrêté — environnement STOPPED.';
        this.load();
        if (this.activeTab === 'history') this.loadHistory();
      },
      error: (e) => {
        this.syncMessage = e?.error?.message || 'Teardown impossible.';
        this.load();
      }
    });
  }

  deleteApp(): void {
    if (!confirm(`Supprimer l'application « ${this.app?.name} » et tout son contenu ?`)) return;
    this.api.delete(this.appId).subscribe({ next: () => this.back() });
  }

  saveCustomHostname(): void {
    if (!this.app) return;
    this.savingHostname = true;
    this.hostnameError = null;
    this.hostnameMessage = null;
    const host = (this.customHostnameDraft || '').trim() || null;
    this.api.update(this.appId, {
      name: this.app.name,
      description: this.app.description,
      customHostname: host
    }).subscribe({
      next: (updated) => {
        this.app = updated;
        this.customHostnameDraft = updated.customHostname || '';
        this.savingHostname = false;
        this.hostnameMessage = host
          ? `Domaine « ${host} » enregistré — pointez le DNS vers l'IP Traefik.`
          : 'Domaine custom retiré — retour à nip.io.';
      },
      error: (e) => {
        this.savingHostname = false;
        this.hostnameError = e?.error?.message || 'Impossible d\'enregistrer le domaine.';
      }
    });
  }

  // ---------- Historique / Alertes ----------

  setTab(tab: 'services' | 'databases' | 'monitoring' | 'history' | 'alerts'): void {
    this.activeTab = tab;
    if (tab === 'history') {
      this.loadHistory();
    }
    if (tab === 'alerts') {
      this.loadAlerts();
    }
  }

  loadHistory(): void {
    this.historyLoading = true;
    this.historyError = null;
    this.api.listDeployments(this.appId).subscribe({
      next: (list) => {
        this.history = list || [];
        this.historyLoading = false;
        if (!this.selectedHistoryId && this.history.length) {
          this.selectedHistoryId = this.history[0].id;
        }
      },
      error: (e) => {
        this.historyError = e?.error?.message || 'Impossible de charger l\'historique.';
        this.historyLoading = false;
      }
    });
  }

  loadAlerts(): void {
    const depId = this.app?.lastDeployment?.id;
    if (!depId) {
      this.alertsData = null;
      this.alertsError = null;
      return;
    }
    this.alertsLoading = true;
    this.alertsError = null;
    this.api.getDeploymentAlerts(this.appId, depId).subscribe({
      next: (res) => {
        this.alertsData = res;
        this.alertsLoading = false;
      },
      error: (e) => {
        this.alertsError = e?.error?.message || 'Impossible de charger les alertes.';
        this.alertsLoading = false;
      }
    });
  }

  alertClass(severity: string | undefined): string {
    return severity === 'error' ? 'am-alert-error' : 'am-alert';
  }

  selectHistory(dep: AppDeployment): void {
    this.selectedHistoryId = dep.id;
  }

  get selectedHistory(): AppDeployment | null {
    if (!this.selectedHistoryId) return null;
    return this.history.find(d => d.id === this.selectedHistoryId) || null;
  }

  isCurrentDeployment(dep: AppDeployment): boolean {
    return !!this.app?.lastDeployment && this.app.lastDeployment.id === dep.id;
  }

  historyStatusClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'running') return 'status-running';
    if (s === 'failed') return 'status-failed';
    if (s === 'stopped') return 'status-stopped';
    if (s === 'deploying' || s === 'pending') return 'status-deploying';
    return 'status-none';
  }

  serviceReadySummary(dep: AppDeployment): string {
    const services = dep.servicesState?.['services'];
    if (!services || typeof services !== 'object') return '—';
    const vals = Object.values(services as Record<string, { status?: string }>);
    if (!vals.length) return '—';
    const ready = vals.filter(v => (v?.status || '').toLowerCase() === 'ready').length;
    return `${ready}/${vals.length} Ready`;
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
