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
import { Subscription } from 'rxjs';
import { skip } from 'rxjs/operators';
import {
  AdminAlert,
  AdminBlockedIpDetail,
  AdminKpiPanel,
  AdminKpiPanelItem,
  AdminSecurityDashboard,
  AdminService,
  DataProtectionSummary
} from '../../services/admin/admin.service';
import { ThemeService } from '../../services/ui/theme.service';
import { adminChartPalette } from '../shared/admin-chart-palette';

const ALERT_TYPE_LABELS: Record<string, string> = {
  LOGIN_FAILED: 'Connexion échouée',
  FAILED_LOGIN_REPEATED: 'Échecs répétés',
  ACCOUNT_LOCKED: 'Compte verrouillé',
  BRUTE_FORCE_DETECTED: 'Force brute IP',
  RATE_LIMIT_EXCEEDED: 'Rate limit',
  HONEYPOT_TRIGGERED: 'Honeypot',
  SUSPICIOUS_REQUEST: 'Requête suspecte',
  MALICIOUS_PAYLOAD: 'Payload malveillant',
  SUSPICIOUS_USER_AGENT: 'User-Agent suspect',
  IP_BLOCKED: 'IP bloquée',
  PASSWORD_CHANGED: 'Mot de passe modifié',
  EMAIL_CHANGED: 'E-mail modifié',
  UNAUTHORIZED_ACCESS: 'Accès refusé'
};

const FILTER_TYPES = [
  '',
  'HONEYPOT_TRIGGERED',
  'BRUTE_FORCE_DETECTED',
  'RATE_LIMIT_EXCEEDED',
  'MALICIOUS_PAYLOAD',
  'SUSPICIOUS_REQUEST',
  'SUSPICIOUS_USER_AGENT',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'IP_BLOCKED',
  'UNAUTHORIZED_ACCESS'
] as const;

const DOUGHNUT_COLORS: Record<string, string> = {
  HONEYPOT: '#dc2626',
  BRUTE_FORCE: '#ea580c',
  RATE_LIMIT: '#ca8a04',
  XSS: '#2563eb',
  SQL_INJECTION: '#1d4ed8',
  MALICIOUS_PAYLOAD: '#6366f1',
  SUSPICIOUS_ACTIVITY: '#64748b'
};

type TrendRangeKey = 'week' | 'month' | 'quarter' | 'half';

interface TrendRange {
  key: TrendRangeKey;
  label: string;
  days: number;
  /** Au-delà d'un mois, un point par semaine : 180 points quotidiens seraient illisibles. */
  bucket: 'day' | 'week';
}

const TREND_RANGES: TrendRange[] = [
  { key: 'week', label: 'Semaine', days: 7, bucket: 'day' },
  { key: 'month', label: 'Mois', days: 30, bucket: 'day' },
  { key: 'quarter', label: '3 mois', days: 91, bucket: 'week' },
  { key: 'half', label: '6 mois', days: 182, bucket: 'week' }
];

