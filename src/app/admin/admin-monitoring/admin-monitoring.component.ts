import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Chart from 'chart.js/auto';
import { Subject, forkJoin, interval } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AdminNamespaceSummary,
  AdminService
} from '../../services/admin/admin.service';
import {
  AppDeployment,
  AppDeploymentStatus,
  AppServiceModel,
  ClusterCapacityInfo,
  NodeCapacityInfo
} from '../../models/application-management/application-management.models';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { MonitoringDashboardComponent } from '../../application-management/monitoring-dashboard/monitoring-dashboard.component';

const POLL_MS = 30000;
const HISTORY_MAX = 20;
/** Une couleur stable par nœud, dans l'ordre d'apparition — partagée par les 3 charts + la légende. */
const NODE_COLORS = ['#ea580c', '#0284c7', '#7c3aed', '#16a34a', '#db2777', '#0f766e'];
const SEVERITY_COLORS = { ok: '#16a34a', warn: '#d97706', crit: '#dc2626' };
const GAUGE_TRACK_COLOR = '#e2e8f0';

interface GaugeItem {
  key: string;
  nodeName: string;
  label: string;
  pct: number;
  valueLabel: string;
  color: string;
}

/**
 * Jauge circulaire façon Grafana (270°, anneau, % au centre) — un doughnut Chart.js détourné,
 * pas de librairie de jauge supplémentaire. `afterDraw` dessine le texte au centre.
 */
function gaugeCenterTextPlugin(getLabel: (chart: Chart) => { big: string; small: string }): any {
  return {
    id: 'gaugeCenterText',
    afterDraw(chart: Chart) {
      const { ctx, chartArea } = chart;
      const { big, small } = getLabel(chart);
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0f172a';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillText(big, cx, cy - 6);
      ctx.fillStyle = '#64748b';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText(small, cx, cy + 14);
      ctx.restore();
    }
  };
}

/**
 * Monitoring cluster-wide (console admin) — tous les nœuds, tous les environnements RUNNING de
 * tous les utilisateurs. Le détail d'un environnement réutilise TEL QUEL le même
 * `MonitoringDashboardComponent` que le portail utilisateur (mêmes KPIs, mêmes charts "Métriques
 * namespace", mêmes onglets Workloads/Pods/Alertes) — pas une vue admin simplifiée séparée à
 * maintenir en double. Ça marche parce que `loadOwnedApp()` laisse un admin consulter n'importe
 * quelle appli, pas seulement les siennes (retour utilisateur du 18-19 août 2026 : "regarde
 * l'autre dashboard, tu fais le même, pas une flèche + modal simplifié").
 */
