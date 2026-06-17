import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import Chart from 'chart.js/auto';
import {
  AdminAuditAnalytics,
  AdminAuditDayCount,
  AdminAuditPage,
  AdminAuditStats,
  AdminService
} from '../../services/admin/admin.service';

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Connexion réussie',
  LOGIN_FAILED: 'Connexion échouée',
  ACCOUNT_CREATED: 'Compte créé (admin)',
  ACCOUNT_DELETED: 'Compte supprimé (admin)',
  ACCOUNT_ACTIVATED: 'Compte activé (1ère connexion)',
  ACTIVATION_EMAIL_SENT: 'E-mail d\'activation envoyé',
  ACCOUNT_ENABLED: 'Compte réactivé (admin)',
  ACCOUNT_DISABLED: 'Compte désactivé (admin)',
  ADMIN_PASSWORD_RESET: 'Mot de passe réinitialisé (admin)',
  ADMIN_EMAIL_CHANGED: 'E-mail modifié (admin)',
  ACCOUNT_LOCKED: 'Verrouillage (archivé)',
  PASSWORD_CHANGED: 'Mot de passe modifié (archivé)',
  EMAIL_CHANGED: 'E-mail modifié (archivé)'
};

const ACTION_GROUPS: { label: string; actions: string[] }[] = [
  { label: 'Connexions', actions: ['LOGIN_SUCCESS', 'LOGIN_FAILED'] },
  {
    label: 'Cycle de vie du compte',
    actions: ['ACCOUNT_CREATED', 'ACCOUNT_DELETED', 'ACCOUNT_ACTIVATED', 'ACTIVATION_EMAIL_SENT']
  },
  {
    label: 'Administration compte',
    actions: ['ACCOUNT_ENABLED', 'ACCOUNT_DISABLED', 'ADMIN_PASSWORD_RESET', 'ADMIN_EMAIL_CHANGED']
  }
];

const DONUT_COLORS = ['#ea580c', '#f97316', '#0f172a', '#475569', '#64748b', '#94a3b8', '#fdba74', '#fed7aa'];

type TrendPeriod = 'days' | 'months' | 'all';

