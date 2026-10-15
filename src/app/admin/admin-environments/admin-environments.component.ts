import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AdminService, AdminUserEnvironmentDetail, AdminUserMetrics } from '../../services/admin/admin.service';

export interface EnvRow extends AdminUserEnvironmentDetail {
  ownerId: string;
  ownerUsername: string;
  ownerEmail: string;
  servicesCount: number;
}

/**
 * Liste des environnements — remplace l'onglet Environnements de l'ex-Inventaire, promue en page
 * de premier niveau (cf. plan de refonte du dashboard admin, Phase 1, §D). Les environnements
 * actifs sont mis en avant (tri par défaut, accent visuel).
 */
@Component({
  selector: 'app-admin-environments',
  templateUrl: './admin-environments.component.html',
  styleUrls: ['../admin-design-system.css', './admin-environments.component.css']
})
export class AdminEnvironmentsComponent implements OnInit {
  loading = true;
  error: string | null = null;

  search = '';
  statusFilter = '';
  ownerFilter = '';

  allRows: EnvRow[] = [];
  owners: string[] = [];
  statuses = ['RUNNING', 'BUILDING', 'PENDING', 'FAILED', 'DESTROYED', 'EXPIRED'];

  constructor(private adminService: AdminService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  get filteredRows(): EnvRow[] {
    const q = this.search.trim().toLowerCase();
    return this.allRows.filter(r => {
      if (this.statusFilter && r.status !== this.statusFilter) return false;
      if (this.ownerFilter && r.ownerUsername !== this.ownerFilter) return false;
      if (!q) return true;
      return (
        (r.environmentName || '').toLowerCase().includes(q) ||
        (r.applicationName || '').toLowerCase().includes(q) ||
        (r.ownerUsername || '').toLowerCase().includes(q) ||
        (r.gitBranch || '').toLowerCase().includes(q)
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
    const rows: EnvRow[] = [];
    const ownerSet = new Set<string>();
    for (const u of users) {
      ownerSet.add(u.username);
      const servicesCountByApp = new Map<string, number>();
      for (const a of u.applications || []) {
        servicesCountByApp.set(a.id, a.services?.length || 1);
      }
      for (const e of u.environments || []) {
        rows.push({
          ...e,
          ownerId: u.id,
          ownerUsername: u.username,
          ownerEmail: u.email,
          servicesCount: servicesCountByApp.get(e.applicationId) || 1
        });
      }
    }
    // Actifs en tête, puis plus récents d'abord.
    rows.sort((a, b) => {
      const aRunning = (a.status || '').toUpperCase() === 'RUNNING';
      const bRunning = (b.status || '').toUpperCase() === 'RUNNING';
      if (aRunning !== bRunning) return aRunning ? -1 : 1;
      return this.toTime(b.createdAt) - this.toTime(a.createdAt);
    });
    this.allRows = rows;
    this.owners = [...ownerSet].sort();
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

  age(value: string | number[] | null | undefined): string {
    const t = this.toTime(value);
    if (!t) return '—';
    const seconds = Math.floor((Date.now() - t) / 1000);
    if (seconds < 3600) return Math.max(1, Math.floor(seconds / 60)) + ' min';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' h';
    return Math.floor(seconds / 86400) + ' j';
  }

  statusClass(status: string | null | undefined): string {
    return (status || '').toLowerCase();
  }

  open(r: EnvRow): void {
    this.router.navigate(['/admin/environments', r.id]);
  }

  openApplication(r: EnvRow, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/admin/applications', r.applicationId]);
  }
}
