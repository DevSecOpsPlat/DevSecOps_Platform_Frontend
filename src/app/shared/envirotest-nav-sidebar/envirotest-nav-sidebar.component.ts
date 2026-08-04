import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { AppServiceModel, ManagedApp } from '../../models/application-management/application-management.models';
import { ApplicationResponse } from '../../models/application/application-response';
import { ManagedAppStateService } from '../../application-management/managed-app-state.service';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { ApplicationService } from '../../services/application/application.service';

export type NavContext = 'app' | 'service';

export interface NavLink {
  /** Clé logique partagée app/service pour le zoom. */
  key: string;
  label: string;
  /** Segment de route relatif. */
  path: string;
  queryParams?: Record<string, string>;
}

export interface NavGroup {
  id: 'overview' | 'scan' | 'deploy';
  label: string | null;
  items: NavLink[];
}

/** Mapping clé logique → path selon le contexte (pour zoom app↔service). */
export const SECTION_MAP: Record<string, { app: string; service: string }> = {
  overview: { app: 'dashboard', service: 'overview' },
  defectdojo: { app: 'defectdojo', service: 'security-dashboard' },
  'quality-gate': { app: 'quality-gate', service: 'quality-gate' },
  pipelines: { app: 'pipelines', service: 'pipelines' },
  history: { app: 'history', service: 'overview' },
  deployments: { app: 'deployments', service: 'deployments' },
  monitoring: { app: 'monitoring', service: 'monitoring' },
  alerts: { app: 'alerts', service: 'deployments' },
  sonarqube: { app: 'quality-gate', service: 'sonarqube' }
};

