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
  AdminAuditDashboard,
  AdminAuditPage,
  AdminAuditStats,
  AdminKpiPanel,
  AdminKpiPanelItem,
  AdminService
} from '../../services/admin/admin.service';
import { ThemeService } from '../../services/ui/theme.service';
import { adminChartPalette } from '../shared/admin-chart-palette';

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
  PASSWORD_CHANGED: 'Mot de passe modifié',
  EMAIL_CHANGED: 'E-mail modifié',
  ACCOUNT_LOCKED: 'Verrouillage compte',
  SUSPICIOUS_ACTIVITY: 'Activité suspecte',
  IP_BLOCKED: 'IP bloquée',
  TWO_FACTOR_ENABLED: '2FA activée',
  TWO_FACTOR_DISABLED: '2FA désactivée',
  TWO_FACTOR_FAILED: '2FA échouée',
  TWO_FACTOR_METHOD_CHANGED: 'Méthode 2FA changée'
};

const ACTION_GROUPS: { label: string; actions: string[] }[] = [
  { label: 'Connexions', actions: ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'TWO_FACTOR_FAILED'] },
  {
    label: 'Compte utilisateur',
    actions: ['PASSWORD_CHANGED', 'EMAIL_CHANGED', 'ACCOUNT_ACTIVATED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_METHOD_CHANGED']
  },
  {
    label: 'Cycle de vie du compte',
    actions: ['ACCOUNT_CREATED', 'ACCOUNT_DELETED', 'ACTIVATION_EMAIL_SENT']
  },
  {
    label: 'Administration compte',
    actions: ['ACCOUNT_ENABLED', 'ACCOUNT_DISABLED', 'ADMIN_PASSWORD_RESET', 'ADMIN_EMAIL_CHANGED']
  },
  {
    label: 'Sécurité',
    actions: ['SUSPICIOUS_ACTIVITY', 'IP_BLOCKED']
  }
];

const FAILURE_ACTIONS = new Set([
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DELETED',
  'ACCOUNT_DISABLED',
  'SUSPICIOUS_ACTIVITY',
  'IP_BLOCKED',
  'TWO_FACTOR_FAILED'
]);

