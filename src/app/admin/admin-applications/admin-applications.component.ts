import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AdminService, AdminUserApplicationDetail, AdminUserMetrics } from '../../services/admin/admin.service';

export interface AppRow extends AdminUserApplicationDetail {
  ownerId: string;
  ownerUsername: string;
  ownerEmail: string;
  accountStatus: string;
  /** Nombre d'environnements RUNNING pour cette application (dérivé, pas juste linkedEnvironmentsCount). */
  activeEnvironmentsCount: number;
}

/**
 * Liste des applications — remplace l'onglet Applications de l'ex-Inventaire. Une ligne = une
 * vraie application (ManagedApplication ou projet autonome), jamais un service isolé (cf.
 * docs/audit-dashboard-admin.md §1). Refonte dashboard admin, Phase 1.
 */
@Component({
  selector: 'app-admin-applications',
  templateUrl: './admin-applications.component.html',
  styleUrls: ['../admin-design-system.css', './admin-applications.component.css']
})
export class AdminApplicationsComponent implements OnInit {
  loading = true;
  error: string | null = null;

  search = '';
  ownerFilter = '';
  onlyWithActiveEnv = false;

  allRows: AppRow[] = [];
  owners: string[] = [];

  constructor(private adminService: AdminService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  get filteredRows(): AppRow[] {
    const q = this.search.trim().toLowerCase();
    return this.allRows.filter(r => {
      if (this.ownerFilter && r.ownerUsername !== this.ownerFilter) return false;
      if (this.onlyWithActiveEnv && r.activeEnvironmentsCount === 0) return false;
      if (!q) return true;
      return (
        (r.name || '').toLowerCase().includes(q) ||
        (r.ownerUsername || '').toLowerCase().includes(q) ||
        (r.gitRepositoryUrl || '').toLowerCase().includes(q) ||
        (r.services || []).some(s => (s.name || '').toLowerCase().includes(q))
      );
    });
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.adminService.getAllUsersWithMetrics().subscribe({
      next: users => {
        this.buildRows(users);
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Chargement impossible.';
      }
    });
  }

  private buildRows(users: AdminUserMetrics[]): void {
    const rows: AppRow[] = [];
    const ownerSet = new Set<string>();
    for (const u of users) {
      ownerSet.add(u.username);
      const activeEnvCountByApp = new Map<string, number>();
      for (const e of u.environments || []) {
        if ((e.status || '').toUpperCase() === 'RUNNING') {
          activeEnvCountByApp.set(e.applicationId, (activeEnvCountByApp.get(e.applicationId) || 0) + 1);
        }
      }
      for (const a of u.applications || []) {
        rows.push({
          ...a,
          ownerId: u.id,
          ownerUsername: u.username,
          ownerEmail: u.email,
          accountStatus: u.accountStatus,
          activeEnvironmentsCount: activeEnvCountByApp.get(a.id) || 0
        });
      }
    }
    this.allRows = rows.sort((x, y) => x.name.localeCompare(y.name));
    this.owners = [...ownerSet].sort();
  }

  compositionLabel(r: AppRow): string {
    const n = r.services?.length ?? 0;
    const parts = [n === 1 ? '1 service' : `${n} services`];
    if (r.databasesCount > 0) {
      parts.push(r.databasesCount === 1 ? '1 base de données' : `${r.databasesCount} bases de données`);
    }
    return parts.join(' · ');
  }

  pipelineTotal(r: AppRow): number {
    const pc = r.pipelineCounts;
    if (!pc) return 0;
    if (pc.total != null) return pc.total;
    return (pc.success || 0) + (pc.failed || 0) + (pc.running || 0) + (pc.pending || 0) + (pc.canceled || 0) + (pc.skipped || 0);
  }

  initials(name: string): string {
    const parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  open(r: AppRow): void {
    this.router.navigate(['/admin/applications', r.id]);
  }
}
