import {
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import Chart from 'chart.js/auto';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import {
  AppDeployment,
  AppServiceModel,
  DeploymentMonitorAlert,
  DeploymentMonitoringResponse,
  DeploymentPodInfo,
  DeploymentQuotaInfo,
  MonitoringEvent,
  MonitoringServiceInfo,
  MonitoringWorkload
} from '../../models/application-management/application-management.models';

interface HistoryPoint {
  t: string;
  cpuMilli: number;
  memMi: number;
  netRx: number;
  netTx: number;
  fsUsedMi: number;
}

const HISTORY_MAX = 30;
const POLL_MS = 15000;

@Component({
  selector: 'app-monitoring-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './monitoring-dashboard.component.html',
  styleUrls: ['./monitoring-dashboard.component.css', '../shared/app-management.shared.css']
})
export class MonitoringDashboardComponent implements OnChanges, OnDestroy {
  @Input() appId!: string;
  @Input() deployment!: AppDeployment;
  @Input() appName = '';
  /** Services de l'app — filtre workload (annexe §5). */
  @Input() appServices: AppServiceModel[] = [];

  @ViewChild('cpuTimeCanvas') cpuTimeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('memTimeCanvas') memTimeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('netTimeCanvas') netTimeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('cpuBarCanvas') cpuBarCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('memBarCanvas') memBarCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('diskBarCanvas') diskBarCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('readyCanvas') readyCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('restartCanvas') restartCanvas?: ElementRef<HTMLCanvasElement>;

  loading = false;
  error: string | null = null;
  data: DeploymentMonitoringResponse | null = null;
  lastRefresh: Date | null = null;
  /** live = poll 15s ; 24h / 7d = historique DB. */
  rangeMode: 'live' | '24h' | '7d' = 'live';
  historyLoading = false;

  filter = '';
  /** Filtre par nom de service (match workload). */
  serviceFilter = '';
  selectedPod: string | null = null;
  selectedPodWorkload: string | null = null;
  logs = '';
  logsLoading = false;
  logsError: string | null = null;
  logsActualPod: string | null = null;
  /** Panneau événements récents (repliable). */
  eventsOpen = false;

  private poll?: Subscription;
  private history: HistoryPoint[] = [];
  private renderTimer?: ReturnType<typeof setTimeout>;
  private rendering = false;
  private visibilityBound = () => this.onVisibilityChange();

  private cpuTimeChart?: Chart;
  private memTimeChart?: Chart;
  private netTimeChart?: Chart;
  private cpuBarChart?: Chart;
  private memBarChart?: Chart;
  private diskBarChart?: Chart;
  private readyChart?: Chart;
  private restartChart?: Chart;
  private prevNetRx = 0;
  private prevNetTx = 0;
  private prevNetAt = 0;

  constructor(
    private api: ApplicationManagementService,
    private zone: NgZone
  ) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityBound);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['deployment'] || changes['appId']) {
      this.stopPoll();
      this.destroyCharts();
      this.data = null;
      this.closeLogs();
      this.history = this.loadHistory();
      this.rangeMode = 'live';
      if (this.appId && this.deployment?.id && !this.isInactive) {
        this.refresh();
        this.startLivePoll();
      }
    }
  }

  setRange(mode: 'live' | '24h' | '7d'): void {
    if (this.rangeMode === mode) return;
    this.rangeMode = mode;
    this.stopPoll();
    if (mode === 'live') {
      this.history = this.loadHistory();
      this.refresh();
      this.startLivePoll();
    } else {
      this.loadServerHistory(mode);
    }
  }

  private onVisibilityChange(): void {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      this.stopPoll();
      return;
    }
    if (this.rangeMode !== 'live' || this.isInactive || !this.appId || !this.deployment?.id) return;
    this.refresh();
    this.startLivePoll();
  }

  private startLivePoll(): void {
    this.stopPoll();
    if (typeof document !== 'undefined' && document.hidden) return;
    if (this.rangeMode !== 'live' || this.isInactive) return;
    this.zone.runOutsideAngular(() => {
      this.poll = interval(POLL_MS)
        .pipe(switchMap(() => this.api.getDeploymentMonitoring(this.appId, this.deployment.id)))
        .subscribe({
          next: (res) => this.zone.run(() => this.apply(res)),
          error: () => { /* keep last */ }
        });
    });
  }

  private loadServerHistory(mode: '24h' | '7d'): void {
    if (!this.appId || !this.deployment?.id) return;
    this.historyLoading = true;
    const hours = mode === '7d' ? 24 * 7 : 24;
    const from = new Date(Date.now() - hours * 3600_000).toISOString();
    this.api.getMetricsHistory(this.appId, this.deployment.id, from).subscribe({
      next: (res) => {
        this.historyLoading = false;
        const raw = (res.points || []).map((p) => ({
          t: p.t,
          cpuMilli: p.cpuMilli ?? 0,
          memMi: p.memMi ?? (p.memBytes != null ? p.memBytes / (1024 * 1024) : 0),
          netRx: Number(p.netRx ?? 0) || 0,
          netTx: Number(p.netTx ?? 0) || 0,
          fsUsedMi: p.fsUsed != null ? p.fsUsed / (1024 * 1024) : 0
        }));
        this.history = this.convertCumulativeNetToRates(raw);
        this.scheduleCharts();
        // Garde aussi un snapshot live pour KPIs / pods
        this.refresh();
      },
      error: () => {
        this.historyLoading = false;
        this.error = 'Impossible de charger l\'historique métriques.';
      }
    });
  }

  /**
   * Les samples DB stockent des compteurs cumulés (bytes) ; les charts live
   * affichent un débit (bytes/s). Convertit les points serveur en rates.
   */
  private convertCumulativeNetToRates(points: HistoryPoint[]): HistoryPoint[] {
    if (!points.length) return [];
    const out: HistoryPoint[] = [{ ...points[0], netRx: 0, netTx: 0 }];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const t0 = Date.parse(prev.t);
      const t1 = Date.parse(cur.t);
      const dt = Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0
        ? (t1 - t0) / 1000
        : 300; // fallback ~sampler 5 min
      const rxRate = Math.max(0, (cur.netRx - prev.netRx) / dt);
      const txRate = Math.max(0, (cur.netTx - prev.netTx) / dt);
      out.push({
        ...cur,
        netRx: rxRate,
        netTx: txRate,
        t: this.formatHistoryLabel(cur.t)
      });
    }
    if (out.length) {
      out[0] = { ...out[0], t: this.formatHistoryLabel(points[0].t) };
    }
    return out;
  }

  private formatHistoryLabel(isoOrLabel: string): string {
    const ms = Date.parse(isoOrLabel);
    if (!Number.isFinite(ms)) return isoOrLabel;
    return new Date(ms).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityBound);
    }
    this.stopPoll();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.destroyCharts();
  }

  get isInactive(): boolean {
    return this.deployment?.status === 'STOPPED' || this.deployment?.status === 'FAILED';
  }

  get metricsAvailable(): boolean {
    return this.data?.summary?.metricsAvailable === true;
  }

  get expiresAtLabel(): string | null {
    const raw = this.data?.expiresAt || this.deployment?.expiresAt;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  get checkedAtLabel(): string | null {
    const raw = this.data?.checkedAt;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  get showNetChart(): boolean {
    if (this.rangeMode === 'live') return true;
    return this.history.some(h => h.netRx > 0 || h.netTx > 0);
  }

  get pods(): DeploymentPodInfo[] {
    let all = this.data?.pods || [];
    const sf = this.serviceFilter.trim().toLowerCase();
    if (sf) {
      all = all.filter(p => {
        const wl = (p.workload || p.name || '').toLowerCase();
        return wl.includes(sf);
      });
    }
    const q = this.filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter(p =>
      (p.name || '').toLowerCase().includes(q)
      || (p.workload || '').toLowerCase().includes(q)
      || (p.phase || '').toLowerCase().includes(q)
      || (p.node || '').toLowerCase().includes(q)
    );
  }

  get workloads(): MonitoringWorkload[] {
    const fromApi = this.data?.workloads || [];
    let list: MonitoringWorkload[];
    if (fromApi.length) {
      list = fromApi;
    } else {
      const map = new Map<string, MonitoringWorkload>();
      for (const p of this.data?.pods || []) {
        const name = p.workload || p.name;
        const cur = map.get(name) || {
          kind: 'Workload', name, desired: 0, ready: 0, available: 0, updated: 0, healthy: false
        };
        cur.desired++;
        if (p.ready && p.phase === 'Running') cur.ready++;
        cur.available = cur.ready;
        cur.healthy = cur.desired > 0 && cur.ready >= cur.desired;
        map.set(name, cur);
      }
      list = [...map.values()];
    }
    const sf = this.serviceFilter.trim().toLowerCase();
    if (!sf) return list;
    return list.filter(w => (w.name || '').toLowerCase().includes(sf));
  }

  get services(): MonitoringServiceInfo[] {
    return this.data?.services || [];
  }

  get events(): MonitoringEvent[] {
    return this.data?.events || [];
  }

  get alerts(): DeploymentMonitorAlert[] {
    return this.data?.alerts || [];
  }

  get summary() {
    return this.data?.summary;
  }

  get health() {
    return this.data?.health;
  }

  get quota(): DeploymentQuotaInfo | null {
    return this.data?.quota || null;
  }

  get quotaCpuAllocPct(): number {
    const p = this.quota?.pctAllocated?.cpu;
    return p != null ? Math.min(100, Math.round(p * 100)) : 0;
  }

  get quotaMemAllocPct(): number {
    const p = this.quota?.pctAllocated?.memory;
    return p != null ? Math.min(100, Math.round(p * 100)) : 0;
  }

  get quotaCpuActualPct(): number {
    const p = this.quota?.pctActualVsHard?.cpu;
    return p != null ? Math.min(100, Math.round(p * 100)) : 0;
  }

  get quotaMemActualPct(): number {
    const p = this.quota?.pctActualVsHard?.memory;
    return p != null ? Math.min(100, Math.round(p * 100)) : 0;
  }

  formatQuotaCpu(cores: number | null | undefined): string {
    if (cores == null || !Number.isFinite(cores)) return '—';
    if (cores < 1) return Math.round(cores * 1000) + 'm';
    return cores.toFixed(2);
  }

  formatQuotaMem(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    const gi = bytes / (1024 * 1024 * 1024);
    if (gi >= 1) return gi.toFixed(2) + ' Gi';
    return (bytes / (1024 * 1024)).toFixed(0) + ' Mi';
  }

  get readyPct(): number {
    const s = this.summary;
    if (!s || !s.totalPods) return 0;
    return Math.round((s.readyPods / s.totalPods) * 100);
  }

  get cpuTotalLabel(): string {
    const m = this.totalCpuMillicores();
    if (m == null) return '—';
    return this.formatMilli(m);
  }

  get memTotalLabel(): string {
    const mi = this.totalMemMi();
    return mi != null ? (mi < 1 ? (mi * 1024).toFixed(0) + ' Ki' : mi.toFixed(2) + ' Mi') : '—';
  }

  get netRxLabel(): string {
    return this.summary?.totalNetworkRx || this.formatBytesLabel(this.sumField('networkRxBytes')) || '—';
  }

  get netTxLabel(): string {
    return this.summary?.totalNetworkTx || this.formatBytesLabel(this.sumField('networkTxBytes')) || '—';
  }

  get fsLabel(): string {
    return this.summary?.totalFsUsed || this.formatBytesLabel(this.sumField('fsUsedBytes')) || '—';
  }

  private formatMilli(m: number): string {
    if (m < 0.1) return Math.max(1, Math.round(m * 1000)) + 'µ';
    if (m < 10) return m.toFixed(2) + 'm';
    return m.toFixed(1) + 'm';
  }

  private sumField(key: 'networkRxBytes' | 'networkTxBytes' | 'fsUsedBytes'): number {
    let t = 0;
    for (const p of this.data?.pods || []) {
      const v = p[key];
      if (typeof v === 'number') t += v;
    }
    return t;
  }

  private formatBytesLabel(bytes: number): string | null {
    if (!bytes) return null;
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ki';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' Mi';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' Gi';
  }

  get cpuRequestTotalLabel(): string {
    let c = 0;
    for (const p of this.data?.pods || []) {
      if (p.cpuRequest) c += this.parseCpu(p.cpuRequest);
    }
    return c > 0 ? c.toFixed(3) + ' cores' : '—';
  }

  get cpuLimitTotalLabel(): string {
    let c = 0;
    for (const p of this.data?.pods || []) {
      if (p.cpuLimit) c += this.parseCpu(p.cpuLimit);
    }
    return c > 0 ? c.toFixed(3) + ' cores' : '—';
  }

  get memRequestTotalLabel(): string {
    let b = 0;
    for (const p of this.data?.pods || []) {
      if (p.memoryRequest) b += this.parseMemBytes(p.memoryRequest);
    }
    return b > 0 ? (b / (1024 * 1024)).toFixed(0) + ' Mi' : '—';
  }

  get memLimitTotalLabel(): string {
    let b = 0;
    for (const p of this.data?.pods || []) {
      if (p.memoryLimit) b += this.parseMemBytes(p.memoryLimit);
    }
    return b > 0 ? (b / (1024 * 1024)).toFixed(0) + ' Mi' : '—';
  }

  refresh(): void {
    if (!this.appId || !this.deployment?.id) return;
    this.loading = !this.data;
    this.error = null;
    this.api.getDeploymentMonitoring(this.appId, this.deployment.id).subscribe({
      next: (res) => {
        this.apply(res);
        this.loading = false;
      },
      error: (e) => {
        this.error = e?.error?.message || 'Impossible de charger le dashboard monitoring.';
        this.loading = false;
      }
    });
  }

  openLogs(pod: DeploymentPodInfo): void {
    if (!pod?.name) return;
    this.selectedPod = pod.name;
    this.selectedPodWorkload = pod.workload || null;
    this.logsActualPod = null;
    this.logs = '';
    this.logsError = null;
    this.logsLoading = true;
    // Toujours le nom de pod exact (backend résout d'abord withName).
    this.api.getDeploymentLogs(this.appId, this.deployment.id, pod.name, 300).subscribe({
      next: (res) => {
        this.logs = res.logs || '';
        this.logsActualPod = res.pod || pod.name;
        this.logsLoading = false;
      },
      error: (e) => {
        this.logsError = e?.error?.message || 'Logs indisponibles.';
        this.logsLoading = false;
      }
    });
  }

  closeLogs(): void {
    this.selectedPod = null;
    this.selectedPodWorkload = null;
    this.logsActualPod = null;
    this.logs = '';
    this.logsError = null;
  }

  refreshLogs(): void {
    if (!this.selectedPod || !this.data?.pods) return;
    const pod = this.data.pods.find(p => p.name === this.selectedPod);
    if (pod) this.openLogs(pod);
    else this.openLogs({ name: this.selectedPod, workload: this.selectedPodWorkload || undefined } as DeploymentPodInfo);
  }

  healthClass(): string {
    if (!this.health?.checked) return 'md-pill muted';
    if (this.health.ok === true) return 'md-pill ok';
    if (this.health.ok === false) return 'md-pill bad';
    return 'md-pill muted';
  }

  eventClass(type?: string | null): string {
    return type === 'Warning' ? 'md-event warn' : 'md-event';
  }

  /**
   * % usage vs request (pas limit) — les pods idle consomment ~1m sur 100m request = 1%.
   * Avant : vs limit → 0.60m/1000m = 0% arrondi + barre vide (faux "spinner").
   */
  usagePct(kind: 'cpu' | 'mem', p: DeploymentPodInfo): number {
    return this.usageVsRequestPct(kind, p);
  }

  usagePctLabel(kind: 'cpu' | 'mem', p: DeploymentPodInfo): string {
    const pct = this.usageVsRequestPct(kind, p);
    const has = kind === 'cpu' ? this.podCpuMilli(p) > 0 : this.podMemBytes(p) > 0;
    if (!has) return '0%';
    if (pct < 0.1) return '<0.1% req';
    if (pct < 10) return pct.toFixed(1) + '% req';
    return Math.round(pct) + '% req';
  }

  /** Largeur barre : minimum visible si usage > 0 (évite point/spinner à 0%). */
  usageBarWidth(kind: 'cpu' | 'mem', p: DeploymentPodInfo): number {
    const pct = this.usageVsRequestPct(kind, p);
    const has = kind === 'cpu' ? this.podCpuMilli(p) > 0 : this.podMemBytes(p) > 0;
    if (!has) return 0;
    if (pct < 2) return Math.max(2, pct);
    return Math.min(100, pct);
  }

  private usageVsRequestPct(kind: 'cpu' | 'mem', p: DeploymentPodInfo): number {
    if (kind === 'cpu') {
      const usage = this.podCpuMilli(p); // millicores
      const req = p.cpuRequest ? this.parseCpu(p.cpuRequest) * 1000 : 0;
      const lim = p.cpuLimit ? this.parseCpu(p.cpuLimit) * 1000 : 0;
      const base = req > 0 ? req : lim;
      if (base <= 0) return usage > 0 ? 1 : 0;
      return Math.min(100, (usage / base) * 100);
    }
    const usage = this.podMemBytes(p);
    const req = p.memoryRequest ? this.parseMemBytes(p.memoryRequest) : 0;
    const lim = p.memoryLimit ? this.parseMemBytes(p.memoryLimit) : 0;
    const base = req > 0 ? req : lim;
    if (base <= 0) return usage > 0 ? 1 : 0;
    return Math.min(100, (usage / base) * 100);
  }

  private podMemBytes(p: DeploymentPodInfo): number {
    if (typeof p.memoryUsageBytes === 'number') return p.memoryUsageBytes;
    if (p.memoryUsage) return this.parseMemBytes(p.memoryUsage);
    return 0;
  }

  private totalCpuMillicores(): number | null {
    const fromSummary = this.summary?.totalCpuMillicores;
    if (typeof fromSummary === 'number' && !Number.isNaN(fromSummary)) return fromSummary;
    let milli = 0;
    let any = false;
    for (const p of this.data?.pods || []) {
      if (typeof p.cpuUsageMillicores === 'number') {
        milli += p.cpuUsageMillicores;
        any = true;
      } else if (typeof p.cpuUsageCores === 'number') {
        milli += p.cpuUsageCores * 1000;
        any = true;
      } else if (p.cpuUsage) {
        milli += this.parseCpu(p.cpuUsage) * 1000;
        any = true;
      }
    }
    return any ? milli : null;
  }

  private totalCpuCores(): number | null {
    const m = this.totalCpuMillicores();
    return m != null ? m / 1000 : null;
  }

  private totalMemMi(): number | null {
    const fromSummary = this.summary?.totalMemoryMi;
    if (typeof fromSummary === 'number' && !Number.isNaN(fromSummary)) return fromSummary;
    let bytes = 0;
    let any = false;
    for (const p of this.data?.pods || []) {
      if (typeof p.memoryUsageBytes === 'number') {
        bytes += p.memoryUsageBytes;
        any = true;
      } else if (p.memoryUsage) {
        bytes += this.parseMemBytes(p.memoryUsage);
        any = true;
      }
    }
    return any ? bytes / (1024 * 1024) : null;
  }

  private parseCpu(v: string): number {
    const s = v.trim().toLowerCase().replace('µ', 'u');
    if (s.endsWith('u') || s.endsWith('µ')) {
      return parseFloat(s) / 1_000_000;
    }
    if (s.endsWith('n')) return parseFloat(s) / 1_000_000_000;
    if (s.endsWith('m')) return parseFloat(s) / 1000;
    return parseFloat(s) || 0;
  }

  private parseMemBytes(v: string): number {
    const s = v.trim();
    const m = s.match(/^([\d.]+)\s*([KMGTP]?i?B?)$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = (m[2] || '').toUpperCase();
    const mult: Record<string, number> = {
      '': 1, B: 1, K: 1e3, KB: 1e3, KI: 1024, KIB: 1024,
      M: 1e6, MB: 1e6, MI: 1024 ** 2, MIB: 1024 ** 2,
      G: 1e9, GB: 1e9, GI: 1024 ** 3, GIB: 1024 ** 3
    };
    return n * (mult[u] ?? 1);
  }

  private apply(res: DeploymentMonitoringResponse): void {
    this.data = res;
    this.lastRefresh = new Date();
    this.error = null;
    if (this.rangeMode === 'live') {
      this.pushHistory(res);
    }
    this.scheduleCharts();
  }

  private scheduleCharts(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.zone.runOutsideAngular(() => this.renderAllChartsSafe());
    }, 80);
  }

  private pushHistory(res: DeploymentMonitoringResponse): void {
    const cpuMilli = this.computeCpuMilliFromPods(res.pods);
    const mem = this.computeMemMiFromPods(res.pods);
    let rx = 0;
    let tx = 0;
    let fs = 0;
    for (const p of res.pods || []) {
      if (typeof p.networkRxBytes === 'number') rx += p.networkRxBytes;
      if (typeof p.networkTxBytes === 'number') tx += p.networkTxBytes;
      if (typeof p.fsUsedBytes === 'number') fs += p.fsUsedBytes;
    }
    // débit réseau (bytes/s) depuis le sample précédent
    const now = Date.now();
    let rxRate = 0;
    let txRate = 0;
    if (this.prevNetAt > 0 && now > this.prevNetAt) {
      const dt = (now - this.prevNetAt) / 1000;
      rxRate = Math.max(0, (rx - this.prevNetRx) / dt);
      txRate = Math.max(0, (tx - this.prevNetTx) / dt);
    }
    this.prevNetRx = rx;
    this.prevNetTx = tx;
    this.prevNetAt = now;

    if (cpuMilli == null && mem == null && rx === 0 && tx === 0) return;
    const label = new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    this.history.push({
      t: label,
      cpuMilli: cpuMilli ?? 0,
      memMi: mem ?? 0,
      netRx: rxRate,
      netTx: txRate,
      fsUsedMi: fs / (1024 * 1024)
    });
    if (this.history.length > HISTORY_MAX) {
      this.history = this.history.slice(-HISTORY_MAX);
    }
    this.saveHistory();
  }

  private computeCpuMilliFromPods(pods: DeploymentPodInfo[]): number | null {
    let milli = 0;
    let any = false;
    for (const p of pods || []) {
      if (typeof p.cpuUsageMillicores === 'number') {
        milli += p.cpuUsageMillicores;
        any = true;
      } else if (typeof p.cpuUsageCores === 'number') {
        milli += p.cpuUsageCores * 1000;
        any = true;
      } else if (p.cpuUsage) {
        milli += this.parseCpu(p.cpuUsage) * 1000;
        any = true;
      }
    }
    return any ? milli : null;
  }

  private computeMemMiFromPods(pods: DeploymentPodInfo[]): number | null {
    let bytes = 0;
    let any = false;
    for (const p of pods || []) {
      if (typeof p.memoryUsageBytes === 'number') {
        bytes += p.memoryUsageBytes;
        any = true;
      } else if (p.memoryUsage) {
        bytes += this.parseMemBytes(p.memoryUsage);
        any = true;
      }
    }
    return any ? bytes / (1024 * 1024) : null;
  }

  private historyKey(): string {
    return `mon-hist:${this.appId}:${this.deployment?.id}`;
  }

  private loadHistory(): HistoryPoint[] {
    try {
      const raw = sessionStorage.getItem(this.historyKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // ignore ancien format (cpuCores)
      return parsed
        .filter((p: any) => typeof p?.cpuMilli === 'number')
        .slice(-HISTORY_MAX);
    } catch {
      return [];
    }
  }

  private saveHistory(): void {
    try {
      sessionStorage.setItem(this.historyKey(), JSON.stringify(this.history));
    } catch { /* ignore */ }
  }

  private renderAttempts = 0;

  private renderAllChartsSafe(): void {
    if (this.rendering || !this.data) return;
    this.rendering = true;
    try {
      this.ensureCanvas(this.cpuTimeCanvas?.nativeElement);
      this.ensureCanvas(this.memTimeCanvas?.nativeElement);
      this.ensureCanvas(this.netTimeCanvas?.nativeElement);
      this.ensureCanvas(this.cpuBarCanvas?.nativeElement);
      this.ensureCanvas(this.memBarCanvas?.nativeElement);
      this.ensureCanvas(this.diskBarCanvas?.nativeElement);
      this.ensureCanvas(this.readyCanvas?.nativeElement);
      this.ensureCanvas(this.restartCanvas?.nativeElement);

      if (!this.cpuTimeCanvas?.nativeElement) {
        this.rendering = false;
        this.renderAttempts++;
        if (this.renderAttempts < 15) {
          this.renderTimer = setTimeout(() => this.renderAllChartsSafe(), 120);
        }
        return;
      }
      this.renderAttempts = 0;

      const cpuData = this.history.map(h => +h.cpuMilli.toFixed(2));
      const cpuMax = Math.max(...cpuData, 0.5);
      this.upsertLine(
        'cpuTime',
        this.cpuTimeCanvas.nativeElement,
        this.history.map(h => h.t),
        cpuData,
        'CPU (m)',
        '#F97316',
        'rgba(249,115,22,0.12)',
        cpuMax * 1.25
      );
      const memData = this.history.map(h => +h.memMi.toFixed(2));
      const memMax = Math.max(...memData, 1);
      this.upsertLine(
        'memTime',
        this.memTimeCanvas!.nativeElement,
        this.history.map(h => h.t),
        memData,
        'MEM (Mi)',
        '#0369a1',
        'rgba(3,105,161,0.10)',
        memMax * 1.25
      );

      if (this.netTimeCanvas?.nativeElement) {
        this.upsertNetLine(
          this.netTimeCanvas.nativeElement,
          this.history.map(h => h.t),
          this.history.map(h => +(h.netRx / 1024).toFixed(2)),
          this.history.map(h => +(h.netTx / 1024).toFixed(2))
        );
      }

      const pods = this.data.pods || [];
      if (pods.length) {
        const labels = pods.map(p => (p.workload || p.name).slice(0, 16));
        // Usage seul (échelle auto) — les petites valeurs restent visibles
        this.upsertGroupedBar(
          'cpuBar',
          this.cpuBarCanvas!.nativeElement,
          labels,
          [
            {
              label: 'Usage (m)',
              data: pods.map(p => this.podCpuMilli(p)),
              color: '#F97316'
            },
            {
              label: 'Request (m)',
              data: pods.map(p => p.cpuRequest ? +(this.parseCpu(p.cpuRequest) * 1000).toFixed(2) : 0),
              color: '#FDBA74'
            }
          ]
        );
        this.upsertGroupedBar(
          'memBar',
          this.memBarCanvas!.nativeElement,
          labels,
          [
            {
              label: 'Usage (Mi)',
              data: pods.map(p => {
                const b = typeof p.memoryUsageBytes === 'number'
                  ? p.memoryUsageBytes
                  : (p.memoryUsage ? this.parseMemBytes(p.memoryUsage) : 0);
                return +(b / (1024 * 1024)).toFixed(2);
              }),
              color: '#0ea5e9'
            },
            {
              label: 'Request (Mi)',
              data: pods.map(p => p.memoryRequest
                ? +(this.parseMemBytes(p.memoryRequest) / (1024 * 1024)).toFixed(1) : 0),
              color: '#7dd3fc'
            }
          ]
        );
        if (this.diskBarCanvas?.nativeElement) {
          this.upsertSimpleBar(
            'disk',
            this.diskBarCanvas.nativeElement,
            labels,
            pods.map(p => typeof p.fsUsedBytes === 'number'
              ? +(p.fsUsedBytes / (1024 * 1024)).toFixed(2) : 0),
            'Disk used (Mi)',
            '#7c3aed'
          );
        }
        this.upsertSimpleBar(
          'restart',
          this.restartCanvas!.nativeElement,
          labels,
          pods.map(p => p.restarts || 0),
          'Restarts',
          '#ea580c'
        );
      }

      const ready = this.summary?.readyPods ?? 0;
      const total = this.summary?.totalPods ?? 0;
      this.upsertDonut(
        this.readyCanvas!.nativeElement,
        [ready, Math.max(0, total - ready)]
      );
    } catch (e) {
      console.warn('monitoring charts:', e);
    } finally {
      this.rendering = false;
    }
  }

  private ensureCanvas(canvas?: HTMLCanvasElement): void {
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;
    const w = wrap.clientWidth || 400;
    const h = wrap.clientHeight || 220;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }

  private baseOptions(extra?: object): object {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest' as const, intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { color: '#6E6E86', boxWidth: 10, font: { size: 10 } }
        }
      },
      scales: {
        x: {
          ticks: { color: '#6E6E86', maxTicksLimit: 6, font: { size: 10 } },
          grid: { color: 'rgba(28,28,46,0.05)' }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#6E6E86', font: { size: 10 } },
          grid: { color: 'rgba(28,28,46,0.05)' }
        }
      },
      ...extra
    };
  }

  private podCpuMilli(p: DeploymentPodInfo): number {
    if (typeof p.cpuUsageMillicores === 'number') return +p.cpuUsageMillicores.toFixed(2);
    if (typeof p.cpuUsageCores === 'number') return +(p.cpuUsageCores * 1000).toFixed(2);
    if (p.cpuUsage) return +(this.parseCpu(p.cpuUsage) * 1000).toFixed(2);
    return 0;
  }

  private upsertLine(
    key: 'cpuTime' | 'memTime',
    canvas: HTMLCanvasElement,
    labels: string[],
    data: number[],
    label: string,
    border: string,
    fill: string,
    suggestedMax?: number
  ): void {
    const existing = key === 'cpuTime' ? this.cpuTimeChart : this.memTimeChart;
    if (existing) {
      existing.data.labels = labels;
      existing.data.datasets[0].data = data;
      if (suggestedMax && existing.options.scales?.['y']) {
        (existing.options.scales['y'] as { suggestedMax?: number }).suggestedMax = suggestedMax;
      }
      existing.update('none');
      return;
    }
    Chart.getChart(canvas)?.destroy();
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: border,
          backgroundColor: fill,
          fill: true,
          tension: 0.3,
          pointRadius: data.length < 3 ? 3 : 0,
          borderWidth: 2
        }]
      },
      options: this.baseOptions({
        scales: {
          x: {
            ticks: { color: '#6E6E86', maxTicksLimit: 6, font: { size: 10 } },
            grid: { color: 'rgba(28,28,46,0.05)' }
          },
          y: {
            beginAtZero: true,
            suggestedMax: suggestedMax ?? undefined,
            ticks: { color: '#6E6E86', font: { size: 10 } },
            grid: { color: 'rgba(28,28,46,0.05)' }
          }
        }
      })
    });
    if (key === 'cpuTime') this.cpuTimeChart = chart;
    else this.memTimeChart = chart;
  }

  private upsertNetLine(canvas: HTMLCanvasElement, labels: string[], rx: number[], tx: number[]): void {
    if (this.netTimeChart) {
      this.netTimeChart.data.labels = labels;
      this.netTimeChart.data.datasets[0].data = rx;
      this.netTimeChart.data.datasets[1].data = tx;
      this.netTimeChart.update('none');
      return;
    }
    Chart.getChart(canvas)?.destroy();
    this.netTimeChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'RX (KiB/s)',
            data: rx,
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22,163,74,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2
          },
          {
            label: 'TX (KiB/s)',
            data: tx,
            borderColor: '#ea580c',
            backgroundColor: 'rgba(234,88,12,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2
          }
        ]
      },
      options: this.baseOptions()
    });
  }

  private upsertGroupedBar(
    key: 'cpuBar' | 'memBar',
    canvas: HTMLCanvasElement,
    labels: string[],
    series: { label: string; data: number[]; color: string }[]
  ): void {
    const existing = key === 'cpuBar' ? this.cpuBarChart : this.memBarChart;
    if (existing) {
      existing.data.labels = labels;
      series.forEach((s, i) => {
        if (existing.data.datasets[i]) existing.data.datasets[i].data = s.data;
      });
      existing.update('none');
      return;
    }
    Chart.getChart(canvas)?.destroy();
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: series.map(s => ({
          label: s.label,
          data: s.data,
          backgroundColor: s.color
        }))
      },
      options: this.baseOptions({
        plugins: {
          legend: {
            position: 'bottom' as const,
            labels: { color: '#6E6E86', boxWidth: 10, font: { size: 10 } }
          }
        }
      })
    });
    if (key === 'cpuBar') this.cpuBarChart = chart;
    else this.memBarChart = chart;
  }

  private upsertSimpleBar(
    key: 'restart' | 'disk',
    canvas: HTMLCanvasElement,
    labels: string[],
    data: number[],
    label: string,
    color: string
  ): void {
    const existing = key === 'restart' ? this.restartChart : this.diskBarChart;
    if (existing) {
      existing.data.labels = labels;
      existing.data.datasets[0].data = data;
      existing.update('none');
      return;
    }
    Chart.getChart(canvas)?.destroy();
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label, data, backgroundColor: color }]
      },
      options: this.baseOptions({ plugins: { legend: { display: false } } })
    });
    if (key === 'restart') this.restartChart = chart;
    else this.diskBarChart = chart;
  }

  private upsertDonut(canvas: HTMLCanvasElement, data: number[]): void {
    if (this.readyChart) {
      this.readyChart.data.datasets[0].data = data;
      this.readyChart.update('none');
      return;
    }
    Chart.getChart(canvas)?.destroy();
    this.readyChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Ready', 'Not Ready'],
        datasets: [{
          data,
          backgroundColor: ['#16a34a', '#fdba74'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#6E6E86', boxWidth: 10, font: { size: 10 } }
          }
        }
      }
    });
  }

  private destroyCharts(): void {
    try {
      this.cpuTimeChart?.destroy();
      this.memTimeChart?.destroy();
      this.netTimeChart?.destroy();
      this.cpuBarChart?.destroy();
      this.memBarChart?.destroy();
      this.diskBarChart?.destroy();
      this.readyChart?.destroy();
      this.restartChart?.destroy();
    } catch { /* ignore */ }
    this.cpuTimeChart = undefined;
    this.memTimeChart = undefined;
    this.netTimeChart = undefined;
    this.cpuBarChart = undefined;
    this.memBarChart = undefined;
    this.diskBarChart = undefined;
    this.readyChart = undefined;
    this.restartChart = undefined;
  }

  private stopPoll(): void {
    this.poll?.unsubscribe();
    this.poll = undefined;
  }
}