@Component({
  selector: 'app-admin-audit',
  templateUrl: './admin-audit.component.html',
  styleUrls: ['./admin-audit.component.css']
})
export class AdminAuditComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('topUsersCanvas') topUsersCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('loginCompareCanvas') loginCompareCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('adminVsUsersCanvas') adminVsUsersCanvas?: ElementRef<HTMLCanvasElement>;

  page: AdminAuditPage | null = null;
  stats: AdminAuditStats | null = null;
  dashboard: AdminAuditDashboard | null = null;
  loading = true;
  error: string | null = null;
  currentPage = 0;
  pageSize = 20;

  filterAction = '';
  filterSearch = '';
  filterDateFrom = '';
  filterDateTo = '';
  filterPerformedBy = '';
  filterLoginOutcome = '';
  blockingIp: string | null = null;
  /** IP bloquées depuis cette page, pour remplacer le bouton par « bloquée ». */
  private readonly blockedIps = new Set<string>();
  exploreContext: string | null = null;
  expandedKpiKey: string | null = null;

  readonly actionGroups = ACTION_GROUPS;

  private topUsersChart?: Chart;
  private loginChart?: Chart;
  private adminVsChart?: Chart;
  private chartsReady = false;
  private pendingChartBuild = false;
  private themeSub?: Subscription;

  constructor(
    private adminService: AdminService,
    private router: Router,
    private themeService: ThemeService
  ) {}

  ngOnInit(): void {
    this.loadStats();
    this.loadDashboard();
    this.load();
    // Les couleurs des graphiques suivent le thème : on les redessine quand il change.
    this.themeSub = this.themeService.theme$.pipe(skip(1)).subscribe(() => {
      if (this.topUsersChart || this.loginChart || this.adminVsChart) {
        this.buildCharts();
      }
    });
  }

  ngAfterViewInit(): void {
    this.chartsReady = true;
    if (this.pendingChartBuild) {
      setTimeout(() => this.buildCharts(), 0);
    }
  }

  ngOnDestroy(): void {
    this.themeSub?.unsubscribe();
    this.topUsersChart?.destroy();
    this.loginChart?.destroy();
    this.adminVsChart?.destroy();
  }

  loadStats(): void {
    this.adminService.getAuditStats().subscribe({
      next: s => (this.stats = s),
      error: () => {}
    });
  }

  loadDashboard(): void {
    this.adminService.getAuditDashboard().subscribe({
      next: d => {
        this.dashboard = d;
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
      this.filterDateTo || undefined,
      undefined,
      this.filterPerformedBy || undefined,
      undefined,
      undefined,
      this.filterLoginOutcome || undefined
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

  refresh(): void {
    this.loadStats();
    this.loadDashboard();
    this.load(this.currentPage);
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

  /** Seules les actions d'échec ou de sécurité sont mises en évidence (texte rouge) ; le reste reste neutre. */
  isFailure(action: string): boolean {
    return FAILURE_ACTIONS.has(action);
  }

  /** Pourcentage arrondi à une décimale (l'API renvoie la valeur brute, ex. 5.647058823529412). */
  percent(value: number | null | undefined): string {
    if (value == null || isNaN(value)) return '…';
    return value.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
  }

  formatIp(ip: string | null | undefined): string {
    return ip?.trim() || '—';
  }

  formatDate(value: string | number[] | null | undefined): string {
    const d = this.parseDate(value);
    return d ? d.toLocaleString('fr-FR') : '—';
  }

  formatDay(value: string | number[] | null | undefined): string {
    const d = this.parseDate(value);
    return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  formatTime(value: string | number[] | null | undefined): string {
    const d = this.parseDate(value);
    return d ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  }

  get activeKpiPanel(): AdminKpiPanel | null {
    if (!this.expandedKpiKey || !this.dashboard?.kpiPanels) {
      return null;
    }
    return this.dashboard.kpiPanels.find(p => p.key === this.expandedKpiKey) ?? null;
  }

  /** Lignes du panneau de détail, vides plutôt que nulles si l'API omet le champ. */
  get panelItems(): AdminKpiPanelItem[] {
    return this.activeKpiPanel?.items ?? [];
  }

  kpiPanel(key: string): AdminKpiPanel | undefined {
    return this.dashboard?.kpiPanels?.find(p => p.key === key);
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
    const map: Record<string, () => void> = {
      total: () => { this.filterAction = ''; this.filterLoginOutcome = ''; },
      loginRate: () => { this.filterAction = ''; this.filterLoginOutcome = ''; },
      activeUsers: () => { this.filterDateFrom = this.isoDateDaysAgo(1); },
      adminActions: () => { this.filterAction = 'ADMIN_PASSWORD_RESET'; },
      suspicious: () => {
        this.filterAction = '';
        this.filterLoginOutcome = 'FAILED';
      },
      loginSuccess: () => { this.filterAction = 'LOGIN_SUCCESS'; this.filterLoginOutcome = 'SUCCESS'; },
      loginFailed: () => { this.filterAction = 'LOGIN_FAILED'; this.filterLoginOutcome = 'FAILED'; },
      adminShare: () => { this.filterAction = 'ADMIN_PASSWORD_RESET'; }
    };
    map[key]?.();
    this.exploreContext = this.kpiPanel(key)?.title ?? null;
    this.load(0);
  }

  /**
   * Découpe les détails autour de la première adresse IP pour la rendre cliquable.
   * IPv6 : au moins deux « : », sinon de simples mots hexadécimaux (« de », « a »…) seraient pris pour une IP.
   */
  detailParts(details?: string | null): { before: string; ip: string; after: string } | null {
    if (!details) return null;
    const m = details.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}/);
    if (!m || m.index == null) return null;
    return {
      before: details.slice(0, m.index),
      ip: m[0],
      after: details.slice(m.index + m[0].length)
    };
  }

  filterByAction(action: string, event?: Event): void {
    event?.stopPropagation();
    this.filterAction = action;
    this.exploreContext = `Action : ${this.actionLabel(action)}`;
    this.load(0);
  }

  filterByIp(ip: string, event?: Event): void {
    event?.stopPropagation();
    this.filterSearch = ip.replace(/\s*\([^)]+\)/, '').trim();
    this.exploreContext = `IP : ${ip}`;
    this.load(0);
  }

  filterByPerformedBy(username: string): void {
    this.filterPerformedBy = username;
    this.exploreContext = `Utilisateur : ${username}`;
    this.load(0);
  }

  /** Affiche les connexions des dernières 24 h (réussies et échouées), comme le graphique. */
  exploreLoginComparison(): void {
    this.filterAction = '';
    this.filterLoginOutcome = '';
    this.filterPerformedBy = '';
    this.filterSearch = '';
    this.filterDateFrom = this.isoDateDaysAgo(1);
    this.filterDateTo = '';
    this.exploreContext = 'Connexions des dernières 24 h';
    this.load(0);
  }

  onTopUserClick(index: number): void {
    const user = this.dashboard?.topUsers?.[index];
    if (user) {
      this.filterByPerformedBy(user.username);
    }
  }

  onFilterChange(): void {
    this.load(0);
  }

  clearFilters(): void {
    this.filterAction = '';
    this.filterSearch = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterPerformedBy = '';
    this.filterLoginOutcome = '';
    this.exploreContext = null;
    this.expandedKpiKey = null;
    this.load(0);
  }

  private isoDateDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  openUser(entry: { userId?: string | null; username?: string | null }): void {
    if (entry.userId) {
      this.router.navigate(['/admin/users', entry.userId]);
    }
  }

  /** L'IP journalisée peut porter un suffixe « (pays) » : on ne garde que l'adresse. */
  cleanIp(ip: string | null | undefined): string {
    return ip?.replace(/\s*\([^)]+\)/, '').trim() ?? '';
  }

  isBlocked(ip: string | null | undefined): boolean {
    return this.blockedIps.has(this.cleanIp(ip));
  }

  blockIp(ip: string | null | undefined, event: Event): void {
    event.stopPropagation();
    const clean = this.cleanIp(ip);
    if (!clean) return;
    this.blockingIp = clean;
    this.adminService.blockIp(clean, 'Blocage manuel depuis journal d\'audit', 60).subscribe({
      next: () => {
        this.blockedIps.add(clean);
        this.blockingIp = null;
      },
      error: () => (this.blockingIp = null)
    });
  }

  prevPage(): void {
    if (this.currentPage > 0) this.load(this.currentPage - 1);
  }

  nextPage(): void {
    if (this.page && this.currentPage < this.page.totalPages - 1) {
      this.load(this.currentPage + 1);
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
    if (!this.dashboard) return;
    this.buildTopUsersChart();
    this.buildLoginCompareChart();
    this.buildAdminVsUsersChart();
  }

  private buildTopUsersChart(): void {
    const canvas = this.topUsersCanvas?.nativeElement;
    if (!canvas || !this.dashboard) return;
    this.topUsersChart?.destroy();
    const users = this.dashboard.topUsers ?? [];
    const labels = users.map(u => u.username);
    const data = users.map(u => u.count);
    const tooltips = users.map(u => u.tooltip);
    const pal = adminChartPalette(this.themeService.current);

    this.topUsersChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Actions audit',
          data,
          backgroundColor: pal.accentBar,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        onClick: (_e, items) => {
          if (items[0]?.index != null) this.onTopUserClick(items[0].index);
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: pal.tooltipBg,
            padding: 12,
            callbacks: {
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0;
                return this.wrapTooltip(tooltips[idx] ?? '');
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, color: pal.tick }, grid: { color: pal.grid } },
          y: { ticks: { color: pal.label }, grid: { color: pal.grid } }
        }
      }
    });
  }

  private buildLoginCompareChart(): void {
    const canvas = this.loginCompareCanvas?.nativeElement;
    if (!canvas || !this.dashboard) return;
    this.loginChart?.destroy();
    const points = this.dashboard.loginComparison ?? [];
    const labels = points.map(p => {
      const d = new Date(p.hour);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    });
    const tooltips = points.map(p => p.tooltip);
    const pal = adminChartPalette(this.themeService.current);

    this.loginChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Succès',
            data: points.map(p => p.success),
            backgroundColor: pal.success,
            borderRadius: 4
          },
          {
            label: 'Échecs',
            data: points.map(p => p.failed),
            backgroundColor: pal.danger,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: pal.label } },
          tooltip: {
            backgroundColor: pal.tooltipBg,
            padding: 12,
            callbacks: {
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0;
                return this.wrapTooltip(tooltips[idx] ?? '');
              }
            }
          }
        },
        scales: {
          x: { stacked: false, ticks: { maxTicksLimit: 12, color: pal.tick }, grid: { color: pal.grid } },
          y: { beginAtZero: true, ticks: { stepSize: 1, color: pal.tick }, grid: { color: pal.grid } }
        }
      }
    });
  }

  private buildAdminVsUsersChart(): void {
    const canvas = this.adminVsUsersCanvas?.nativeElement;
    if (!canvas || !this.dashboard) return;
    this.adminVsChart?.destroy();
    const av = this.dashboard.adminVsUsers;
    if (!av) return;
    const pal = adminChartPalette(this.themeService.current);

    this.adminVsChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Admin', 'Utilisateurs'],
        datasets: [{
          data: [av.adminActions, av.userActions],
          backgroundColor: [pal.ink, pal.accent],
          borderWidth: 2,
          borderColor: pal.surface,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        animation: { animateRotate: true, duration: 800 },
        plugins: {
          legend: { position: 'bottom', labels: { color: pal.label } },
          tooltip: {
            backgroundColor: pal.tooltipBg,
            padding: 12,
            callbacks: {
              label: ctx => ` ${ctx.label} : ${ctx.parsed}`,
              afterBody: items => {
                const idx = items[0]?.dataIndex ?? 0;
                return this.wrapTooltip(idx === 0 ? av.adminTooltip : av.userTooltip);
              }
            }
          }
        }
      }
    });
  }

  private wrapTooltip(text: string): string[] {
    if (!text) return [];
    const max = 70;
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > max) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
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
