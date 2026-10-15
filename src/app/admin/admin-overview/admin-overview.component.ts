import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  AdminActivityEvent,
  AdminService,
  AdminUserApplicationDetail,
  AdminUserEnvironmentDetail,
  AdminUserMetrics
} from '../../services/admin/admin.service';
import { AuthService } from '../../services/auth/auth.service';

export interface OverviewAppCard extends AdminUserApplicationDetail {
  ownerUsername: string;
  activeEnvironmentsCount: number;
}

export interface OverviewEnvCard extends AdminUserEnvironmentDetail {
  ownerUsername: string;
  servicesCount: number;
}

export interface OverviewUserCard {
  id: string;
  username: string;
  email: string;
  accountStatus: string;
  applicationsCount: number;
  activeEnvironmentsCount: number;
  pipelinesCount: number;
  lastLoginAt: string | number[] | null | undefined;
}

/** Un raccourci de la barre "Accès rapides" (reprend la partie utile de l'ancien Accueil, cf.
 * retour utilisateur du 6 septembre 2026 : la page Accueil a été supprimée mais ses raccourcis de
 * navigation restaient pertinents). */
export interface QuickLink {
  icon: string;
  label: string;
  description: string;
  link: string;
}

/**
 * Vue d'ensemble — page d'atterrissage de la console admin (refonte dashboard, Phase 1).
 * 5 indicateurs décisionnels au lieu d'une dizaine de petites cartes KPI, puis des sections
 * hiérarchisées et contextualisées : attention requise, activité récente, environnements actifs,
 * applications. Cf. plan de refonte (§A) et docs/audit-dashboard-admin.md.
 */
@Component({
  selector: 'app-admin-overview',
  templateUrl: './admin-overview.component.html',
  styleUrls: ['../admin-design-system.css', './admin-overview.component.css']
})
export class AdminOverviewComponent implements OnInit {
  loading = true;
  error: string | null = null;

  // 5 indicateurs de synthèse
  activeUsersCount = 0;
  totalUsersCount = 0;
  activeEnvironmentsCount = 0;
  anomalyEnvironmentsCount = 0;
  deployedApplicationsCount = 0;
  totalApplicationsCount = 0;
  executions24h = 0;
  executions24hFailed = 0;
  attentionCount = 0;

  attentionEvents: AdminActivityEvent[] = [];
  activeEnvironments: OverviewEnvCard[] = [];
  applications: OverviewAppCard[] = [];
  users: OverviewUserCard[] = [];

  activityLoading = true;

  /** Repris de l'ancienne page Accueil (supprimée) : raccourcis + cadre d'usage. */
  readonly quickLinks: QuickLink[] = [
    { icon: '👥', label: 'Utilisateurs & activité', description: 'Créer des comptes et consulter l\'activité.', link: '/admin/users' },
    { icon: '▤', label: 'Applications & environnements', description: 'Composition, services, environnements liés.', link: '/admin/applications' },
    { icon: '⚠', label: 'Alertes', description: 'Menaces, IP bloquées, tableau de bord sécurité.', link: '/admin/alerts' },
    { icon: '🧾', label: 'Journal d\'audit', description: 'Traçabilité des actions sensibles.', link: '/admin/audit' },
    { icon: '✉', label: 'Réclamations', description: 'Messages utilisateurs et réponses.', link: '/admin/reclamations' }
  ];

  constructor(
    private adminService: AdminService,
    public authService: AuthService,
    private router: Router
  ) {}

  get user() {
    return this.authService.getCurrentUser();
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.adminService.getAllUsersWithMetrics().subscribe({
      next: users => {
        this.aggregate(users);
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Impossible de charger les indicateurs.';
      }
    });
    this.loadActivity();
  }

