import { Component, OnInit } from '@angular/core';
import {
  AdminPipelineCounts,
  AdminService,
  AdminUserApplicationDetail,
  AdminUserEnvironmentDetail,
  AdminUserMetrics
} from '../../services/admin/admin.service';

export interface AppInventoryRow extends AdminUserApplicationDetail {
  ownerId: string;
  ownerUsername: string;
  ownerEmail: string;
  accountStatus: string;
}

export interface EnvInventoryRow extends AdminUserEnvironmentDetail {
  ownerId: string;
  ownerUsername: string;
  ownerEmail: string;
}

@Component({
  selector: 'app-admin-inventory',
  templateUrl: './admin-inventory.component.html',
  styleUrls: ['../admin-route-page.css', './admin-inventory.component.css']
})
export class AdminInventoryComponent implements OnInit {
  loading = true;
  error: string | null = null;

  tab: 'apps' | 'envs' = 'apps';
  search = '';

  private users: AdminUserMetrics[] = [];
  allAppRows: AppInventoryRow[] = [];
  allEnvRows: EnvInventoryRow[] = [];

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.load();
  }

  get filteredApps(): AppInventoryRow[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.allAppRows;
    return this.allAppRows.filter(r => this.matchesApp(r, q));
  }

  get filteredEnvs(): EnvInventoryRow[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.allEnvRows;
    return this.allEnvRows.filter(r => this.matchesEnv(r, q));
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.adminService.getAllUsersWithMetrics().subscribe({
      next: users => {
        this.users = users;
        this.rebuildRows();
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Chargement impossible.';
      }
    });
  }

  private rebuildRows(): void {
    const apps: AppInventoryRow[] = [];
    const envs: EnvInventoryRow[] = [];
    for (const u of this.users) {
      for (const a of u.applications || []) {
        apps.push({
          ...a,
          ownerId: u.id,
          ownerUsername: u.username,
          ownerEmail: u.email,
          accountStatus: u.accountStatus
        });
      }
      for (const e of u.environments || []) {
        envs.push({
          ...e,
          ownerId: u.id,
          ownerUsername: u.username,
          ownerEmail: u.email
        });
      }
    }
    this.allAppRows = apps;
    this.allEnvRows = envs;
  }

  private matchesApp(r: AppInventoryRow, q: string): boolean {
    return (
      (r.name || '').toLowerCase().includes(q) ||
      (r.gitRepositoryUrl || '').toLowerCase().includes(q) ||
      (r.ownerUsername || '').toLowerCase().includes(q) ||
      (r.ownerEmail || '').toLowerCase().includes(q)
    );
  }

  private matchesEnv(r: EnvInventoryRow, q: string): boolean {
    return (
      (r.environmentName || '').toLowerCase().includes(q) ||
      (r.applicationName || '').toLowerCase().includes(q) ||
      (r.gitBranch || '').toLowerCase().includes(q) ||
      (r.ownerUsername || '').toLowerCase().includes(q) ||
      (r.status || '').toLowerCase().includes(q) ||
      (r.pipelineStatus || '').toLowerCase().includes(q) ||
      (r.url || '').toLowerCase().includes(q)
    );
  }

  deploymentUrlLabel(url: string | null | undefined): string {
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

  setTab(t: 'apps' | 'envs'): void {
    this.tab = t;
  }

  pipelineTotal(pc: AdminPipelineCounts | undefined): number {
    if (!pc) return 0;
    if (pc.total != null) return pc.total;
    return (
      (pc.success || 0) +
      (pc.failed || 0) +
      (pc.running || 0) +
      (pc.pending || 0) +
      (pc.canceled || 0) +
      (pc.skipped || 0)
    );
  }
}
