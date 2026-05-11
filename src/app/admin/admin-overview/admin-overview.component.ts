import { Component, OnInit } from '@angular/core';
import { forkJoin } from 'rxjs';
import { AdminService, AdminUserEnvironmentDetail, AdminUserMetrics, PendingUser } from '../../services/admin/admin.service';

/** Ligne « comptes les plus sollicités » (équivalent agrégé des vues pipelines / déploiements côté métier). */
export interface AdminOverviewTopUser {
  username: string;
  email: string;
  accountStatus: string;
  applicationsCount: number;
  activeEnvironmentsCount: number;
  pipelinesCount: number;
}

export interface AdminOverviewRiskEnv {
  environmentName: string;
  applicationName: string;
  ownerUsername: string;
  ownerEmail: string;
  gitBranch: string;
  status: string;
  pipelineStatus: string | null | undefined;
  /** URL publique de l’environnement déployé (si renseignée par l’API). */
  deploymentUrl: string | null;
}

/** Environnements RUNNING avec URL accessible (aperçu admin). */
export interface AdminOverviewDeployedEnv {
  environmentName: string;
  applicationName: string;
  ownerUsername: string;
  ownerEmail: string;
  gitBranch: string;
  deploymentUrl: string;
}

export interface AdminOverviewRecentApp {
  name: string;
  ownerUsername: string;
  ownerEmail: string;
  gitRepositoryUrl: string;
  createdLabel: string;
}

@Component({
  selector: 'app-admin-overview',
  templateUrl: './admin-overview.component.html',
  styleUrls: ['../admin-route-page.css', './admin-overview.component.css']
})
export class AdminOverviewComponent implements OnInit {
  loading = true;
  error: string | null = null;

  pending: PendingUser[] = [];
  users: AdminUserMetrics[] = [];

  pendingCount = 0;
  totalPlatformUsers = 0;
  approvedCount = 0;
  rejectedCount = 0;
  suspendedCount = 0;
  usersWithApplications = 0;

  totalApplications = 0;
  totalEnvironments = 0;
  totalActiveEnvironments = 0;

  totalPipelines = 0;
  pipelineSuccess = 0;
  pipelineFailed = 0;
  pipelineRunning = 0;
  pipelinePending = 0;
  pipelineCanceled = 0;
  pipelineSkipped = 0;

  envPending = 0;
  envBuilding = 0;
  envRunning = 0;
  envFailed = 0;
  envDestroyed = 0;
  envExpired = 0;

  topUsers: AdminOverviewTopUser[] = [];
  riskEnvironments: AdminOverviewRiskEnv[] = [];
  /** Pipelines / envs considérés comme réussis (hors anomalies). */
  successEnvironments: AdminOverviewRiskEnv[] = [];
  /** Filtre du bloc « environnements » : anomalies vs réussis. */
  envWatchFilter: 'issues' | 'success' = 'issues';

