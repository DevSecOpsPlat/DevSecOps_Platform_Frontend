import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AdminAlert, AdminAlertStats, AdminService } from '../../services/admin/admin.service';

/** Types d'alertes actifs — incidents de sécurité nécessitant l'attention admin. */
const ACTIVE_ALERT_TYPES = [
  'FAILED_LOGIN_REPEATED',
  'ACCOUNT_LOCKED',
  'PASSWORD_CHANGED',
  'EMAIL_CHANGED',
  'ADMIN_PASSWORD_RESET',
  'ADMIN_EMAIL_CHANGED'
] as const;

const ALERT_TYPE_LABELS: Record<string, string> = {
  FAILED_LOGIN_REPEATED: 'Connexion échouée répétée (≥3)',
  ACCOUNT_LOCKED: 'Compte verrouillé (15 min)',
  PASSWORD_CHANGED: 'Mot de passe modifié (utilisateur)',
  EMAIL_CHANGED: 'E-mail modifié (utilisateur)',
  ADMIN_PASSWORD_RESET: 'Réinit. mot de passe (admin)',
  ADMIN_EMAIL_CHANGED: 'E-mail modifié (admin)',
  /* Anciennes alertes (avant séparation audit / alertes) */
  ACCOUNT_CREATED: 'Compte créé (archivé)',
  ACCOUNT_DELETED: 'Compte supprimé (archivé)',
  ACCOUNT_ENABLED: 'Compte activé (archivé)',
  ACCOUNT_DISABLED: 'Compte désactivé (archivé)'
};

@Component({
  selector: 'app-admin-alerts',
  templateUrl: './admin-alerts.component.html',
  styleUrls: ['./admin-alerts.component.css']
})
export class AdminAlertsComponent implements OnInit {
  alerts: AdminAlert[] = [];
  stats: AdminAlertStats | null = null;
  loading = true;
  error: string | null = null;

  filterStatus = '';
  filterType = '';

  readonly typeOptions = [...ACTIVE_ALERT_TYPES];

  constructor(private adminService: AdminService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    const status = this.filterStatus || undefined;
    const type = this.filterType || undefined;

    this.adminService.getAlertStats().subscribe({
      next: s => (this.stats = s),
      error: () => {}
    });

    this.adminService.getAlerts(status, type).subscribe({
      next: list => {
        this.alerts = list ?? [];
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err?.error?.message || 'Impossible de charger les alertes.';
      }
    });
  }

  typeLabel(type: string): string {
    return ALERT_TYPE_LABELS[type] ?? type;
  }

  typeCount(type: string): number {
    return this.stats?.countByType?.[type] ?? 0;
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

  markRead(alert: AdminAlert, event: Event): void {
    event.stopPropagation();
    if (alert.status === 'LUE') return;
    this.adminService.markAlertRead(alert.id).subscribe({
      next: updated => {
        alert.status = updated.status;
        if (this.stats) this.stats = { ...this.stats, unreadCount: Math.max(0, this.stats.unreadCount - 1) };
      }
    });
  }

  remove(alert: AdminAlert, event: Event): void {
    event.stopPropagation();
    if (!confirm('Supprimer cette alerte ?')) return;
    this.adminService.deleteAlert(alert.id).subscribe({
      next: () => {
        this.alerts = this.alerts.filter(a => a.id !== alert.id);
        this.load();
      }
    });
  }

  openUser(alert: AdminAlert): void {
    if (alert.relatedUserId) {
      this.router.navigate(['/admin/users', alert.relatedUserId]);
    }
  }

  onFilterChange(): void {
    this.load();
  }
}