@Component({
  selector: 'app-envirotest-nav-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './envirotest-nav-sidebar.component.html',
  styleUrls: ['./envirotest-nav-sidebar.component.css']
})
export class EnvirotestNavSidebarComponent implements OnInit, OnDestroy {
  context: NavContext = 'app';
  appId = '';
  serviceId = '';
  managedApp: ManagedApp | null = null;
  serviceApp: ApplicationResponse | null = null;
  currentService: AppServiceModel | null = null;
  alertsLiveCount: number | null = null;
  loading = true;
  serviceMenuOpen = false;
  activeKey = 'overview';

  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private state: ManagedAppStateService,
    private appMgmt: ApplicationManagementService,
    private applicationApi: ApplicationService
  ) {}

  ngOnInit(): void {
    this.syncFromUrl(this.router.url);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((e) => this.syncFromUrl(e.urlAfterRedirects));

    this.state.watch().pipe(takeUntil(this.destroy$)).subscribe((app) => {
      if (this.context === 'app') {
        this.managedApp = app;
        this.loadAlertsLiveCount(app);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get groups(): NavGroup[] {
    if (this.context === 'app') {
      return [
        {
          id: 'overview',
          label: null,
          items: [{ key: 'overview', label: "Vue d'ensemble", path: 'dashboard' }]
        },
        {
          id: 'scan',
          label: 'Scan',
          items: [
            { key: 'defectdojo', label: 'DefectDojo', path: 'defectdojo' },
            { key: 'quality-gate', label: 'Quality Gate', path: 'quality-gate' },
            { key: 'pipelines', label: 'Pipelines', path: 'pipelines', queryParams: { kind: 'SCAN' } },
            { key: 'history', label: 'Historique', path: 'history' }
          ]
        },
        {
          id: 'deploy',
          label: 'Déploiement',
          items: [
            { key: 'deployments', label: 'Runtime & environnements', path: 'deployments' },
            { key: 'monitoring', label: 'Monitoring', path: 'monitoring' },
            { key: 'alerts', label: 'Alertes', path: 'alerts' }
          ]
        }
      ];
    }
    return [
      {
        id: 'overview',
        label: null,
        items: [{ key: 'overview', label: "Vue d'ensemble", path: 'overview' }]
      },
      {
        id: 'scan',
        label: 'Scan',
        items: [
          { key: 'defectdojo', label: 'DefectDojo', path: 'security-dashboard' },
          { key: 'quality-gate', label: 'Quality Gate', path: 'quality-gate' },
          { key: 'sonarqube', label: 'Sonar', path: 'sonarqube' },
          { key: 'pipelines', label: 'Pipelines', path: 'pipelines' }
        ]
      },
      {
        id: 'deploy',
        label: 'Déploiement',
        items: [
          { key: 'deployments', label: 'Déploiement', path: 'deployments' },
          { key: 'monitoring', label: 'Monitoring', path: 'monitoring' }
        ]
      }
    ];
  }

  get titleName(): string {
    if (this.context === 'app') return this.managedApp?.name || 'Application';
    return this.currentService?.name || this.serviceApp?.name || 'Service';
  }

  get subtitle(): string {
    if (this.context === 'app') {
      const slug = this.managedApp?.slug || '';
      const st = this.managedApp?.lastDeployment?.status;
      return st ? `${slug} · ${st}` : (slug || 'Application');
    }
    const role = (this.currentService?.role || 'service').toString().toLowerCase();
    const branch = this.currentService?.gitBranch || 'main';
    return `${role} · ${branch}`;
  }

  get deployStatus(): string | null {
    return this.managedApp?.lastDeployment?.status || null;
  }

  get siblings(): AppServiceModel[] {
    return (this.managedApp?.services || []).filter(s => !!s.id);
  }

  linkFor(item: NavLink): string[] {
    if (this.context === 'app') {
      return ['/projects', this.appId, item.path];
    }
    return ['/project', this.serviceId, item.path];
  }

  queryFor(item: NavLink): Record<string, string> {
    return item.queryParams || {};
  }

  badgeFor(item: NavLink): number | null {
    if (this.context === 'app' && item.key === 'alerts' && this.alertsLiveCount != null && this.alertsLiveCount > 0) {
      return this.alertsLiveCount;
    }
    return null;
  }

  isActive(item: NavLink): boolean {
    return this.activeKey === item.key;
  }

  backToProjects(): void {
    this.router.navigate(['/projects']);
  }

  goToApplication(): void {
    const id = this.managedApp?.id || this.appId;
    if (!id) {
      this.backToProjects();
      return;
    }
    const map = SECTION_MAP[this.activeKey] || SECTION_MAP['overview'];
    this.router.navigate(['/projects', id, map.app]);
  }

  toggleServiceMenu(ev: Event): void {
    ev.stopPropagation();
    this.serviceMenuOpen = !this.serviceMenuOpen;
  }

  selectService(svc: AppServiceModel): void {
    if (!svc?.id) return;
    this.serviceMenuOpen = false;
    const map = SECTION_MAP[this.activeKey] || SECTION_MAP['overview'];
    try {
      if (this.managedApp?.id) {
        localStorage.setItem('envirotest-last-managed-app-id', this.managedApp.id);
        if (this.managedApp.name) {
          localStorage.setItem('envirotest-last-managed-app-name', this.managedApp.name);
        }
      }
    } catch { /* ignore */ }
    this.router.navigate(['/project', svc.id, map.service]);
  }

  openServiceFromApp(svc: AppServiceModel): void {
    this.selectService(svc);
  }

  @HostListener('document:click')
  onDocClick(): void {
    this.serviceMenuOpen = false;
  }

  private syncFromUrl(url: string): void {
    const path = url.split(/[?#]/)[0];
    const appMatch = path.match(/^\/projects\/([^/]+)(?:\/([^/]+))?/);
    const svcMatch = path.match(/^\/project\/([^/]+)(?:\/([^/]+))?/);

    if (appMatch && !path.startsWith('/projects/create')) {
      const nextId = appMatch[1];
      const section = (appMatch[2] || 'dashboard').toLowerCase();
      const switched = this.context !== 'app' || this.appId !== nextId;
      this.context = 'app';
      this.appId = nextId;
      this.serviceId = '';
      this.activeKey = this.keyFromAppSection(section);
      if (switched) this.loadAppContext(nextId);
      return;
    }

    if (svcMatch) {
      const nextId = svcMatch[1];
      const section = (svcMatch[2] || 'overview').toLowerCase();
      const switched = this.context !== 'service' || this.serviceId !== nextId;
      this.context = 'service';
      this.serviceId = nextId;
      this.activeKey = this.keyFromServiceSection(section);
      if (switched) this.loadServiceContext(nextId);
    }
  }

  private keyFromAppSection(section: string): string {
    if (section === 'security' || section === 'defectdojo') return 'defectdojo';
    if (section === 'dashboard' || section === 'services' || section === 'databases') return 'overview';
    const keys = Object.keys(SECTION_MAP);
    for (const k of keys) {
      if (SECTION_MAP[k].app === section) return k;
    }
    return 'overview';
  }

  private keyFromServiceSection(section: string): string {
    if (section === 'security-dashboard' || section === 'security') return 'defectdojo';
    if (section === 'overview') return 'overview';
    const keys = Object.keys(SECTION_MAP);
    for (const k of keys) {
      if (SECTION_MAP[k].service === section) return k;
    }
    return 'overview';
  }

  private loadAppContext(id: string): void {
    this.loading = true;
    this.state.load(id).subscribe({
      next: () => { this.loading = false; },
      error: () => { this.loading = false; }
    });
  }

  private loadServiceContext(serviceId: string): void {
    this.loading = true;
    this.currentService = null;
    this.applicationApi.getApplicationById(serviceId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (app) => {
        this.serviceApp = app;
        this.loading = false;
      },
      error: () => {
        this.serviceApp = null;
        this.loading = false;
      }
    });
    this.appMgmt.getDeployContext(serviceId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (ctx) => {
        const managedId = ctx?.managedApplicationId;
        if (!managedId) return;
        this.appId = managedId;
        try {
          localStorage.setItem('envirotest-last-managed-app-id', managedId);
        } catch { /* ignore */ }
        this.appMgmt.get(managedId).pipe(takeUntil(this.destroy$)).subscribe({
          next: (app) => {
            this.managedApp = app;
            this.currentService = (app.services || []).find(s => s.id === serviceId) || null;
            try {
              if (app.name) localStorage.setItem('envirotest-last-managed-app-name', app.name);
            } catch { /* ignore */ }
          }
        });
      }
    });
  }

  private loadAlertsLiveCount(app: ManagedApp | null): void {
    const deploymentId = app?.lastDeployment?.id;
    if (!app?.id || !deploymentId) {
      this.alertsLiveCount = null;
      return;
    }
    this.appMgmt.getDeploymentAlerts(app.id, deploymentId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.alertsLiveCount = typeof res?.liveCount === 'number' ? res.liveCount : null;
        },
        error: () => { this.alertsLiveCount = null; }
      });
  }
}