  deployedEnvironments: AdminOverviewDeployedEnv[] = [];
  recentApplications: AdminOverviewRecentApp[] = [];

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    forkJoin({
      pending: this.adminService.getPendingUsers(),
      users: this.adminService.getAllUsersWithMetrics()
    }).subscribe({
      next: ({ pending, users }) => {
        this.pending = pending;
        this.users = users;
        this.pendingCount = pending.length;
        this.totalPlatformUsers = users.length;
        this.aggregate(users);
        this.topUsers = this.buildTopUsers(users);
        this.riskEnvironments = this.buildRiskEnvironments(users);
        this.successEnvironments = this.buildSuccessEnvironments(users);
        this.deployedEnvironments = this.buildDeployedEnvironments(users);
        this.recentApplications = this.buildRecentApplications(users);
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Impossible de charger les indicateurs.';
      }
    });
  }

  formatDt(value: string | number[] | null | undefined): string {
    if (value == null) {
      return '—';
    }
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? value : d.toLocaleString('fr-FR');
    }
    if (Array.isArray(value) && value.length >= 3) {
      const year = value[0];
      const month = value[1] - 1;
      const day = value[2];
      const h = value[3] ?? 0;
      const min = value[4] ?? 0;
      const s = value[5] ?? 0;
      return new Date(year, month, day, h, min, s).toLocaleString('fr-FR');
    }
    return '—';
  }

  pipelineBarPct(part: number): number {
    if (!this.totalPipelines) {
      return 0;
    }
    return Math.round((100 * part) / this.totalPipelines);
  }

  pendingPreview(): PendingUser[] {
    return this.pending.slice(0, 10);
  }

  setEnvWatchFilter(f: 'issues' | 'success'): void {
    this.envWatchFilter = f;
  }

  get activeWatchEnvironments(): AdminOverviewRiskEnv[] {
    return this.envWatchFilter === 'issues' ? this.riskEnvironments : this.successEnvironments;
  }

  /** Libellé court pour le lien (hôte + début de chemin). */
  deploymentUrlLabel(url: string): string {
    const t = (url || '').trim();
    if (!t) {
      return '';
    }
    try {
      const u = new URL(t);
      const path = u.pathname && u.pathname !== '/' ? u.pathname : '';
      const short = path.length > 24 ? path.slice(0, 24) + '…' : path;
      return (u.host || t) + short;
    } catch {
      return t.length > 42 ? t.slice(0, 42) + '…' : t;
    }
  }

  private aggregate(users: AdminUserMetrics[]): void {
    let app = 0;
    let env = 0;
    let pipe = 0;
    let ps = 0;
    let pf = 0;
    let pr = 0;
    let pp = 0;
    let pcan = 0;
    let psk = 0;

    let ep = 0;
    let eb = 0;
    let er = 0;
    let ef = 0;
    let ed = 0;
    let ex = 0;

    let appr = 0;
    let rej = 0;
    let susp = 0;
    let withApps = 0;
    let activeEnvSum = 0;

    for (const u of users) {
      const appLen = u.applications?.length ?? u.applicationsCount ?? 0;
      app += appLen;
      if (appLen > 0) {
        withApps++;
      }
      activeEnvSum += u.activeEnvironmentsCount ?? 0;

      env += u.environments?.length ?? 0;
      const pc = u.pipelineCounts;
      if (pc) {
        const tot =
          pc.total ??
          (pc.success || 0) +
            (pc.failed || 0) +
            (pc.running || 0) +
            (pc.pending || 0) +
            (pc.canceled || 0) +
            (pc.skipped || 0);
        pipe += tot;
        ps += pc.success || 0;
        pf += pc.failed || 0;
        pr += pc.running || 0;
        pp += pc.pending || 0;
        pcan += pc.canceled || 0;
        psk += pc.skipped || 0;
      }
      const ebk = u.environmentStatusBreakdown;
      if (ebk) {
        ep += ebk.pending || 0;
        eb += ebk.building || 0;
        er += ebk.running || 0;
        ef += ebk.failed || 0;
        ed += ebk.destroyed || 0;
        ex += ebk.expired || 0;
      }
      const st = (u.accountStatus || '').toUpperCase();
      if (st === 'APPROVED') {
        appr++;
      } else if (st === 'REJECTED') {
        rej++;
      } else if (st === 'SUSPENDED') {
        susp++;
      }
    }

    this.totalApplications = app;
    this.totalEnvironments = env;
    this.totalPipelines = pipe;
    this.pipelineSuccess = ps;
    this.pipelineFailed = pf;
    this.pipelineRunning = pr;
    this.pipelinePending = pp;
    this.pipelineCanceled = pcan;
    this.pipelineSkipped = psk;

    this.envPending = ep;
    this.envBuilding = eb;
    this.envRunning = er;
    this.envFailed = ef;
    this.envDestroyed = ed;
    this.envExpired = ex;

    this.approvedCount = appr;
    this.rejectedCount = rej;
    this.suspendedCount = susp;
    this.usersWithApplications = withApps;
    this.totalActiveEnvironments = activeEnvSum;
  }

  private buildTopUsers(users: AdminUserMetrics[]): AdminOverviewTopUser[] {
    return [...users]
      .map(u => ({
        username: u.username,
        email: u.email,
        accountStatus: u.accountStatus,
        applicationsCount: u.applicationsCount ?? u.applications?.length ?? 0,
        activeEnvironmentsCount: u.activeEnvironmentsCount ?? 0,
        pipelinesCount: u.pipelinesCount ?? 0
      }))
      .sort((a, b) => b.pipelinesCount - a.pipelinesCount)
      .slice(0, 12);
  }

  private buildRiskEnvironments(users: AdminUserMetrics[]): AdminOverviewRiskEnv[] {
    const rows: AdminOverviewRiskEnv[] = [];
    for (const u of users) {
      for (const e of u.environments || []) {
        if (this.isRiskEnvironment(e)) {
          rows.push({
            environmentName: e.environmentName,
            applicationName: e.applicationName,
            ownerUsername: u.username,
            ownerEmail: u.email,
            gitBranch: e.gitBranch,
            status: e.status,
            pipelineStatus: e.pipelineStatus,
            deploymentUrl: e.url?.trim() || null
          });
        }
      }
    }
    return rows
      .sort((a, b) => this.riskRank(b) - this.riskRank(a))
      .slice(0, 15);
  }

  private buildSuccessEnvironments(users: AdminUserMetrics[]): AdminOverviewRiskEnv[] {
    const rows: { t: number; row: AdminOverviewRiskEnv }[] = [];
    for (const u of users) {
      for (const e of u.environments || []) {
        if (this.isSuccessEnvironment(e)) {
          rows.push({
            t: this.toTime(e.createdAt),
            row: {
              environmentName: e.environmentName,
              applicationName: e.applicationName,
              ownerUsername: u.username,
              ownerEmail: u.email,
              gitBranch: e.gitBranch,
              status: e.status,
              pipelineStatus: e.pipelineStatus,
              deploymentUrl: e.url?.trim() || null
            }
          });
        }
      }
    }
    return rows
      .sort((a, b) => b.t - a.t)
      .slice(0, 25)
      .map(x => x.row);
  }

  /**
   * Réussis : pipeline SUCCESS, ou env RUNNING sans anomalie pipeline (stable / en service).
   * Exclut explicitement les cas couverts par {@link isRiskEnvironment}.
   */
  private isSuccessEnvironment(e: AdminUserEnvironmentDetail): boolean {
    if (this.isRiskEnvironment(e)) {
      return false;
    }
    const ps = (e.pipelineStatus || '').trim().toUpperCase();
    const st = (e.status || '').trim().toUpperCase();
    if (ps === 'SUCCESS') {
      return true;
    }
    if (st === 'RUNNING' && (!ps || ps === 'SUCCESS')) {
      return true;
    }
    if (st === 'RUNNING' && ps === 'SKIPPED') {
      return true;
    }
    return false;
  }

  private buildDeployedEnvironments(users: AdminUserMetrics[]): AdminOverviewDeployedEnv[] {
    const rows: AdminOverviewDeployedEnv[] = [];
    for (const u of users) {
      for (const e of u.environments || []) {
        const st = (e.status || '').toUpperCase();
        const url = e.url?.trim();
        if (st === 'RUNNING' && url) {
          rows.push({
            environmentName: e.environmentName,
            applicationName: e.applicationName,
            ownerUsername: u.username,
            ownerEmail: u.email,
            gitBranch: e.gitBranch,
            deploymentUrl: url
          });
        }
      }
    }
    return rows
      .sort((a, b) => a.applicationName.localeCompare(b.applicationName) || a.environmentName.localeCompare(b.environmentName))
      .slice(0, 28);
  }

  private isRiskEnvironment(e: AdminUserEnvironmentDetail): boolean {
    const st = (e.status || '').toUpperCase();
    if (st === 'FAILED') {
      return true;
    }
    const ps = (e.pipelineStatus || '').toUpperCase();
    return ps === 'FAILED' || ps === 'CANCELED';
  }

  /** Priorité d’affichage : env FAILED > pipeline FAILED > CANCELED. */
  private riskRank(r: AdminOverviewRiskEnv): number {
    let n = 0;
    if ((r.status || '').toUpperCase() === 'FAILED') {
      n += 4;
    }
    const ps = (r.pipelineStatus || '').toUpperCase();
    if (ps === 'FAILED') {
      n += 2;
    }
    if (ps === 'CANCELED') {
      n += 1;
    }
    return n;
  }

  private buildRecentApplications(users: AdminUserMetrics[]): AdminOverviewRecentApp[] {
    const items: { t: number; row: AdminOverviewRecentApp }[] = [];
    for (const u of users) {
      for (const a of u.applications || []) {
        items.push({
          t: this.toTime(a.createdAt),
          row: {
            name: a.name,
            ownerUsername: u.username,
            ownerEmail: u.email,
            gitRepositoryUrl: a.gitRepositoryUrl || '—',
            createdLabel: this.formatDt(a.createdAt)
          }
        });
      }
    }
    return items
      .sort((x, y) => y.t - x.t)
      .slice(0, 10)
      .map(x => x.row);
  }

  private toTime(value: string | number[] | null | undefined): number {
    if (value == null) {
      return 0;
    }
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
