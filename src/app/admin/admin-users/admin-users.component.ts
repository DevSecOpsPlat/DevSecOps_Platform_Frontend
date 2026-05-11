import { Component, OnInit } from '@angular/core';
import { AdminService, AdminPipelineCounts, AdminUserApplicationDetail, AdminUserEnvironmentDetail, AdminUserMetrics } from '../../services/admin/admin.service';

@Component({
  selector: 'app-admin-users',
  templateUrl: './admin-users.component.html',
  styleUrls: ['../admin-route-page.css', './admin-users.component.css']
})
export class AdminUsersComponent implements OnInit {
  loading = false;
  error: string | null = null;
  users: AdminUserMetrics[] = [];
  search = '';
  statusFilter: '' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' = '';

  selectedUser: AdminUserMetrics | null = null;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  get filteredUsers(): AdminUserMetrics[] {
    const q = this.search.trim().toLowerCase();
    return this.users.filter(u => {
      const okStatus = !this.statusFilter || (u.accountStatus || '').toUpperCase() === this.statusFilter;
      if (!okStatus) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    });
  }

  loadUsers(opts?: { silent?: boolean }): void {
    const silent = opts?.silent === true;
    if (!silent) {
      this.loading = true;
      this.error = null;
    }
    this.adminService.getAllUsersWithMetrics().subscribe({
      next: users => {
        this.users = users ?? [];
        const keepId = this.selectedUser?.id;
        this.selectedUser = keepId
          ? this.users.find(u => u.id === keepId) ?? this.users[0] ?? null
          : this.users[0] ?? null;
        if (!silent) {
          this.loading = false;
        }
      },
      error: err => {
        if (!silent) {
          this.loading = false;
        }
        this.error = err?.error?.message || err?.message || 'Erreur lors du chargement des utilisateurs';
      }
    });
  }

  accountStatusUpper(u: AdminUserMetrics): string {
    return (u.accountStatus || '').toUpperCase();
  }

  accountStatusLower(u: AdminUserMetrics): string {
    return (u.accountStatus || 'unknown').toLowerCase();
  }

  isPending(u: AdminUserMetrics): boolean {
    return this.accountStatusUpper(u) === 'PENDING';
  }

  approve(u: AdminUserMetrics): void {
    this.adminService.approveUser(u.id).subscribe({
      next: () => {
        this.loadUsers({ silent: true });
      },
      error: err => {
        this.error = err?.error?.message || 'Erreur lors de l’approbation';
      }
    });
  }

  reject(u: AdminUserMetrics): void {
    const reason = prompt(`Raison du rejet pour ${u.username} :`) || undefined;
    this.adminService.rejectUser(u.id, reason).subscribe({
      next: () => {
        this.loadUsers({ silent: true });
      },
      error: err => {
        this.error = err?.error?.message || 'Erreur lors du rejet';
      }
    });
  }

  select(u: AdminUserMetrics): void {
    this.selectedUser = u;
  }

  rolesText(u: AdminUserMetrics): string {
    return u.roles.length ? u.roles.join(', ') : '—';
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

  pipelineTotal(c: AdminPipelineCounts | undefined): number {
    if (!c) {
      return 0;
    }
    if (typeof c.total === 'number') {
      return c.total;
    }
    return (c.success || 0) + (c.failed || 0) + (c.running || 0) + (c.pending || 0) + (c.canceled || 0) + (c.skipped || 0);
  }

  envBreakdownTotal(u: AdminUserMetrics): number {
    const b = u.environmentStatusBreakdown;
    if (!b) {
      return 0;
    }
    if (typeof b.total === 'number') {
      return b.total;
    }
    return (b.pending || 0) + (b.building || 0) + (b.running || 0) + (b.failed || 0) + (b.destroyed || 0) + (b.expired || 0);
  }

  statusLabel(env: AdminUserEnvironmentDetail): string {
    const map: Record<string, string> = {
      PENDING: 'En attente',
      BUILDING: 'Construction',
      RUNNING: 'Actif',
      FAILED: 'Échec',
      DESTROYED: 'Détruit',
      EXPIRED: 'Expiré'
    };
    return map[env.status] || env.status;
  }

  pipelineStatusLabel(status: string | null | undefined): string {
    if (!status) {
      return '—';
    }
    const map: Record<string, string> = {
      SUCCESS: 'Réussi',
      FAILED: 'Échec',
      RUNNING: 'En cours',
      PENDING: 'En attente',
      CANCELED: 'Annulé',
      SKIPPED: 'Ignoré'
    };
    return map[status] || status;
  }
}
