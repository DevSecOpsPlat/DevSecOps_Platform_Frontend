import { Component, OnInit } from '@angular/core';
import { AdminAuditEntry, AdminAuditPage, AdminAuditStats, AdminService } from '../../services/admin/admin.service';

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Connexion réussie',
  LOGIN_FAILED: 'Connexion échouée',
  ACCOUNT_LOCKED: 'Compte verrouillé (15 min)',
  ACCOUNT_CREATED: 'Compte créé (admin)',
  ACCOUNT_DELETED: 'Compte supprimé (admin)',
  ACCOUNT_ACTIVATED: 'Compte activé (1ère connexion)',
  ACTIVATION_EMAIL_SENT: 'E-mail d\'activation envoyé',
  ACCOUNT_ENABLED: 'Compte réactivé (admin)',
  ACCOUNT_DISABLED: 'Compte désactivé (admin)',
  PASSWORD_CHANGED: 'Mot de passe modifié (utilisateur)',
  ADMIN_PASSWORD_RESET: 'Mot de passe réinitialisé (admin)',
  EMAIL_CHANGED: 'E-mail modifié (utilisateur)',
  ADMIN_EMAIL_CHANGED: 'E-mail modifié (admin)'
};

/** Filtres groupés — correspond aux actions réellement tracées dans le journal. */
const ACTION_GROUPS: { label: string; actions: string[] }[] = [
  {
    label: 'Connexions',
    actions: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED']
  },
  {
    label: 'Cycle de vie du compte',
    actions: ['ACCOUNT_CREATED', 'ACCOUNT_DELETED', 'ACCOUNT_ACTIVATED', 'ACTIVATION_EMAIL_SENT']
  },
  {
    label: 'Statut (admin)',
    actions: ['ACCOUNT_ENABLED', 'ACCOUNT_DISABLED']
  },
  {
    label: 'Identifiants & e-mail',
    actions: ['PASSWORD_CHANGED', 'ADMIN_PASSWORD_RESET', 'EMAIL_CHANGED', 'ADMIN_EMAIL_CHANGED']
  }
];

@Component({
  selector: 'app-admin-audit',
  templateUrl: './admin-audit.component.html',
  styleUrls: ['./admin-audit.component.css']
})
export class AdminAuditComponent implements OnInit {
  page: AdminAuditPage | null = null;
  stats: AdminAuditStats | null = null;
  loading = true;
  error: string | null = null;
  currentPage = 0;
  pageSize = 50;
  filterAction = '';

  readonly actionGroups = ACTION_GROUPS;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.loadStats();
    this.load();
  }

  loadStats(): void {
    this.adminService.getAuditStats().subscribe({
      next: s => (this.stats = s),
      error: () => {}
    });
  }

  load(page = 0): void {
    this.loading = true;
    this.error = null;
    this.currentPage = page;
    const action = this.filterAction || undefined;

    this.adminService.getAuditLog(page, this.pageSize, undefined, action).subscribe({
      next: res => {
        this.page = res;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err?.error?.message || 'Impossible de charger le journal d\'audit.';
      }
    });
  }

  actionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  actionCount(action: string): number {
    return this.stats?.countByAction?.[action] ?? 0;
  }

  filterLabel(action: string): string {
    const count = this.actionCount(action);
    return `${this.actionLabel(action)} (${count})`;
  }

  formatDate(value: string | number[] | null | undefined): string {
    const d = this.parseDate(value);
    return d ? d.toLocaleString('fr-FR') : '—';
  }

  private parseDate(value: string | number[] | null | undefined): Date | null {
    if (value == null) {
      return null;
    }
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (Array.isArray(value) && value.length >= 3) {
      const [y, mo, day, h = 0, min = 0, s = 0] = value;
      return new Date(y, mo - 1, day, h, min, s);
    }
    return null;
  }

  prevPage(): void {
    if (this.currentPage > 0) this.load(this.currentPage - 1);
  }

  nextPage(): void {
    if (this.page && this.currentPage < this.page.totalPages - 1) {
      this.load(this.currentPage + 1);
    }
  }

  onFilterChange(): void {
    this.load(0);
  }

  refresh(): void {
    this.loadStats();
    this.load(this.currentPage);
  }
}
