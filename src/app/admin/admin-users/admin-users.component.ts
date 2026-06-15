import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { Router } from '@angular/router';
import Chart from 'chart.js/auto';
import {
  AdminFailedLoginEntry,
  AdminPipelineCounts,
  AdminSecurityAlert,
  AdminService,
  AdminUserMetrics,
  AdminUsersDashboardStats
} from '../../services/admin/admin.service';

interface CreationMonthPoint {
  label: string;
  count: number;
  names: string[];
}

interface FailedUserGroup {
  userId: string;
  username: string;
  email: string;
  attempts: AdminFailedLoginEntry[];
}

@Component({
  selector: 'app-admin-users',
  templateUrl: './admin-users.component.html',
  styleUrls: ['../admin-route-page.css', './admin-users.component.css']
})
export class AdminUsersComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly DISMISSED_ALERTS_KEY = 'admin-dismissed-security-alerts';

  @ViewChild('creationCanvas') creationCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('loginCanvas') loginCanvas?: ElementRef<HTMLCanvasElement>;

  loading = false;
  error: string | null = null;
  users: AdminUserMetrics[] = [];
  dashboard: AdminUsersDashboardStats | null = null;
  search = '';
  statusFilter: '' | 'ACTIVE' | 'DISABLED' = '';
  showCreateModal = false;
  showFailuresModal = false;
  dismissedAlerts = new Set<string>();

  private creationMonthsData: CreationMonthPoint[] = [];

  private creationChart?: Chart;
  private loginChart?: Chart;
  private chartsReady = false;
  private pendingChartBuild = false;

  constructor(private adminService: AdminService, private router: Router) {}

  ngOnInit(): void {
    this.restoreDismissedAlerts();
    this.loadAll();
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    if (this.pendingChartBuild) {
      this.buildCharts();
    }
  }

  ngOnDestroy(): void {
    this.creationChart?.destroy();
    this.loginChart?.destroy();
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

  get activeCount(): number {
    return this.users.filter(u => (u.accountStatus || '').toUpperCase() === 'ACTIVE').length;
  }

  get disabledCount(): number {
    return this.users.filter(u => (u.accountStatus || '').toUpperCase() === 'DISABLED').length;
  }

  get visibleAlerts(): AdminSecurityAlert[] {
    return (this.dashboard?.securityAlerts ?? []).filter(
      alert => !this.dismissedAlerts.has(this.alertUserId(alert))
    );
  }

  trackAlert(_index: number, alert: AdminSecurityAlert): string {
    return this.alertUserId(alert);
  }

  /** Échecs groupés par utilisateur (pour la modale détail). */
  get failuresByUser(): FailedUserGroup[] {
    const map = new Map<string, FailedUserGroup>();
    for (const entry of this.dashboard?.failedAttemptsDetail ?? []) {
      let group = map.get(entry.userId);
      if (!group) {
        group = {
          userId: entry.userId,
          username: entry.username,
          email: entry.email,
          attempts: []
        };
        map.set(entry.userId, group);
      }
      group.attempts.push(entry);
    }
    return [...map.values()].sort((a, b) => b.attempts.length - a.attempts.length);
  }

  openFailuresModal(event?: Event): void {
    event?.stopPropagation();
    if ((this.dashboard?.totalFailedAttempts ?? 0) > 0) {
      this.showFailuresModal = true;
    }
  }

  closeFailuresModal(): void {
    this.showFailuresModal = false;
  }

  loadAll(): void {
    this.loading = true;
    this.error = null;
    this.adminService.getAllUsersWithMetrics().subscribe({
      next: users => {
        this.users = users ?? [];
        this.adminService.getUsersDashboardStats().subscribe({
          next: stats => {
            this.dashboard = stats;
            this.loading = false;
            this.scheduleChartBuild();
          },
          error: () => {
            this.loading = false;
            this.scheduleChartBuild();
          }
        });
      },
      error: err => {
        this.loading = false;
        this.error = err?.error?.message || err?.message || 'Erreur lors du chargement des utilisateurs';
      }
    });
  }

  openUser(u: AdminUserMetrics, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/admin/users', u.id]);
  }

  openUserById(userId: string, event?: Event): void {
    event?.stopPropagation();
    this.router.navigate(['/admin/users', userId]);
  }

  dismissAlert(alert: AdminSecurityAlert, event: Event): void {
    event.stopPropagation();
    const id = this.alertUserId(alert);
    this.dismissedAlerts = new Set([...this.dismissedAlerts, id]);
    this.persistDismissedAlerts();
  }

  openCreateModal(): void {
    this.showCreateModal = true;
  }

  closeCreateModal(): void {
    this.showCreateModal = false;
  }

  onUserCreated(): void {
    this.loadAll();
  }

  accountStatusLower(u: AdminUserMetrics): string {
    return (u.accountStatus || 'unknown').toLowerCase();
  }

  accountStatusLabel(u: AdminUserMetrics): string {
    const map: Record<string, string> = {
      ACTIVE: 'Actif',
      DISABLED: 'Désactivé'
    };
    return map[(u.accountStatus || '').toUpperCase()] || u.accountStatus || '—';
  }

  rolesText(u: AdminUserMetrics): string {
    if (u.roles?.includes('ROLE_ADMIN')) {
      return 'Administrateur';
    }
    return 'Développeur';
  }

  isSecurityRisk(u: AdminUserMetrics): boolean {
    return (u.recentFailedAttempts ?? 0) >= 3;
  }

  formatDt(value: string | number[] | null | undefined): string {
    const d = this.toDate(value);
    return d ? d.toLocaleDateString('fr-FR') : '—';
  }

  formatDateTime(value: string | number[] | null | undefined): string {
    const d = this.toDate(value);
    return d ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  formatAttemptTime(value: string | number[] | null | undefined): string {
    const d = this.toDate(value);
    return d
      ? d.toLocaleString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      : '—';
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

  private restoreDismissedAlerts(): void {
    try {
      const raw = localStorage.getItem(AdminUsersComponent.DISMISSED_ALERTS_KEY);
      if (!raw) {
        return;
      }
      const ids: unknown = JSON.parse(raw);
      if (Array.isArray(ids)) {
        const normalized = ids
          .filter((id): id is string => typeof id === 'string')
          .map(id => id.trim())
          .filter(Boolean);
        this.dismissedAlerts = new Set(normalized);
      }
    } catch {
      /* ignore corrupted storage */
    }
  }

  private alertUserId(alert: AdminSecurityAlert): string {
    return String(alert.userId ?? '').trim();
  }

  private persistDismissedAlerts(): void {
    localStorage.setItem(
      AdminUsersComponent.DISMISSED_ALERTS_KEY,
      JSON.stringify([...this.dismissedAlerts])
    );
  }

  private scheduleChartBuild(): void {
    this.pendingChartBuild = true;
    if (this.chartsReady) {
      setTimeout(() => this.buildCharts(), 0);
    }
  }

  private buildCharts(): void {
    this.pendingChartBuild = false;
    if (!this.creationCanvas || !this.loginCanvas) {
      return;
    }
    this.buildCreationChart();
    this.buildLoginChart();
  }

  private buildCreationChart(): void {
    const canvas = this.creationCanvas!.nativeElement;
    this.creationChart?.destroy();

    const months = this.buildCreationMonths();
    this.creationMonthsData = months;
    const labels = months.map(m => m.label);
    const data = months.map(m => m.count);
    const monthsRef = this.creationMonthsData;

    this.creationChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Créations',
          data,
          borderColor: '#ea580c',
          backgroundColor: 'rgba(234, 88, 12, 0.12)',
          borderWidth: 2.5,
          pointBackgroundColor: '#ea580c',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleFont: { family: 'Inter', weight: 'normal' },
            bodyFont: { family: 'Inter', weight: 'normal' },
            padding: 12,
            callbacks: {
              label: ctx => ` ${ctx.parsed.y} compte(s) créé(s)`,
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0;
                const names = monthsRef[idx]?.names ?? [];
                if (!names.length) {
                  return [];
                }
                return names.map(n => `  · ${n}`);
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: '#64748b', font: { family: 'Inter', size: 11 } },
            grid: { color: '#f1f5f9' }
          }
        }
      }
    });
  }

  private buildLoginChart(): void {
    const canvas = this.loginCanvas!.nativeElement;
    this.loginChart?.destroy();

    const stats = this.dashboard?.loginStatsLast30Days ?? [];
    const labels = stats.map(s => {
      const d = new Date(s.date);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    });
    const successData = stats.map(s => s.success);
    const failedData = stats.map(s => s.failed);

    this.loginChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Réussies',
            data: successData,
            borderColor: '#ea580c',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.35
          },
          {
            label: 'Échouées',
            data: failedData,
            borderColor: '#0f172a',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 3],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              font: { family: 'Inter', size: 11 },
              color: '#475569'
            }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleFont: { family: 'Inter', weight: 'normal' },
            bodyFont: { family: 'Inter', weight: 'normal' }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 8, color: '#64748b', font: { family: 'Inter', size: 10 } }
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, color: '#64748b', font: { family: 'Inter', size: 10 } },
            grid: { color: '#f1f5f9' }
          }
        }
      }
    });
  }

  private buildCreationMonths(): CreationMonthPoint[] {
    const now = new Date();
    const months: { key: string; label: string; count: number; names: string[] }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
        count: 0,
        names: []
      });
    }
    for (const u of this.users) {
      const d = this.toDate(u.createdAt);
      if (!d) {
        continue;
      }
      const m = months.find(x => x.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (m) {
        m.count++;
        m.names.push(u.username);
      }
    }
    return months;
  }

  private toDate(value: string | number[] | null | undefined): Date | null {
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
}