@Component({
  selector: 'app-admin-audit',
  templateUrl: './admin-audit.component.html',
  styleUrls: ['./admin-audit.component.css']
})
export class AdminAuditComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('trendCanvas') trendCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('donutCanvas') donutCanvas?: ElementRef<HTMLCanvasElement>;

  page: AdminAuditPage | null = null;
  stats: AdminAuditStats | null = null;
  analytics: AdminAuditAnalytics | null = null;
  loading = true;
  error: string | null = null;
  currentPage = 0;
  pageSize = 50;

  filterAction = '';
  filterSearch = '';
  filterDateFrom = '';
  filterDateTo = '';
  trendPeriod: TrendPeriod = 'days';
  tableOpen = true;

  readonly actionGroups = ACTION_GROUPS;
  readonly trendPeriods: { value: TrendPeriod; label: string }[] = [
    { value: 'days', label: 'Jours' },
    { value: 'months', label: 'Mois' },
    { value: 'all', label: 'Tout' }
  ];

  private trendChart?: Chart;
  private donutChart?: Chart;
  private chartsReady = false;
  private pendingChartBuild = false;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.loadStats();
    this.loadAnalytics();
    this.load();
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    if (this.pendingChartBuild) {
      setTimeout(() => this.buildCharts(), 0);
    }
  }

  ngOnDestroy(): void {
    this.trendChart?.destroy();
    this.donutChart?.destroy();
  }

  loadStats(): void {
    this.adminService.getAuditStats().subscribe({
      next: s => {
        this.stats = s;
        this.scheduleChartBuild();
      },
      error: () => {}
    });
  }

  loadAnalytics(): void {
    this.adminService.getAuditAnalytics().subscribe({
      next: a => {
        this.analytics = a;
        this.scheduleChartBuild();
      },
      error: () => {}
    });
  }

  load(page = 0): void {
    this.loading = true;
    this.error = null;
    this.currentPage = page;

    this.adminService.getAuditLog(
      page,
      this.pageSize,
      undefined,
      this.filterAction || undefined,
      this.filterSearch || undefined,
      this.filterDateFrom || undefined,
      this.filterDateTo || undefined
    ).subscribe({
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
    return `${this.actionLabel(action)} (${this.actionCount(action)})`;
  }

  actionBadgeClass(action: string): string {
    switch (action) {
      case 'LOGIN_SUCCESS':
      case 'ACCOUNT_ACTIVATED':
      case 'ACCOUNT_ENABLED':
        return 'badge-success';
      case 'ADMIN_PASSWORD_RESET':
      case 'ADMIN_EMAIL_CHANGED':
      case 'LOGIN_FAILED':
      case 'ACCOUNT_DISABLED':
        return 'badge-warning';
      case 'ACCOUNT_DELETED':
        return 'badge-danger';
      case 'ACTIVATION_EMAIL_SENT':
      case 'ACCOUNT_CREATED':
        return 'badge-info';
      default:
        return 'badge-neutral';
    }
  }

  formatIp(ip: string | null | undefined): string {
    if (!ip || ip === '—') return '—';
    return ip;
  }

  formatDate(value: string | number[] | null | undefined): string {
    const d = this.parseDate(value);
    return d ? d.toLocaleString('fr-FR') : '—';
  }

  trendPeriodLabel(): string {
    switch (this.trendPeriod) {
      case 'days': return '30 derniers jours';
      case 'months': return '12 derniers mois';
      case 'all': return 'Historique complet';
    }
  }

  setTrendPeriod(period: TrendPeriod): void {
    if (this.trendPeriod === period) return;
    this.trendPeriod = period;
    this.buildTrendChart();
  }

  trendTotal(): number {
    return this.activeTrend().reduce((s, d) => s + d.count, 0);
  }

  donutTotal(): number {
    if (!this.stats?.countByAction) return 0;
    return Object.values(this.stats.countByAction).reduce((s, n) => s + n, 0);
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

  onSearchSubmit(): void {
    this.load(0);
  }

  clearFilters(): void {
    this.filterAction = '';
    this.filterSearch = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.load(0);
  }

  toggleTable(): void {
    this.tableOpen = !this.tableOpen;
  }

  refresh(): void {
    this.loadStats();
    this.loadAnalytics();
    this.load(this.currentPage);
  }

  private activeTrend(): AdminAuditDayCount[] {
    if (!this.analytics) return [];
    switch (this.trendPeriod) {
      case 'months': return this.analytics.monthlyTrend ?? [];
      case 'all': return this.analytics.allTimeTrend ?? [];
      default: return this.analytics.dailyTrend ?? [];
    }
  }

  private scheduleChartBuild(): void {
    this.pendingChartBuild = true;
    if (this.chartsReady) {
      setTimeout(() => this.buildCharts(), 0);
    }
  }

  private buildCharts(): void {
    this.pendingChartBuild = false;
    if (!this.trendCanvas || !this.donutCanvas) return;
    this.buildTrendChart();
    this.buildDonutChart();
  }

  private buildTrendChart(): void {
    const canvas = this.trendCanvas!.nativeElement;
    this.trendChart?.destroy();
    const trend = this.activeTrend();
    const labels = trend.map(d => this.formatTrendLabel(d.date));
    const data = trend.map(d => d.count);
    const isDaily = this.trendPeriod === 'days';

    this.trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Entrées d\'audit',
          data,
          borderColor: '#ea580c',
          backgroundColor: 'rgba(234, 88, 12, 0.12)',
          borderWidth: 2.5,
          pointBackgroundColor: '#ea580c',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: isDaily ? 3 : 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleFont: { family: 'Inter', weight: 'normal' },
            bodyFont: { family: 'Inter', weight: 'normal' },
            padding: 12,
            callbacks: {
              title: items => {
                const idx = items[0]?.dataIndex ?? 0;
                return this.formatTrendTooltip(trend[idx]?.date ?? '');
              },
              label: ctx => ` ${ctx.parsed.y} entrée(s)`
            }
          }
        },
        scales: {
          x: {
            grid: { color: '#f1f5f9' },
            ticks: {
              color: '#64748b',
              font: { family: 'Inter', size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: isDaily ? 10 : 12
            }
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

  private buildDonutChart(): void {
    const canvas = this.donutCanvas!.nativeElement;
    this.donutChart?.destroy();
    const counts = this.stats?.countByAction ?? {};
    const entries = Object.entries(counts).filter(([, v]) => v > 0);
    const labels = entries.map(([k]) => this.actionLabel(k));
    const data = entries.map(([, v]) => v);

    this.donutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: DONUT_COLORS.slice(0, data.length),
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        animation: { animateRotate: true, duration: 700 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            bodyFont: { family: 'Inter' },
            padding: 10
          }
        }
      }
    });
  }

  private formatTrendLabel(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    if (this.trendPeriod === 'days') {
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    }
    return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  }

  private formatTrendTooltip(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    if (this.trendPeriod === 'days') {
      return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }

  private parseDate(value: string | number[] | null | undefined): Date | null {
    if (value == null) return null;
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