  private aggregate(users: AdminUserMetrics[]): void {
    this.totalUsersCount = users.length;
    this.activeUsersCount = users.filter(u => (u.accountStatus || '').toUpperCase() === 'ACTIVE').length;

    const envCards: OverviewEnvCard[] = [];
    const appCards: OverviewAppCard[] = [];
    let anomalies = 0;

    for (const u of users) {
      const servicesCountByApp = new Map<string, number>();
      for (const a of u.applications || []) {
        servicesCountByApp.set(a.id, a.services?.length || 1);
        appCards.push({ ...a, ownerUsername: u.username, activeEnvironmentsCount: 0 });
      }
      for (const e of u.environments || []) {
        const status = (e.status || '').toUpperCase();
        const ps = (e.pipelineStatus || '').toUpperCase();
        if (status === 'FAILED' || ps === 'FAILED' || ps === 'CANCELED') {
          anomalies++;
        }
        if (status === 'RUNNING') {
          envCards.push({ ...e, ownerUsername: u.username, servicesCount: servicesCountByApp.get(e.applicationId) || 1 });
          const app = appCards.find(a => a.id === e.applicationId);
          if (app) {
            app.activeEnvironmentsCount++;
          }
        }
      }
    }

    this.activeEnvironments = envCards
      .sort((a, b) => this.toTime(b.createdAt) - this.toTime(a.createdAt))
      .slice(0, 9);
    this.activeEnvironmentsCount = envCards.length;
    this.anomalyEnvironmentsCount = anomalies;

    this.applications = appCards
      .sort((a, b) => this.toTime(b.createdAt) - this.toTime(a.createdAt))
      .slice(0, 9);
    this.totalApplicationsCount = appCards.length;
    this.deployedApplicationsCount = appCards.filter(a => a.activeEnvironmentsCount > 0).length;

    this.users = users
      .map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        accountStatus: u.accountStatus,
        applicationsCount: u.applicationsCount ?? u.applications?.length ?? 0,
        activeEnvironmentsCount: u.activeEnvironmentsCount ?? 0,
        pipelinesCount: u.pipelinesCount ?? 0,
        lastLoginAt: u.lastLoginAt
      }))
      .sort((a, b) => this.toTime(b.lastLoginAt) - this.toTime(a.lastLoginAt))
      .slice(0, 9);
  }

  private loadActivity(): void {
    this.activityLoading = true;
    // Sert uniquement au KPI "Exécutions (24h)" et à la section "Attention requise" — plus de
    // timeline "Activité récente" sur cette page (retour utilisateur du 6 septembre 2026).
    this.adminService.getActivity({ limit: 80 }).subscribe({
      next: events => {
        const dayAgo = Date.now() - 24 * 3600 * 1000;
        const pipelineToday = events.filter(e => e.kind === 'PIPELINE' && this.toTime(e.occurredAt) >= dayAgo);
        this.executions24h = pipelineToday.length;
        this.executions24hFailed = pipelineToday.filter(e => e.severity === 'CRITICAL').length;

        const twoDaysAgo = Date.now() - 48 * 3600 * 1000;
        this.attentionEvents = events
          .filter(e => e.kind === 'ALERT' && e.severity !== 'INFO' && this.toTime(e.occurredAt) >= twoDaysAgo)
          .slice(0, 6);
        this.attentionCount = this.attentionEvents.length;

        this.activityLoading = false;
      },
      error: () => {
        this.activityLoading = false;
      }
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

  compositionLabel(a: OverviewAppCard): string {
    const n = a.services?.length ?? 0;
    return n === 1 ? '1 service' : `${n} services`;
  }

  timeAgoShort(value: string | number[] | null | undefined): string {
    const t = this.toTime(value);
    if (!t) return '—';
    const seconds = Math.floor((Date.now() - t) / 1000);
    if (seconds < 60) return 'à l\'instant';
    if (seconds < 3600) return 'il y a ' + Math.floor(seconds / 60) + ' min';
    if (seconds < 86400) return 'il y a ' + Math.floor(seconds / 3600) + ' h';
    return 'il y a ' + Math.floor(seconds / 86400) + ' j';
  }

  attentionSeverityClass(e: AdminActivityEvent): string {
    return 'sev-' + (e.severity || 'warning').toLowerCase();
  }

  openEnvironment(id: string): void {
    this.router.navigate(['/admin/environments', id]);
  }

  openApplication(id: string): void {
    this.router.navigate(['/admin/applications', id]);
  }

  openUser(id: string): void {
    this.router.navigate(['/admin/users', id]);
  }

  initials(username: string): string {
    return (username || '?').slice(0, 2).toUpperCase();
  }

  openFromEvent(e: AdminActivityEvent): void {
    if (e.environmentId) {
      this.openEnvironment(e.environmentId);
    } else if (e.applicationId) {
      this.openApplication(e.applicationId);
    }
  }

  statusClass(status: string | null | undefined): string {
    return (status || '').toLowerCase();
  }
}