@Component({
  selector: 'app-admin-monitoring',
  standalone: true,
  imports: [CommonModule, FormsModule, MonitoringDashboardComponent],
  templateUrl: './admin-monitoring.component.html',
  styleUrls: [
    '../admin-route-page.css',
    // Réutilise les styles .md-section/.md-charts-2/.md-chart-card du dashboard appli pour les
    // charts "Métriques nœuds" — même rendu visuel, pas de CSS dupliqué.
    '../../application-management/monitoring-dashboard/monitoring-dashboard.component.css',
    './admin-monitoring.component.css'
  ]
})
export class AdminMonitoringComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('nodeCpuCanvas') cpuCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('nodeMemCanvas') memCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('nodeDiskCanvas') diskCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('capacityBarCanvas') capacityBarCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChildren('gaugeCanvas') gaugeCanvasList!: QueryList<ElementRef<HTMLCanvasElement>>;

  loading = true;
  error: string | null = null;

  nodes: ClusterCapacityInfo | null = null;
  namespaces: AdminNamespaceSummary[] = [];
  search = '';
  userFilter = '';
  /**
   * 'all' (défaut) = cluster complet agrégé ; sinon le nom d'un nœud précis. Pilote KPI/jauges/
   * tableau/charts nœuds ET filtre la section Environnements (ses pods tournent sur ce nœud) —
   * un seul filtre plutôt que dupliquer l'affichage de chaque nœud en permanence (retour
   * utilisateur du 19 août 2026).
   */
  selectedNode = 'all';

  expandedNamespace: string | null = null;
  expandedDeployment: AppDeployment | null = null;
  expandedAppServices: AppServiceModel[] = [];
  expandLoading = false;
  expandError: string | null = null;

  /**
   * Historique glissant (usage RÉEL, pas requests) pour les 3 charts "Métriques nœuds" — une
   * ligne de temps commune, une série par nœud. Accumulé côté client sur les polls (30s) : pas
   * une vraie série Prometheus, mais suffisant pour voir une tendance sans infra supplémentaire
   * (retour utilisateur du 19 août 2026 : "des courbes et charts comme un vrai dashboard", pas de
   * mini-sparkline dessinée à la main dans une cellule de tableau).
   */
  private historyLabels: string[] = [];
  private historyByNode = new Map<string, { cpu: number[]; mem: number[]; disk: number[] }>();
  private cpuChart?: Chart;
  private memChart?: Chart;
  private diskChart?: Chart;
  private capacityBarChart?: Chart;
  private gaugeCharts: Chart[] = [];
  private viewReady = false;

  private destroy$ = new Subject<void>();

  constructor(
    private adminService: AdminService,
    private appMgmt: ApplicationManagementService
  ) {}

  ngOnInit(): void {
    this.load();
    interval(POLL_MS).pipe(takeUntil(this.destroy$)).subscribe(() => this.load(true));
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    // Les canvases n'existent qu'une fois *ngIf="nodes?.enabled" vrai — si les données du tout
    // premier load() sont déjà là au moment où la vue se stabilise, dessine immédiatement.
    if (this.nodes?.enabled) {
      this.renderAllCharts();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cpuChart?.destroy();
    this.memChart?.destroy();
    this.diskChart?.destroy();
    this.capacityBarChart?.destroy();
    this.gaugeCharts.forEach((c) => c.destroy());
  }

  load(silent = false): void {
    if (!silent) {
      this.loading = true;
      this.error = null;
    }
    // En parallèle (forkJoin), pas l'un après l'autre : nœuds et environnements sont deux sources
    // indépendantes — les enchaîner doublait inutilement le temps d'attente (retour utilisateur du
    // 19 août 2026 : "20s avant que ça s'affiche").
    forkJoin({
      nodes: this.adminService.getMonitoringNodes(),
      namespaces: this.adminService.getMonitoringNamespaces()
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ nodes, namespaces }) => {
        this.nodes = nodes;
        this.namespaces = namespaces;
        this.recordNodeHistory(nodes);
        this.loading = false;
        // setTimeout(0) : laisse Angular rendre les canvases (juste révélés par *ngIf) avant d'y dessiner.
        setTimeout(() => { if (this.viewReady) this.renderAllCharts(); }, 0);
      },
      error: (e) => {
        this.loading = false;
        this.error = e?.error?.message || 'Chargement du monitoring cluster impossible.';
      }
    });
  }

  get owners(): string[] {
    const set = new Set<string>();
    for (const n of this.namespaces) {
      if (n.ownerUsername) set.add(n.ownerUsername);
    }
    return [...set].sort();
  }

  /** Nœuds à afficher partout (KPI/jauges/tableau/charts) — tous en 'all', un seul sinon. */
  get displayNodes(): NodeCapacityInfo[] {
    const all = this.nodes?.nodes || [];
    if (this.selectedNode === 'all') return all;
    return all.filter((n) => n.name === this.selectedNode);
  }

  get filteredNamespaces(): AdminNamespaceSummary[] {
    const q = this.search.trim().toLowerCase();
    return this.namespaces.filter((n) => {
      if (this.selectedNode !== 'all' && !(n.nodes || []).includes(this.selectedNode)) return false;
      if (this.userFilter && n.ownerUsername !== this.userFilter) return false;
      if (!q) return true;
      return [n.namespace, n.appName, n.ownerUsername].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }

  get orphanedCount(): number {
    return this.namespaces.filter((n) => n.orphaned).length;
  }

  /** Bandeau KPI en tête de section — cluster complet, ou juste le nœud sélectionné. */
  get readyNodesLabel(): string {
    const list = this.displayNodes;
    return list.filter((n) => n.ready).length + ' / ' + list.length;
  }

  get clusterRealCpuCores(): number {
    return this.displayNodes.reduce((s, n) => s + (n.realCpuUsageCores || 0), 0);
  }

  get clusterRealMemBytes(): number {
    return this.displayNodes.reduce((s, n) => s + (n.realMemoryUsageBytes || 0), 0);
  }

  get clusterPodsLabel(): string {
    const list = this.displayNodes;
    const used = list.reduce((s, n) => s + (n.podCount || 0), 0);
    const cap = list.reduce((s, n) => s + (n.podCapacity || 0), 0);
    return used + ' / ' + cap;
  }

  onNodeFilterChange(): void {
    // Filtre partagé KPI/jauges/tableau/charts nœuds — reconstruit tout avec le nouveau sous-ensemble.
    setTimeout(() => { if (this.viewReady) this.renderAllCharts(); }, 0);
  }

  nodeCpuPct(n: NodeCapacityInfo): number {
    if (!n.allocatableCpuCores) return 0;
    return Math.min(100, Math.round((n.usedCpuCores / n.allocatableCpuCores) * 100));
  }

  nodeMemPct(n: NodeCapacityInfo): number {
    if (!n.allocatableMemoryBytes) return 0;
    return Math.min(100, Math.round((n.usedMemoryBytes / n.allocatableMemoryBytes) * 100));
  }

  nodeDiskPct(n: NodeCapacityInfo): number {
    if (!n.allocatableDiskBytes) return 0;
    return Math.min(100, Math.round(((n.usedDiskBytes || 0) / n.allocatableDiskBytes) * 100));
  }

  /** Usage RÉEL (kubelet), pas les requests planifiées — voir nodeCpuPct pour la réservation. */
  nodeRealCpuPct(n: NodeCapacityInfo): number {
    if (!n.allocatableCpuCores) return 0;
    return Math.min(100, Math.round(((n.realCpuUsageCores || 0) / n.allocatableCpuCores) * 100));
  }

  nodeRealMemPct(n: NodeCapacityInfo): number {
    if (!n.allocatableMemoryBytes) return 0;
    return Math.min(100, Math.round(((n.realMemoryUsageBytes || 0) / n.allocatableMemoryBytes) * 100));
  }

  nodePodsPct(n: NodeCapacityInfo): number {
    if (!n.podCapacity) return 0;
    return Math.min(100, Math.round(((n.podCount || 0) / n.podCapacity) * 100));
  }

  /** Code couleur par seuil — vert/ambre/rouge, comme un vrai dashboard, pas une barre toujours orange. */
  severityClass(pct: number): 'ok' | 'warn' | 'crit' {
    if (pct >= 90) return 'crit';
    if (pct >= 70) return 'warn';
    return 'ok';
  }

  severityColor(pct: number): string {
    return SEVERITY_COLORS[this.severityClass(pct)];
  }

  /**
   * `gaugeItems` est un getter — il renvoie de nouveaux objets à chaque cycle de détection de
   * changements. Sans trackBy, *ngFor verrait "tout différent" à chaque cycle et détruirait/
   * recréerait les <canvas> en continu, cassant les instances Chart.js qui y sont attachées.
   */
  trackByGaugeKey(_index: number, item: GaugeItem): string {
    return item.key;
  }

  /**
   * 4 jauges (CPU/Mémoire/Disque/Pods) — jamais 4×N : en 'all' elles agrègent tout le cluster,
   * sur un nœud précis elles montrent CE nœud. Un seul jeu de jauges à la fois, pas une grille
   * qui grossit avec chaque nœud (retour utilisateur du 19 août 2026 : "un filtre au lieu de
   * duplication").
   */
  get gaugeItems(): GaugeItem[] {
    const nodes = this.displayNodes;
    const scope = this.selectedNode === 'all' ? 'Cluster complet' : this.selectedNode;
    const sum = (f: (n: NodeCapacityInfo) => number) => nodes.reduce((s, n) => s + f(n), 0);
    const pct = (used: number, alloc: number) => (alloc ? Math.min(100, Math.round((used / alloc) * 100)) : 0);

    const cpuUsed = sum((n) => n.realCpuUsageCores || 0);
    const cpuAlloc = sum((n) => n.allocatableCpuCores || 0);
    const memUsed = sum((n) => n.realMemoryUsageBytes || 0);
    const memAlloc = sum((n) => n.allocatableMemoryBytes || 0);
    const diskUsed = sum((n) => n.usedDiskBytes || 0);
    const diskAlloc = sum((n) => n.allocatableDiskBytes || 0);
    const podsUsed = sum((n) => n.podCount || 0);
    const podsAlloc = sum((n) => n.podCapacity || 0);

    const cpuPct = pct(cpuUsed, cpuAlloc);
    const memPct = pct(memUsed, memAlloc);
    const diskPct = pct(diskUsed, diskAlloc);
    const podsPct = pct(podsUsed, podsAlloc);

    return [
      { key: 'cpu', nodeName: scope, label: 'CPU', pct: cpuPct, valueLabel: this.formatCores(cpuUsed), color: this.severityColor(cpuPct) },
      { key: 'mem', nodeName: scope, label: 'Mémoire', pct: memPct, valueLabel: this.formatBytes(memUsed), color: this.severityColor(memPct) },
      { key: 'disk', nodeName: scope, label: 'Disque', pct: diskPct, valueLabel: this.formatBytes(diskUsed), color: this.severityColor(diskPct) },
      { key: 'pods', nodeName: scope, label: 'Pods', pct: podsPct, valueLabel: podsUsed + '/' + podsAlloc, color: this.severityColor(podsPct) }
    ];
  }

  hasPressure(n: NodeCapacityInfo): boolean {
    return !!(n.diskPressure || n.memoryPressure || n.pidPressure);
  }

  pressureLabels(n: NodeCapacityInfo): string[] {
    const labels: string[] = [];
    if (n.diskPressure) labels.push('DiskPressure');
    if (n.memoryPressure) labels.push('MemoryPressure');
    if (n.pidPressure) labels.push('PIDPressure');
    return labels;
  }

  formatAge(createdAt: string | null | undefined): string {
    if (!createdAt) return '—';
    const t = new Date(createdAt).getTime();
    if (!Number.isFinite(t)) return '—';
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1) return "aujourd'hui";
    if (days < 30) return days + ' j';
    return Math.floor(days / 30) + ' mois';
  }

  get hasHistory(): boolean {
    return this.historyLabels.length >= 2;
  }

  nodeColor(index: number): string {
    return NODE_COLORS[index % NODE_COLORS.length];
  }

  private recordNodeHistory(nodes: ClusterCapacityInfo): void {
    const label = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.historyLabels.push(label);
    if (this.historyLabels.length > HISTORY_MAX) this.historyLabels.shift();

    for (const n of nodes.nodes || []) {
      const series = this.historyByNode.get(n.name) || { cpu: [], mem: [], disk: [] };
      series.cpu.push(this.nodeRealCpuPct(n));
      series.mem.push(this.nodeRealMemPct(n));
      series.disk.push(this.nodeDiskPct(n));
      if (series.cpu.length > HISTORY_MAX) series.cpu.shift();
      if (series.mem.length > HISTORY_MAX) series.mem.shift();
      if (series.disk.length > HISTORY_MAX) series.disk.shift();
      this.historyByNode.set(n.name, series);
    }
  }

  private renderAllCharts(): void {
    this.renderNodeCharts();
    this.renderGauges();
    this.renderCapacityBarChart();
  }

  /** Construit ou met à jour les 3 charts "Métriques nœuds" — une série (ligne) par nœud affiché (filtre), même style que le dashboard appli. */
  private renderNodeCharts(): void {
    const nodeNames = this.displayNodes.map((n) => n.name);
    if (!nodeNames.length) return;

    this.cpuChart = this.upsertNodeChart(this.cpuChart, this.cpuCanvasRef, nodeNames, 'cpu', '%');
    this.memChart = this.upsertNodeChart(this.memChart, this.memCanvasRef, nodeNames, 'mem', '%');
    this.diskChart = this.upsertNodeChart(this.diskChart, this.diskCanvasRef, nodeNames, 'disk', '%');
  }

  /**
   * Grille de jauges circulaires (une par nœud × métrique) — reconstruite à chaque poll (les
   * doughnuts n'ont qu'un point, un simple .update() suffit mais reconstruire reste trivial ici
   * vu la taille des données). `QueryList` car le nombre de jauges dépend du nombre de nœuds.
   */
  private renderGauges(): void {
    if (!this.gaugeCanvasList) return;
    this.gaugeCharts.forEach((c) => c.destroy());
    this.gaugeCharts = [];
    const items = this.gaugeItems;
    const canvases = this.gaugeCanvasList.toArray();
    items.forEach((item, i) => {
      const canvas = canvases[i]?.nativeElement;
      if (!canvas) return;
      Chart.getChart(canvas)?.destroy();
      const chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          datasets: [{
            data: [item.pct, Math.max(0, 100 - item.pct)],
            backgroundColor: [item.color, GAUGE_TRACK_COLOR],
            borderWidth: 0
          }]
        },
        options: {
          circumference: 270,
          rotation: 225,
          cutout: '72%',
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } }
        },
        plugins: [gaugeCenterTextPlugin(() => ({ big: item.pct + '%', small: item.valueLabel }))]
      });
      this.gaugeCharts.push(chart);
    });
  }

  /** Bar chart comparatif — capacité disque par nœud (allocatable vs utilisé), façon "Datastores - Usage Capacity". */
  private renderCapacityBarChart(): void {
    const canvas = this.capacityBarCanvasRef?.nativeElement;
    if (!canvas) return;
    const nodes = this.displayNodes;
    const labels = nodes.map((n) => n.name);
    const usedGi = nodes.map((n) => +((n.usedDiskBytes || 0) / (1024 ** 3)).toFixed(1));
    const freeGi = nodes.map((n) => +(((n.allocatableDiskBytes || 0) - (n.usedDiskBytes || 0)) / (1024 ** 3)).toFixed(1));

    if (this.capacityBarChart) {
      this.capacityBarChart.data.labels = labels;
      this.capacityBarChart.data.datasets[0].data = usedGi;
      this.capacityBarChart.data.datasets[1].data = freeGi;
      this.capacityBarChart.update('none');
      return;
    }
    Chart.getChart(canvas)?.destroy();
    this.capacityBarChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Utilisé (Gi)', data: usedGi, backgroundColor: '#ea580c', stack: 'disk' },
          { label: 'Libre (Gi)', data: freeGi, backgroundColor: '#e2e8f0', stack: 'disk' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: true, labels: { color: '#6E6E86', boxWidth: 10, font: { size: 10 } } } },
        scales: {
          x: { stacked: true, ticks: { color: '#6E6E86', font: { size: 10 } }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { color: '#6E6E86', font: { size: 10 } }, grid: { color: 'rgba(28,28,46,0.05)' } }
        }
      }
    });
  }

  private upsertNodeChart(
    existing: Chart | undefined,
    canvasRef: ElementRef<HTMLCanvasElement> | undefined,
    nodeNames: string[],
    metric: 'cpu' | 'mem' | 'disk',
    unit: string
  ): Chart | undefined {
    const datasets = nodeNames.map((name, i) => ({
      label: name,
      data: this.historyByNode.get(name)?.[metric] || [],
      borderColor: this.nodeColor(i),
      backgroundColor: this.nodeColor(i) + '22',
      fill: false,
      tension: 0.3,
      pointRadius: this.historyLabels.length < 3 ? 3 : 0,
      borderWidth: 2
    }));

    if (existing) {
      existing.data.labels = this.historyLabels;
      existing.data.datasets = datasets;
      existing.update('none');
      return existing;
    }

    const canvas = canvasRef?.nativeElement;
    if (!canvas) return undefined;
    Chart.getChart(canvas)?.destroy();
    return new Chart(canvas, {
      type: 'line',
      data: { labels: this.historyLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest' as const, intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#6E6E86', boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}${unit}` } }
        },
        scales: {
          x: { ticks: { color: '#6E6E86', maxTicksLimit: 6, font: { size: 10 } }, grid: { color: 'rgba(28,28,46,0.05)' } },
          y: { beginAtZero: true, max: 100, ticks: { color: '#6E6E86', font: { size: 10 } }, grid: { color: 'rgba(28,28,46,0.05)' } }
        }
      }
    });
  }

  podsPct(n: AdminNamespaceSummary): number {
    if (!n.podsTotal) return 0;
    return Math.min(100, Math.round((n.podsReady / n.podsTotal) * 100));
  }

  formatCores(cores: number | null | undefined): string {
    if (cores == null || !Number.isFinite(cores)) return '—';
    if (cores < 1) return Math.round(cores * 1000) + 'm';
    return cores.toFixed(2);
  }

  formatBytes(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes === 0) return '—';
    const gi = bytes / (1024 * 1024 * 1024);
    if (gi >= 1) return gi.toFixed(2) + ' Gi';
    return (bytes / (1024 * 1024)).toFixed(0) + ' Mi';
  }

  /** Flèche : ouvre/ferme le dashboard complet de cet environnement, juste en dessous de la ligne. */
  toggleExpand(ns: AdminNamespaceSummary): void {
    if (this.expandedNamespace === ns.namespace) {
      this.expandedNamespace = null;
      this.expandedDeployment = null;
      this.expandedAppServices = [];
      return;
    }
    this.expandedNamespace = ns.namespace;
    this.expandedDeployment = null;
    this.expandedAppServices = [];
    this.expandError = null;
    if (!ns.appId) {
      this.expandError = 'Application introuvable pour cet environnement.';
      return;
    }
    this.expandLoading = true;
    this.appMgmt.get(ns.appId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (app) => {
        this.expandLoading = false;
        this.expandedAppServices = app.services || [];
        this.expandedDeployment = {
          id: ns.deploymentId,
          namespace: ns.namespace,
          status: 'RUNNING' as AppDeploymentStatus
        };
      },
      error: (e) => {
        this.expandLoading = false;
        this.expandError = e?.error?.message || 'Chargement de l’application impossible.';
      }
    });
  }
}
