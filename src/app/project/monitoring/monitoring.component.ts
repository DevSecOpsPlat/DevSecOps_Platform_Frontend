import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AppServiceModel, ManagedApp } from '../../models/application-management/application-management.models';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { MonitoringDashboardComponent } from '../../application-management/monitoring-dashboard/monitoring-dashboard.component';

/**
 * Monitoring d'UN service — auparavant une iframe Grafana codée en dur (IP fixe, dashboard fixe,
 * jamais reliée au service réel), d'où le "Not Found" que voyait l'utilisateur quand cette cible
 * ne résolvait pas. Réutilise le même composant que le monitoring au niveau appli
 * (`MonitoringDashboardComponent`), pré-filtré sur ce seul service via `appServices`, en résolvant
 * le contexte (app gérée + service) depuis l'id de route — même pattern que
 * `ServiceContextBarComponent` (retour utilisateur du 18 août 2026).
 */
@Component({
  selector: 'app-monitoring',
  standalone: true,
  imports: [CommonModule, MonitoringDashboardComponent],
  templateUrl: './monitoring.component.html',
  styleUrls: ['./monitoring.component.css']
})
export class MonitoringComponent implements OnInit, OnDestroy {
  serviceId = '';
  managedApp: ManagedApp | null = null;
  currentService: AppServiceModel | null = null;
  loading = true;
  error: string | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private appMgmt: ApplicationManagementService
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((pm) => {
      const id = pm.get('appId'); // nom du paramètre de route ('project/:appId'), désigne en réalité le service
      if (id && id !== this.serviceId) {
        this.serviceId = id;
        this.load(id);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get appServicesForDashboard(): AppServiceModel[] {
    return this.currentService ? [this.currentService] : [];
  }

  private load(serviceId: string): void {
    this.loading = true;
    this.error = null;
    this.managedApp = null;
    this.currentService = null;
    this.appMgmt.getDeployContext(serviceId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (ctx) => {
        const managedId = ctx?.managedApplicationId;
        if (!managedId) {
          this.loading = false;
          this.error = 'Ce service ne fait pas encore partie d’une application gérée.';
          return;
        }
        this.appMgmt.get(managedId).pipe(takeUntil(this.destroy$)).subscribe({
          next: (app) => {
            this.managedApp = app;
            this.currentService = (app.services || []).find((s) => s.id === serviceId) || null;
            this.loading = false;
          },
          error: () => {
            this.loading = false;
            this.error = 'Application introuvable.';
          }
        });
      },
      error: () => {
        this.loading = false;
        this.error = 'Contexte de service introuvable.';
      }
    });
  }
}