@Component({
  selector: 'app-admin-alerts',
  templateUrl: './admin-alerts.component.html',
  styleUrls: ['./admin-alerts.component.css']
})
export class AdminAlertsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('lineCanvas') lineCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('doughnutCanvas') doughnutCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('barCanvas') barCanvas?: ElementRef<HTMLCanvasElement>;

  loading = true;
  error: string | null = null;
  dashboard: AdminSecurityDashboard | null = null;
  alerts: AdminAlert[] = [];
  dataProtection: DataProtectionSummary | null = null;
  dataProtectionOpen = false;

  filterType = '';
  filterIp = '';
  filterFrom = '';
  filterTo = '';
  page = 0;
  pageSize = 20;
  totalPages = 0;
  totalElements = 0;

  detailModalOpen = false;
  detailAlert: AdminAlert | null = null;
  detailJsonPretty = '';
  blockingIp: string | null = null;
  expandedKpiKey: string | null = null;

  readonly typeOptions = FILTER_TYPES;
  readonly trendRanges = TREND_RANGES;
  trendRange: TrendRangeKey = 'month';
  /** Total de la période affichée, repris dans le sous-titre du graphique. */
  trendTotal = 0;

  private lineChart?: Chart;
  private doughnutChart?: Chart;
  private barChart?: Chart;
  private chartsReady = false;
  private pendingChartBuild = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private themeSub?: Subscription;

  constructor(
    private adminService: AdminService,
    private router: Router,
    private themeService: ThemeService
  ) {}

  ngOnInit(): void {
    this.loadAll();
    this.refreshTimer = setInterval(() => this.loadAll(false), 60000);
    // Les couleurs des graphiques suivent le thème : on les redessine quand il change.
    this.themeSub = this.themeService.theme$.pipe(skip(1)).subscribe(() => {
      if (this.lineChart || this.doughnutChart || this.barChart) {
        this.buildCharts();
      }
    });
    this.adminService.getDataProtection().subscribe({
      next: (d) => (this.dataProtection = d),
      error: () => (this.dataProtection = null)
    });
  }

  toggleDataProtection(): void {
    this.dataProtectionOpen = !this.dataProtectionOpen;
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    if (this.pendingChartBuild) {
      this.buildCharts();
    }
  }

  ngOnDestroy(): void {
    this.themeSub?.unsubscribe();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.lineChart?.destroy();
    this.doughnutChart?.destroy();
    this.barChart?.destroy();
  }

  loadAll(showSpinner = true): void {
    if (showSpinner) {
      this.loading = true;
    }
    this.error = null;
    this.adminService.getSecurityDashboard().subscribe({
      next: dash => {
        this.dashboard = dash;
        this.scheduleChartBuild();
      },
      error: () => {
        this.error = 'Impossible de charger le tableau de bord sécurité.';
        this.loading = false;
      }
    });
    this.loadAlerts(showSpinner);
  }

  loadAlerts(showSpinner = true): void {
    if (showSpinner) {
      this.loading = true;
    }
    this.adminService
      .getAlertsPage(this.page, this.pageSize, undefined, this.filterType || undefined, this.filterIp, this.filterFrom, this.filterTo)
      .subscribe({
        next: res => {
          this.alerts = res.items ?? [];
          this.totalPages = res.totalPages ?? 0;
          this.totalElements = res.totalElements ?? 0;
          this.page = res.page ?? 0;
          this.loading = false;
        },
        error: () => {
          this.error = 'Impossible de charger les alertes.';
          this.loading = false;
        }
      });
  }

  onFilterChange(): void {
    this.page = 0;
    this.loadAlerts();
  }

  resetFilters(): void {
    this.filterType = '';
    this.filterIp = '';
    this.filterFrom = '';
    this.filterTo = '';
    this.expandedKpiKey = null;
    this.page = 0;
    this.loadAlerts();
  }

  goPage(p: number): void {
    if (p < 0 || p >= this.totalPages) {
      return;
    }
    this.page = p;
    this.loadAlerts(false);
  }

  get activeKpiPanel(): AdminKpiPanel | null {
    if (!this.expandedKpiKey || !this.dashboard?.kpiPanels) {
      return null;
    }
    return this.dashboard.kpiPanels.find(p => p.key === this.expandedKpiKey) ?? null;
  }

  kpiPanel(key: string): AdminKpiPanel | undefined {
    return this.dashboard?.kpiPanels?.find(p => p.key === key);
  }

  /** Listes du panneau de détail, vides plutôt que nulles si l'API omet le champ. */
  get blockedIpDetails(): AdminBlockedIpDetail[] {
    return this.dashboard?.blockedIps ?? [];
  }

  get panelItems(): AdminKpiPanelItem[] {
    return this.activeKpiPanel?.items ?? [];
  }

  kpiHover(key: string): string {
    return this.kpiPanel(key)?.hoverDescription ?? '';
  }

  toggleKpiPanel(key: string): void {
    this.expandedKpiKey = this.expandedKpiKey === key ? null : key;
  }

  closeKpiPanel(): void {
    this.expandedKpiKey = null;
  }

  filterTableByKpi(key: string): void {
    const map: Record<string, string> = {
      brute: 'BRUTE_FORCE_DETECTED',
      honeypot: 'HONEYPOT_TRIGGERED',
      ratelimit: 'RATE_LIMIT_EXCEEDED',
      xsssql: 'MALICIOUS_PAYLOAD'
    };
    this.filterType = map[key] ?? '';
    this.page = 0;
    this.loadAlerts(false);
  }

  unblockFromPanel(entry: AdminBlockedIpDetail, event: Event): void {
    event.stopPropagation();
    this.adminService.unblockIp(entry.ip).subscribe({
      next: () => this.loadAll(false)
    });
  }

  /** Même action que unblockFromPanel, depuis une ligne du journal des alertes. */
  unblockIpFromRow(alert: AdminAlert, event: Event): void {
    event.stopPropagation();
    const ip = alert.ipAddress?.trim();
    if (!ip) {
      return;
    }
    this.blockingIp = ip;
    this.adminService.unblockIp(ip).subscribe({
      next: () => this.afterIpChange(),
      error: () => (this.blockingIp = null)
    });
  }

  typeLabel(type: string): string {
    return ALERT_TYPE_LABELS[type] ?? type;
  }

  typeSeverity(type: string): 'critical' | 'warning' | 'info' | 'neutral' {
    switch (type) {
      case 'HONEYPOT_TRIGGERED':
      case 'IP_BLOCKED':
      case 'ACCOUNT_LOCKED':
        return 'critical';
      case 'BRUTE_FORCE_DETECTED':
      case 'RATE_LIMIT_EXCEEDED':
      case 'MALICIOUS_PAYLOAD':
      case 'SUSPICIOUS_REQUEST':
      case 'SUSPICIOUS_USER_AGENT':
        return 'warning';
      case 'LOGIN_FAILED':
      case 'UNAUTHORIZED_ACCESS':
        return 'info';
      default:
        return 'neutral';
    }
  }

  formatDescription(alert: AdminAlert): string {
    const ip = this.formatIp(alert.ipAddress);
    const path = this.extractPath(alert.message);
    if (path) {
      return `${path} — ${this.typeLabel(alert.type)} par ${ip}`;
    }
    return alert.message;
  }

  formatDate(value: string | number[] | null | undefined): string {
    const d = this.parseDate(value);
    if (!d) {
      return '—';
    }
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatPanelDate(value: string | number[] | null | undefined): string {
    return this.formatDate(value);
  }

  formatIp(ip?: string | null): string {
    return ip?.trim() || '—';
  }

  openDetails(alert: AdminAlert, event: Event): void {
    event.stopPropagation();
    this.detailAlert = alert;
    this.detailJsonPretty = this.buildDetailJson(alert);
    this.detailModalOpen = true;
  }

  closeDetails(): void {
    this.detailModalOpen = false;
    this.detailAlert = null;
    this.detailJsonPretty = '';
  }

  blockIpFromRow(alert: AdminAlert, event: Event): void {
    event.stopPropagation();
    const ip = alert.ipAddress?.trim();
    if (!ip) {
      return;
    }
    this.blockingIp = ip;
    this.adminService.blockIp(ip, `Blocage manuel depuis alerte ${this.typeLabel(alert.type)}`, 60).subscribe({
      next: () => this.afterIpChange(),
      error: () => (this.blockingIp = null)
    });
  }

  /** La liste des IP bloquées vient du tableau de bord : on le recharge après chaque (dé)blocage. */
  private afterIpChange(): void {
    this.blockingIp = null;
    this.loadAll(false);
  }

  isIpBlocked(ip?: string | null): boolean {
    if (!ip) {
      return false;
    }
    return this.blockedIpDetails.some(b => b.ip === ip && b.currentlyActive !== false);
  }

  markRead(alert: AdminAlert, event: Event): void {
    event.stopPropagation();
    if (alert.status === 'LUE') {
      return;
    }
    this.adminService.markAlertRead(alert.id).subscribe({
      next: updated => {
        alert.status = updated.status;
      }
    });
  }

  remove(alert: AdminAlert, event: Event): void {
    event.stopPropagation();
    if (!confirm('Supprimer cette alerte ?')) {
      return;
    }
    this.adminService.deleteAlert(alert.id).subscribe({
      next: () => {
        this.loadAll(false);
      }
    });
  }

  openUser(alert: AdminAlert): void {
    if (alert.relatedUserId) {
      this.router.navigate(['/admin/users', alert.relatedUserId]);
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
    if (!this.dashboard) {
      return;
    }
    this.buildLineChart();
    this.buildDoughnutChart();
    this.buildBarChart();
  }

  get activeTrendRange(): TrendRange {
    return TREND_RANGES.find(r => r.key === this.trendRange) ?? TREND_RANGES[1];
  }

  get trendSubtitle(): string {
    const r = this.activeTrendRange;
    const period = { week: '7 derniers jours', month: '30 derniers jours', quarter: '3 derniers mois', half: '6 derniers mois' }[r.key];
    const unit = r.bucket === 'day' ? 'par jour' : 'par semaine';
    return `${this.trendTotal} alerte(s) sur les ${period}, ${unit}. Survolez un point pour le détail.`;
  }

  setTrendRange(key: TrendRangeKey): void {
    if (key === this.trendRange) {
      return;
    }
    this.trendRange = key;
    this.buildLineChart();
  }

  /**
   * Série du graphique pour la période choisie. L'API renvoie un point par jour depuis la
   * première alerte : les jours antérieurs sont complétés à 0, puis regroupés par semaine
   * (du lundi au dimanche) pour 3 et 6 mois.
   */
  private trendSeries(): { labels: string[]; data: number[]; titles: string[]; tooltips: string[] } {
    const range = this.activeTrendRange;
    const byDay = new Map<string, { count: number; tooltip: string }>();
    for (const p of this.dashboard?.hourlyTrend ?? []) {
      byDay.set(p.hour, { count: p.count, tooltip: p.tooltip });
    }
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const short = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (range.days - 1));

    const days: { date: Date; count: number; tooltip: string }[] = [];
    for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const point = byDay.get(dayKey(d));
      days.push({ date: new Date(d), count: point?.count ?? 0, tooltip: point?.tooltip ?? '' });
    }
    this.trendTotal = days.reduce((sum, d) => sum + d.count, 0);

    if (range.bucket === 'day') {
      return {
        labels: days.map(d => short(d.date)),
        data: days.map(d => d.count),
        titles: days.map(d => d.date.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })),
        tooltips: days.map(d => (d.count ? d.tooltip : 'Aucune alerte ce jour-là.'))
      };
    }

    const weeks: { from: Date; to: Date; days: typeof days }[] = [];
    for (const day of days) {
      const monday = new Date(day.date);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const last = weeks[weeks.length - 1];
      if (last && last.from.getTime() === monday.getTime()) {
        last.days.push(day);
        last.to = day.date;
      } else {
        weeks.push({ from: monday, to: day.date, days: [day] });
      }
    }
    return {
      labels: weeks.map(w => short(w.from)),
      data: weeks.map(w => w.days.reduce((sum, d) => sum + d.count, 0)),
      titles: weeks.map(w => `Semaine du ${short(w.from)} au ${short(w.to)}`),
      tooltips: weeks.map(w => {
        const total = w.days.reduce((sum, d) => sum + d.count, 0);
        if (!total) {
          return 'Aucune alerte cette semaine.';
        }
        const peak = w.days.reduce((a, b) => (b.count > a.count ? b : a));
        const active = w.days.filter(d => d.count > 0).length;
        return `${active} jour(s) avec alertes. Jour le plus chargé : ${short(peak.date)} (${peak.count} alerte(s)).`;
      })
    };
  }

  private buildLineChart(): void {
    const canvas = this.lineCanvas?.nativeElement;
    if (!canvas || !this.dashboard) {
      return;
    }
    this.lineChart?.destroy();
    const { labels, data, titles, tooltips } = this.trendSeries();
    const pal = adminChartPalette(this.themeService.current);

    this.lineChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Alertes de sécurité',
          data,
          borderColor: pal.ink,
          backgroundColor: pal.inkFill,
          borderWidth: 2,
          pointBackgroundColor: pal.accent,
          pointRadius: 3,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: pal.tooltipBg,
            padding: 14,
            callbacks: {
              title: items => titles[items[0]?.dataIndex ?? 0] ?? '',
              label: ctx => ` ${ctx.parsed.y} alerte(s)`,
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0;
                const text = tooltips[idx];
                return text ? this.wrapTooltip(text) : [];
              }
            }
          }
        },
        scales: {
          x: { grid: { color: pal.grid }, ticks: { maxTicksLimit: 12, color: pal.tick } },
          y: { beginAtZero: true, ticks: { stepSize: 1, color: pal.tick }, grid: { color: pal.grid } }
        }
      }
    });
  }

  private buildDoughnutChart(): void {
    const canvas = this.doughnutCanvas?.nativeElement;
    if (!canvas || !this.dashboard) {
      return;
    }
    this.doughnutChart?.destroy();
    const slices = this.dashboard.typeDistribution ?? [];
    const labels = slices.map(s => s.label);
    const data = slices.map(s => s.count);
    const colors = slices.map(s => DOUGHNUT_COLORS[s.type] ?? '#94a3b8');
    const tooltips = slices.map(s => s.tooltip);
    const pal = adminChartPalette(this.themeService.current);

    this.doughnutChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: pal.surface,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, padding: 14, color: pal.label }
          },
          tooltip: {
            backgroundColor: pal.tooltipBg,
            padding: 14,
            callbacks: {
              label: ctx => ` ${ctx.label} : ${ctx.parsed} alerte(s)`,
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0;
                const text = tooltips[idx];
                return text ? this.wrapTooltip(text) : [];
              }
            }
          }
        }
      }
    });
  }

  private buildBarChart(): void {
    const canvas = this.barCanvas?.nativeElement;
    if (!canvas || !this.dashboard) {
      return;
    }
    this.barChart?.destroy();
    const top = this.dashboard.topIps ?? [];
    const labels = top.map(t => t.ip);
    const data = top.map(t => t.count);
    const tooltips = top.map(t => t.tooltip);
    const pal = adminChartPalette(this.themeService.current);

    this.barChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Alertes',
          data,
          backgroundColor: pal.accentBar,
          borderRadius: 6,
          maxBarThickness: 48
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: pal.tooltipBg,
            padding: 14,
            callbacks: {
              label: ctx => ` ${ctx.parsed.x} alerte(s)`,
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0;
                const text = tooltips[idx];
                return text ? this.wrapTooltip(text) : [];
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, color: pal.tick }, grid: { color: pal.grid } },
          y: { ticks: { color: pal.label, font: { family: 'monospace' } }, grid: { display: false } }
        }
      }
    });
  }

  private wrapTooltip(text: string): string[] {
    const max = 72;
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > max) {
        if (line) {
          lines.push(line);
        }
        line = w;
      } else {
        line = next;
      }
    }
    if (line) {
      lines.push(line);
    }
    return lines;
  }

  private buildDetailJson(alert: AdminAlert): string {
    if (alert.detailsJson) {
      try {
        return JSON.stringify(JSON.parse(alert.detailsJson), null, 2);
      } catch {
        return alert.detailsJson;
      }
    }
    return JSON.stringify(
      {
        id: alert.id,
        type: alert.type,
        message: alert.message,
        ipAddress: alert.ipAddress,
        relatedUsername: alert.relatedUsername,
        createdAt: this.formatDate(alert.createdAt)
      },
      null,
      2
    );
  }

  private extractPath(message: string): string {
    const match = message.match(/(?:GET|POST|PUT|DELETE|PATCH)\s+(\S+)/);
    return match?.[1] ?? '';
  }

  private parseDate(value: string | number[] | null | undefined): Date | null {
    if (!value) {
      return null;
    }
    if (Array.isArray(value)) {
      const [y, m, d, h = 0, min = 0, s = 0] = value;
      return new Date(y, m - 1, d, h, min, s);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
