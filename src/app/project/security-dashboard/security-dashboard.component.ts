import { CommonModule } from '@angular/common';
import { Component, ElementRef, NgZone, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import Chart from 'chart.js/auto';
import { Subject, combineLatest, from, of } from 'rxjs';
import { catchError, concatMap, distinctUntilChanged, finalize, map, switchMap, takeUntil, timeout, toArray } from 'rxjs/operators';
import {
  DefectDojoDashboardResponse,
  DefectDojoDetailedMetrics,
  DefectDojoFindingItem,
  DefectDojoFindingStatusAction,
  DefectDojoMetricCard,
  DefectDojoMetricCategory,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';
import {
  hasOpenSeverityChartData,
  OPEN_SEV_BAR_COLORS,
  openSeverityChartSubtitle,
  OpenSeverityGranularity,
  renderOpenSeverityEvolutionChart
} from '../../services/defectdojo/open-severity-evolution-chart.helper';
import {
  FluxGranularity,
  fluxChartSubtitle,
  hasFluxChartData,
  renderTreatmentFluxChart
} from '../../services/defectdojo/treatment-flux-chart.helper';
import { cweDisplayLabel } from '../../services/defectdojo/cwe-labels';
import { QualityGateService, QualityGateEnvironmentOption } from '../../services/quality-gate/quality-gate.service';

const METRIC_META: Record<DefectDojoMetricCategory, { icon: string; tone: string }> = {
  verified: { icon: '✓', tone: 'verified' },
  open: { icon: '⚠', tone: 'open' },
  risk_accepted: { icon: '⚖', tone: 'risk' },
  closed: { icon: '✔', tone: 'closed' },
  false_positive: { icon: '⊘', tone: 'fp' },
  out_of_scope: { icon: '↗', tone: 'oos' },
  total: { icon: '∑', tone: 'total' },
  inactive: { icon: '○', tone: 'inactive' }
};

const THEME = {
  navy: '#0f172a',
  navyMid: '#1e293b',
  navyLight: '#334155',
  slate: '#475569',
  orange: '#f36c21',
  orangeDark: '#ea580c',
  orangeDeep: '#c2410c',
  orangeSoft: '#fb923c',
  green: '#22c55e',
  greenDark: '#16a34a'
};

const SEV_COLORS: Record<string, string> = {
  Critical: THEME.orangeDeep,
  High: THEME.orangeDark,
  Medium: THEME.orange,
  Low: THEME.slate,
  Info: THEME.navyLight
};

const SECURITY_REQUEST_TIMEOUT_MS = 180_000;

interface FindingRowAction {
  action: DefectDojoFindingStatusAction;
  label: string;
  confirm?: string;
}

@Component({
  selector: 'app-security-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './security-dashboard.component.html',
  styleUrls: [
    '../shared/security-list.styles.css',
    './security-dashboard.component.css'
  ]
})
export class SecurityDashboardComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();
  private readonly dashboardReload$ = new Subject<{ appId: string; branch: string; tags?: string }>();
  private chartInstances: Chart[] = [];
  private openSeverityChart?: Chart;
  private fluxChart?: Chart;
  private chartRenderTimer?: ReturnType<typeof setTimeout>;

  @ViewChild('evolutionSeverityCanvas') evolutionSeverityCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('scanCanvas') scanCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('fluxCanvas') fluxCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('findingAgeCanvas') findingAgeCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('openCweCanvas') openCweCanvas?: ElementRef<HTMLCanvasElement>;

  @ViewChildren('overviewChart') overviewCharts!: QueryList<ElementRef<HTMLCanvasElement>>;

  appId: string | null = null;
  selectedBranch = '';
  selectedPipelineId = '';
  branches: string[] = [];
  pipelineOptions: Array<{ id: string; label: string }> = [];

  loading = false;
  chartsLoading = false;
  listLoading = false;
  error: string | null = null;
  dashboard: DefectDojoDashboardResponse | null = null;

  selectedCategory: DefectDojoMetricCategory = 'open';
  findings: DefectDojoFindingItem[] = [];
  page = 0;
  readonly size = 25;
  totalElements = 0;

  filterSeverity = '';
  filterDateFrom = '';
  filterDateTo = '';
  filterTestId: number | null = null;
  searchQuery = '';
  showFindingsTable = false;
  scanToolFilterOptions: { testId: number; label: string }[] = [];
  filteredFindings: DefectDojoFindingItem[] = [];
  selectedFindingIds = new Set<number>();
  editTargetIds: number[] = [];
  bulkEditOpen = false;
  rowMenuOpenId: number | null = null;
  bulkActionLoading = false;
  bulkActionError: string | null = null;
  bulkActionMessage: string | null = null;

  readonly statusGroupActions: FindingRowAction[] = [
    { action: 'REACTIVATE', label: 'Active', confirm: 'Remettre ce finding en actif ?' },
    { action: 'VERIFY', label: 'Verified' },
    { action: 'FALSE_POSITIVE', label: 'False Positive', confirm: 'Marquer comme faux positif ?' },
    { action: 'OUT_OF_SCOPE', label: 'Out of scope', confirm: 'Marquer hors périmètre ?' },
    { action: 'CLOSE', label: 'Mitigated', confirm: 'Marquer comme corrigé / mitigé ?' },
    { action: 'UNDER_REVIEW', label: 'Under Review' }
  ];

  readonly riskGroupActions: FindingRowAction[] = [
    { action: 'ACCEPT_RISK', label: 'Accept', confirm: 'Accepter le risque pour ce finding ?' },
    { action: 'UNACCEPT_RISK', label: 'Unaccept', confirm: 'Retirer l\'acceptation de risque ?' }
  ];
  hasOpenSeverityChart = false;
  openSeverityGranularity: OpenSeverityGranularity = 'day';
  fluxGranularity: FluxGranularity = 'day';

  readonly severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private defectDojoService: DefectDojoService,
    private qualityGateService: QualityGateService,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    const appId$ = this.route.parent!.paramMap.pipe(
      map(p => p.get('appId')),
      distinctUntilChanged()
    );

    this.dashboardReload$.pipe(
      switchMap(({ appId, branch, tags }) => {
        this.loading = true;
        this.chartsLoading = false;
        this.error = null;
        this.destroyCharts();
        return this.defectDojoService.getDashboard(appId, branch, tags ?? this.defectDojoService.scanKindTag()).pipe(
          timeout(SECURITY_REQUEST_TIMEOUT_MS),
          catchError(err => {
            const msg = err?.name === 'TimeoutError'
              ? 'Chargement trop long — le backend interroge DefectDojo (tunnel Cloudflare). Réessayez dans 1 min ou vérifiez DEFECTDOJO_URL.'
              : (err.error?.message || 'Impossible de charger le dashboard sécurité.');
            throw { message: msg };
          })
        );
      }),
      takeUntil(this.destroy$)
    ).subscribe({
      next: d => {
        this.dashboard = d;
        this.loading = false;
        this.chartsLoading = false;
        this.hasOpenSeverityChart = hasOpenSeverityChartData(d.charts);
        this.refreshScanToolOptions();
        if (d.engagementId) {
          if (this.showFindingsTable) this.loadFindings();
          setTimeout(() => this.renderCharts(), 80);
        } else {
          this.hasOpenSeverityChart = false;
        }
      },
      error: err => {
        this.dashboard = null;
        this.error = err.message || 'Impossible de charger le dashboard sécurité.';
        this.loading = false;
        this.chartsLoading = false;
      }
    });

    appId$.pipe(takeUntil(this.destroy$)).subscribe(id => {
      this.appId = id;
      if (this.appId) {
        this.loadBranches();
      }
    });

    combineLatest([
      appId$,
      this.route.queryParamMap.pipe(
        map(qp => ({
          branch: qp.get('branch') ?? '',
          category: (qp.get('category') ?? 'open') as DefectDojoMetricCategory,
          pipelineId: qp.get('pipelineId') ?? ''
        })),
        distinctUntilChanged((a, b) =>
          a.branch === b.branch && a.pipelineId === b.pipelineId && a.category === b.category
        )
      )
    ]).pipe(takeUntil(this.destroy$)).subscribe(([id, qp]) => {
      if (!id) return;
      const branchChanged = qp.branch !== this.selectedBranch;
      const pipelineChanged = qp.pipelineId !== this.selectedPipelineId;
      const catChanged = qp.category !== this.selectedCategory;
      if (qp.branch) this.selectedBranch = qp.branch;
      this.selectedPipelineId = qp.pipelineId || '';
      this.selectedCategory = qp.category;
      if (this.selectedBranch && (branchChanged || pipelineChanged)) {
        this.requestDashboardReload(id, this.selectedBranch);
      } else if (catChanged && this.showFindingsTable) {
        this.loadFindings();
      }
    });
  }

  private requestDashboardReload(appId: string, branch: string): void {
    this.dashboardReload$.next({
      appId,
      branch,
      tags: this.selectedDefectDojoTag || undefined
    });
  }

  ngOnDestroy(): void {
    this.destroyCharts();
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadBranches(): void {
    if (!this.appId) return;
    this.defectDojoService.getBranches(this.appId).subscribe({
      next: list => {
        this.branches = list?.length ? list : ['main'];
        if (!this.selectedBranch) {
          this.selectedBranch = this.branches[0];
          this.syncQueryParams();
          this.triggerDashboardReload();
        }
      },
      error: () => {
        this.branches = ['main'];
        if (!this.selectedBranch) {
          this.selectedBranch = 'main';
          this.syncQueryParams();
          this.triggerDashboardReload();
        }
      }
    });
  }

  onBranchChange(): void {
    this.page = 0;
    this.selectedPipelineId = '';
    this.syncQueryParams();
    this.loadPipelineOptions(true);
  }

  onPipelineChange(): void {
    this.page = 0;
    this.syncQueryParams();
    this.triggerDashboardReload();
  }

  clearPipelineFilter(): void {
    this.selectedPipelineId = '';
    this.page = 0;
    this.syncQueryParams();
    this.triggerDashboardReload();
  }

  private triggerDashboardReload(): void {
    if (!this.appId || !this.selectedBranch) return;
    this.loadPipelineOptions(true);
  }

  private loadPipelineOptions(reloadAfter = false): void {
    if (!this.appId) return;
    this.qualityGateService.listScanPipelines(this.appId, this.selectedBranch).pipe(
      map((envs: QualityGateEnvironmentOption[]) => (envs ?? [])
        .filter(e => e.pipelineId)
        .map(e => ({
          id: String(e.pipelineId),
          label: `#${e.pipelineId}`
        }))
      ),
      catchError(() => of([] as Array<{ id: string; label: string }>)),
      takeUntil(this.destroy$)
    ).subscribe(opts => {
      this.pipelineOptions = opts;
      let changed = false;
      if (this.selectedPipelineId && !opts.some(o => o.id === this.selectedPipelineId)) {
        this.selectedPipelineId = opts.length ? opts[0].id : '';
        changed = true;
      } else if (!this.selectedPipelineId && opts.length) {
        this.selectedPipelineId = opts[0].id;
        changed = true;
      }
      if (changed) {
        this.syncQueryParams();
      }
      if ((changed || reloadAfter) && this.appId && this.selectedBranch) {
        this.requestDashboardReload(this.appId, this.selectedBranch);
      }
    });
  }

  backToProject(): void {
    if (!this.appId) return;
    const branch = this.selectedBranch && this.selectedBranch !== '__all__'
      ? this.selectedBranch
      : undefined;
    this.router.navigate(['/project', this.appId, 'overview'], {
      queryParams: branch ? { branch } : {}
    });
  }

  get selectedDefectDojoTag(): string | null {
    if (this.selectedPipelineId) {
      return this.defectDojoService.pipelineTag(this.selectedPipelineId);
    }
    return this.defectDojoService.scanKindTag();
  }

  get defectDojoFilterLabel(): string {
    if (this.selectedPipelineId) {
      return `Pipeline #${this.selectedPipelineId}`;
    }
    return 'Scans CI uniquement';
  }

  selectCategory(card: DefectDojoMetricCard): void {
    if (this.selectedCategory === card.key && this.showFindingsTable) {
      this.scrollToFindings();
      return;
    }
    this.selectedCategory = card.key;
    this.page = 0;
    this.showFindingsTable = true;
    this.syncQueryParams();
    setTimeout(() => this.loadFindings(), 0);
    this.scrollToFindings();
  }

  filterBySeverity(severity: string): void {
    this.selectedCategory = 'open';
    this.filterSeverity = severity;
    this.page = 0;
    this.showFindingsTable = true;
    this.syncQueryParams();
    this.loadFindings();
    this.scrollToFindings();
  }

  filterByTool(testId: number): void {
    this.selectedCategory = 'open';
    this.filterTestId = testId;
    this.page = 0;
    this.showFindingsTable = true;
    this.syncQueryParams();
    this.loadFindings();
    this.scrollToFindings();
  }

  private scrollToFindings(): void {
    setTimeout(() => document.getElementById('dd-findings-table')?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  isCategoryActive(key: DefectDojoMetricCategory): boolean {
    return this.selectedCategory === key;
  }

  metricMeta(key: DefectDojoMetricCategory) {
    return METRIC_META[key] ?? { icon: '•', tone: 'default' };
  }

  severityBarWidth(card: DefectDojoMetricCard, sev: string): number {
    const total = card.total || 0;
    if (!total) return 0;
    return ((card.bySeverity?.[sev] || 0) / total) * 100;
  }

  severityColor(sev: string): string {
    return SEV_COLORS[sev] ?? '#64748b';
  }

  severityBarColor(sev: string): string {
    return OPEN_SEV_BAR_COLORS[sev] ?? '#64748b';
  }

  get openSeverityChartSubtitle(): string {
    return openSeverityChartSubtitle(this.openSeverityGranularity);
  }

  setOpenSeverityGranularity(granularity: OpenSeverityGranularity): void {
    if (this.openSeverityGranularity === granularity) return;
    this.openSeverityGranularity = granularity;
    this.ngZone.runOutsideAngular(() => this.renderOpenSeverityChart());
  }

  get fluxSubtitle(): string {
    return fluxChartSubtitle(this.fluxGranularity, this.fluxBucketCountEstimate);
  }

  private get fluxBucketCountEstimate(): number {
    return this.charts?.detailedMetrics?.openDayToDayBySeverity?.length
      ?? this.charts?.scanSnapshots?.length
      ?? 0;
  }

  get hasFluxChart(): boolean {
    return hasFluxChartData(this.charts);
  }

  setFluxGranularity(g: FluxGranularity): void {
    if (this.fluxGranularity === g) return;
    this.fluxGranularity = g;
    this.ngZone.runOutsideAngular(() => this.renderFluxChart());
  }

  get lastScanLabel(): string {
    const raw = this.charts?.lastScanDate;
    if (!raw) return '—';
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  reload(): void {
    this.triggerDashboardReload();
  }

  loadFindings(): void {
    if (!this.appId || !this.selectedBranch || !this.dashboard?.engagementId) return;
    this.listLoading = true;
    this.defectDojoService
      .getFindings(
        this.appId,
        this.selectedBranch,
        this.selectedCategory,
        this.page,
        this.size,
        this.filterSeverity || undefined,
        this.selectedDefectDojoTag || undefined,
        this.filterDateFrom || undefined,
        this.filterDateTo || undefined,
        this.filterTestId ?? undefined
      )
      .pipe(
        timeout(60_000),
        finalize(() => (this.listLoading = false))
      )
      .subscribe({
        next: p => {
          this.findings = p.content ?? [];
          this.totalElements = p.totalElements ?? 0;
          this.refreshFilteredFindings();
        },
        error: () => {
          this.findings = [];
          this.filteredFindings = [];
          this.totalElements = 0;
        }
      });
  }

  onSearchQueryChanged(): void {
    this.refreshFilteredFindings();
  }

  private refreshScanToolOptions(): void {
    const seen = new Set<number>();
    this.scanToolFilterOptions = (this.dashboard?.charts?.scanSnapshots ?? [])
      .filter(s => s.testId > 0 && !seen.has(s.testId) && seen.add(s.testId))
      .map(s => ({
        testId: s.testId,
        label: s.label || s.scanType || `Test #${s.testId}`
      }));
  }

  private refreshFilteredFindings(): void {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      this.filteredFindings = [...this.findings];
      return;
    }
    this.filteredFindings = this.findings.filter(f => {
      const blob = [f.title, f.description, f.cve, f.cwe, f.filePath, f.componentName, f.scanType]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }

  trackFindingRow(_index: number, f: DefectDojoFindingItem): string {
    return `${f.id}-${f.status}-${f.active}-${f.verified}-${f.mitigated}-${f.riskAccepted}`;
  }

  trackScanToolOption(_index: number, t: { testId: number }): number {
    return t.testId;
  }

  onListFiltersChanged(): void {
    this.page = 0;
    this.loadFindings();
  }

  clearFilters(): void {
    this.filterSeverity = '';
    this.filterDateFrom = '';
    this.filterDateTo = '';
    this.filterTestId = null;
    this.searchQuery = '';
    this.page = 0;
    this.refreshFilteredFindings();
    this.loadFindings();
  }

  prevPage(): void {
    if (this.page <= 0) return;
    this.page--;
    this.loadFindings();
  }

  nextPage(): void {
    if ((this.page + 1) * this.size >= this.totalElements) return;
    this.page++;
    this.loadFindings();
  }

  openDetail(f: DefectDojoFindingItem): void {
    if (!this.appId || !f?.id) return;
    this.router.navigate(['/project', this.appId, 'security-dashboard', 'finding', f.id], {
      queryParams: { branch: this.selectedBranch, category: this.selectedCategory }
    });
  }

  get hasSelection(): boolean {
    return this.selectedFindingIds.size > 0;
  }

  get selectedCount(): number {
    return this.selectedFindingIds.size;
  }

  get showingFrom(): number {
    if (this.totalElements === 0) return 0;
    return this.page * this.size + 1;
  }

  get showingTo(): number {
    return Math.min((this.page + 1) * this.size, this.totalElements);
  }

  get isAllPageSelected(): boolean {
    return (
      this.filteredFindings.length > 0 &&
      this.filteredFindings.every(f => f.id != null && this.selectedFindingIds.has(f.id))
    );
  }

  get activeEditIds(): number[] {
    return this.editTargetIds.length > 0 ? this.editTargetIds : [...this.selectedFindingIds];
  }

  isFindingChecked(f: DefectDojoFindingItem): boolean {
    return f.id != null && this.selectedFindingIds.has(f.id);
  }

  toggleFindingSelection(f: DefectDojoFindingItem, event: Event): void {
    event.stopPropagation();
    if (f.id == null) return;
    if (this.selectedFindingIds.has(f.id)) {
      this.selectedFindingIds.delete(f.id);
    } else {
      this.selectedFindingIds.add(f.id);
    }
    this.editTargetIds = [];
    this.bulkActionError = null;
    this.bulkActionMessage = null;
  }

  toggleSelectAllPage(event: Event): void {
    event.stopPropagation();
    if (this.isAllPageSelected) {
      for (const f of this.filteredFindings) {
        if (f.id != null) this.selectedFindingIds.delete(f.id);
      }
    } else {
      for (const f of this.filteredFindings) {
        if (f.id != null) this.selectedFindingIds.add(f.id);
      }
    }
    this.editTargetIds = [];
  }

  toggleBulkEditMenu(): void {
    if (!this.hasSelection && this.editTargetIds.length === 0) return;
    this.bulkEditOpen = !this.bulkEditOpen;
    this.rowMenuOpenId = null;
    if (!this.bulkEditOpen) {
      this.editTargetIds = [];
    }
  }

  toggleRowMenu(findingId: number, event: Event): void {
    event.stopPropagation();
    this.rowMenuOpenId = this.rowMenuOpenId === findingId ? null : findingId;
    this.bulkEditOpen = false;
  }

  openRowEdit(f: DefectDojoFindingItem): void {
    if (f.id == null) return;
    this.editTargetIds = [f.id];
    this.bulkEditOpen = true;
    this.rowMenuOpenId = null;
    this.bulkActionError = null;
    this.bulkActionMessage = null;
  }

  toolLabel(f: DefectDojoFindingItem): string {
    return f.toolName || f.scanType || '—';
  }

  importLabel(f: DefectDojoFindingItem): string {
    if (f.testId) {
      return `Import #${f.testId}`;
    }
    return '—';
  }

  applyBulkAction(btn: FindingRowAction): void {
    const ids = this.activeEditIds;
    if (!this.appId || ids.length === 0 || this.bulkActionLoading) return;
    if (btn.confirm && !window.confirm(btn.confirm)) return;

    this.bulkActionLoading = true;
    this.bulkActionError = null;
    this.bulkActionMessage = null;

    from(ids)
      .pipe(
        concatMap(id => {
          const finding = this.findings.find(x => x.id === id);
          let action = btn.action;
          if (action === 'REACTIVATE' && finding?.mitigated) {
            action = 'REOPEN';
          }
          return this.defectDojoService
            .updateFindingStatus(this.appId!, id, action, this.selectedBranch)
            .pipe(
              map(d => ({ ok: true as const, data: d })),
              catchError(err => of({ ok: false as const, id, err }))
            );
        }),
        toArray(),
        finalize(() => (this.bulkActionLoading = false))
      )
      .subscribe({
        next: results => {
          const errors = results.filter(r => !r.ok);
          const successes = results.filter((r): r is { ok: true; data: DefectDojoFindingItem } => r.ok);
          for (const { data: d } of successes) {
            this.patchFindingInList(d);
            this.selectedFindingIds.delete(d.id);
          }
          this.editTargetIds = [];
          this.bulkEditOpen = false;

          if (errors.length > 0) {
            const failed = errors[0] as { ok: false; id: number; err: { error?: { message?: string } } };
            this.bulkActionError =
              failed?.err?.error?.message ||
              `${errors.length} mise(s) à jour en échec sur ${ids.length}.`;
          } else {
            this.bulkActionMessage = `${successes.length} finding(s) mis à jour dans DefectDojo.`;
          }

          if (
            this.selectedCategory === 'open' &&
            successes.some(
              ({ data: d }) =>
                d.falsePositive || d.outOfScope || d.mitigated || d.riskAccepted || !d.active
            )
          ) {
            this.loadFindings();
          }
        },
        error: () => {
          this.bulkActionError = 'Échec de la mise à jour DefectDojo.';
        }
      });
  }

  deleteSelected(): void {
    this.deleteFindings([...this.selectedFindingIds]);
  }

  deleteSingleFinding(f: DefectDojoFindingItem): void {
    if (f.id == null) return;
    this.rowMenuOpenId = null;
    this.deleteFindings([f.id]);
  }

  private deleteFindings(ids: number[]): void {
    if (!this.appId || ids.length === 0 || this.bulkActionLoading) return;
    const label = ids.length === 1 ? 'ce finding' : `${ids.length} findings`;
    if (!window.confirm(`Supprimer définitivement ${label} dans DefectDojo ?`)) return;

    this.bulkActionLoading = true;
    this.bulkActionError = null;
    this.bulkActionMessage = null;

    from(ids)
      .pipe(
        concatMap(id =>
          this.defectDojoService.deleteFinding(this.appId!, id, this.selectedBranch).pipe(
            map(() => ({ ok: true as const, id })),
            catchError(() => of({ ok: false as const, id }))
          )
        ),
        toArray(),
        finalize(() => (this.bulkActionLoading = false))
      )
      .subscribe({
        next: results => {
          const deleted = results.filter((r): r is { ok: true; id: number } => r.ok).map(r => r.id);
          const failed = results.filter(r => !r.ok).length;
          for (const id of deleted) {
            this.removeFindingFromList(id);
            this.selectedFindingIds.delete(id);
          }
          this.editTargetIds = [];
          this.bulkEditOpen = false;

          if (failed > 0) {
            this.bulkActionError = `${failed} suppression(s) en échec sur ${ids.length}.`;
          } else {
            this.bulkActionMessage = `${deleted.length} finding(s) supprimé(s).`;
          }
        },
        error: () => {
          this.bulkActionError = 'Échec de la suppression DefectDojo.';
        }
      });
  }

  private patchFindingInList(d: {
    id: number;
    status: string;
    active: boolean;
    verified: boolean;
    mitigated: boolean;
    falsePositive?: boolean;
    outOfScope?: boolean;
    riskAccepted?: boolean;
    underReview?: boolean;
    scanType?: string;
    toolName?: string;
    testId?: number;
  }): void {
    const idx = this.findings.findIndex(x => x.id === d.id);
    if (idx < 0) return;
    const updated: DefectDojoFindingItem = {
      ...this.findings[idx],
      status: d.status,
      active: d.active,
      verified: d.verified,
      mitigated: d.mitigated,
      falsePositive: d.falsePositive,
      outOfScope: d.outOfScope,
      riskAccepted: d.riskAccepted,
      scanType: d.scanType ?? this.findings[idx].scanType,
      toolName: d.toolName ?? this.findings[idx].toolName
    };
    this.findings = [
      ...this.findings.slice(0, idx),
      updated,
      ...this.findings.slice(idx + 1)
    ];
    this.refreshFilteredFindings();
  }

  private removeFindingFromList(id: number): void {
    this.findings = this.findings.filter(x => x.id !== id);
    this.totalElements = Math.max(0, this.totalElements - 1);
    this.refreshFilteredFindings();
  }

  get selectedCategoryLabel(): string {
    return this.dashboard?.metricCards?.find(c => c.key === this.selectedCategory)?.label || this.selectedCategory;
  }

  get charts() {
    return this.dashboard?.charts;
  }

  get severityTotal(): number {
    return this.severities.reduce((sum, s) => sum + this.severityCount(s), 0);
  }

  get scanTestCount(): number {
    return this.charts?.scanSnapshots?.length ?? 0;
  }

  get openFindingsSubtitle(): string {
    return `${this.resolutionOpenCount} finding(s) ouvert(s) — branche ${this.selectedBranch || '—'}`;
  }

  get scanSnapshotsSubtitle(): string {
    const n = this.charts?.scanSnapshots?.length ?? 0;
    return `${n} import(s) DefectDojo`;
  }

  get findingAgeSubtitle(): string {
    const n = this.charts?.detailedMetrics?.openFindingsForAge ?? 0;
    return `${n} finding(s) ouvert(s) analysés`;
  }

  get openCweSubtitle(): string {
    const total = Object.values(this.charts?.detailedMetrics?.openCwe ?? {}).reduce((a, b) => a + b, 0);
    return `${total} occurrence(s) CWE sur findings ouverts`;
  }

  get scanToolStackSubtitle(): string {
    const snaps = this.charts?.scanSnapshots ?? [];
    const total = snaps.reduce((sum, s) => sum + (s.totalOpen ?? 0), 0);
    return `${snaps.length} outil(s) · ${total} finding(s) ouvert(s) répartis`;
  }

  severityCount(sev: string): number {
    return this.charts?.bySeverity?.[sev]
      ?? this.dashboard?.bySeverity?.[sev]
      ?? 0;
  }

  get resolutionOpenCount(): number {
    return this.charts?.openCount ?? this.dashboard?.totalActive ?? 0;
  }

  get resolutionClosedCount(): number {
    return this.charts?.closedCount ?? this.dashboard?.totalMitigated ?? 0;
  }

  get resolutionTotalCount(): number {
    return this.charts?.totalCount
      ?? ((this.dashboard?.totalActive ?? 0) + (this.dashboard?.totalMitigated ?? 0));
  }

  envCountForBranch(branch: string): number {
    return branch?.trim() ? 1 : 0;
  }

  mapEntries(m?: Record<string, number>): { key: string; value: number }[] {
    if (!m) return [];
    return Object.entries(m)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, value }));
  }

  private syncQueryParams(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        branch: this.selectedBranch,
        category: this.selectedCategory,
        pipelineId: this.selectedPipelineId || null
      },
      queryParamsHandling: 'merge'
    });
  }

  private destroyCharts(): void {
    if (this.chartRenderTimer) {
      clearTimeout(this.chartRenderTimer);
      this.chartRenderTimer = undefined;
    }
    this.openSeverityChart?.destroy();
    this.openSeverityChart = undefined;
    const evolutionCanvas = this.evolutionSeverityCanvas?.nativeElement;
    if (evolutionCanvas) Chart.getChart(evolutionCanvas)?.destroy();
    this.fluxChart?.destroy();
    this.fluxChart = undefined;
    this.chartInstances.forEach(c => c.destroy());
    this.chartInstances = [];
  }

  private renderCharts(): void {
    this.destroyCharts();
    const c = this.dashboard?.charts;
    if (!c) return;

    this.renderOverviewCharts();
    this.scheduleOpenSeverityChartRender();
    this.renderDetailedCharts(c.detailedMetrics);
    this.renderScanChart(c);
  }

  private renderOverviewCharts(): void {
    const cards = this.dashboard?.metricCards ?? [];
    const canvases = this.overviewCharts?.toArray() ?? [];
    cards.forEach((card, index) => {
      const canvas = canvases[index]?.nativeElement;
      if (!canvas) return;
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: this.severities,
          datasets: [{
            data: this.severities.map(s => card.bySeverity?.[s] || 0),
            backgroundColor: this.severities.map(s => this.severityColor(s)),
            borderRadius: 3
          }]
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { font: { size: 8 }, color: THEME.slate }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 8 } }, grid: { color: 'rgba(15,23,42,0.06)' } }
          }
        }
      });
      this.chartInstances.push(chart);
    });
  }

  private renderDetailedCharts(dm?: DefectDojoDetailedMetrics): void {
    this.renderFluxChart();
    if (!dm) return;
    this.renderFindingAgeChart(dm);
    this.renderCweChart(this.openCweCanvas?.nativeElement, dm.openCwe, 'CWE ouverts');
  }

  private renderFluxChart(): void {
    const canvas = this.fluxCanvas?.nativeElement;
    if (!canvas || !this.hasFluxChart || this.loading) return;
    this.fluxChart = renderTreatmentFluxChart(canvas, this.charts, this.fluxGranularity, this.fluxChart);
  }

  private scheduleOpenSeverityChartRender(): void {
    if (this.chartRenderTimer) clearTimeout(this.chartRenderTimer);
    this.chartRenderTimer = setTimeout(() => {
      this.ngZone.runOutsideAngular(() => this.renderOpenSeverityChart());
    }, 120);
  }

  private renderOpenSeverityChart(): void {
    const canvas = this.evolutionSeverityCanvas?.nativeElement;
    if (!canvas || !this.hasOpenSeverityChart || this.loading) return;
    this.openSeverityChart = renderOpenSeverityEvolutionChart(
      canvas,
      this.dashboard?.charts,
      this.openSeverityGranularity,
      this.severities,
      this.openSeverityChart
    );
  }

  private renderFindingAgeChart(dm: DefectDojoDetailedMetrics): void {
    if (!this.findingAgeCanvas?.nativeElement || !dm.findingAgeBuckets) return;
    const entries = Object.entries(dm.findingAgeBuckets);
    if (!entries.some(([, v]) => v > 0)) return;
    const total = dm.openFindingsForAge || entries.reduce((s, [, v]) => s + v, 0);
    const ageColors = ['#94a3b8', '#f59e0b', '#ea580c', '#b91c1c'];
    const chart = new Chart(this.findingAgeCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]),
          backgroundColor: entries.map((_, i) => ageColors[Math.min(i, ageColors.length - 1)]),
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const y = ctx.parsed.y ?? 0;
                return ` ${y} finding(s) — ${Math.round((y / Math.max(total, 1)) * 100)} %`;
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: "Ancienneté du finding (depuis sa détection)", font: { size: 11, weight: 'bold' } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Nombre de findings ouverts', font: { size: 11, weight: 'bold' } },
            ticks: { stepSize: 1, precision: 0 }
          }
        }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderCweChart(canvas: HTMLCanvasElement | undefined, data: Record<string, number> | undefined, title: string): void {
    if (!canvas || !data) return;
    const entries = this.mapEntries(data);
    if (!entries.length) return;
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(e => cweDisplayLabel(e.key)),
        datasets: [{
          label: title,
          data: entries.map(e => e.value),
          backgroundColor: THEME.orangeSoft,
          borderColor: THEME.orangeDark,
          borderWidth: 1,
          borderRadius: 3
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const totalOcc = entries.reduce((s, e) => s + e.value, 0);
                const v = ctx.parsed.x ?? 0;
                return ` ${v} finding(s) — ${Math.round((v / totalOcc) * 100)} % des occurrences`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            title: { display: true, text: 'Findings ouverts', font: { size: 11, weight: 'bold' } },
            ticks: { stepSize: 1, precision: 0 }
          },
          y: {
            title: { display: true, text: 'Famille de faiblesse (CWE)', font: { size: 11, weight: 'bold' } },
            ticks: { font: { size: 10 } }
          }
        },
        onClick: (_evt, elements) => {
          if (!elements.length) return;
          const cwe = entries[elements[0].index]?.key;
          if (cwe) {
            this.ngZone.run(() => {
              this.selectedCategory = 'open';
              this.searchQuery = cwe;
              this.showFindingsTable = true;
              this.loadFindings();
              this.scrollToFindings();
            });
          }
        }
      }
    });
    this.chartInstances.push(chart);
  }

  private renderScanChart(c: NonNullable<DefectDojoDashboardResponse['charts']>): void {
    if (!this.scanCanvas?.nativeElement || !c.scanSnapshots?.length) return;
    const latestByTool = new Map<string, typeof c.scanSnapshots[number]>();
    for (const s of c.scanSnapshots) {
      const key = s.scanType || String(s.testId);
      const prev = latestByTool.get(key);
      if (!prev || (s.timestamp || s.date || '') > (prev.timestamp || prev.date || '')) {
        latestByTool.set(key, s);
      }
    }
    const snapshots = [...latestByTool.values()].sort((a, b) => (b.totalOpen || 0) - (a.totalOpen || 0));

    const chart = new Chart(this.scanCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: snapshots.map(s => s.scanType || s.label || `Test #${s.testId}`),
        datasets: this.severities.map(sev => ({
          label: sev,
          data: snapshots.map(s => s.bySeverity?.[sev] || 0),
          backgroundColor: this.severityColor(sev)
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              title: items => {
                const s = snapshots[items[0].dataIndex];
                return `${s.scanType || s.label} — import du ${s.timestamp || s.date || '?'}`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: true,
            title: { display: true, text: 'Outil de scan (dernier import)', font: { size: 11, weight: 'bold' } },
            ticks: { font: { size: 10 } }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            title: { display: true, text: 'Findings ouverts par sévérité', font: { size: 11, weight: 'bold' } },
            ticks: { precision: 0 }
          }
        },
        onClick: (_evt, elements) => {
          if (!elements.length) return;
          const snap = snapshots[elements[0].index];
          if (snap?.testId) this.ngZone.run(() => this.filterByTool(snap.testId));
        }
      }
    });
    this.chartInstances.push(chart);
  }
}
