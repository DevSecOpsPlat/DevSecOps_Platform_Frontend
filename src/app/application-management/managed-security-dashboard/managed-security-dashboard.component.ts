import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, from, of, Subject } from 'rxjs';
import { catchError, concatMap, finalize, map, takeUntil, timeout, toArray } from 'rxjs/operators';
import {
  AppServiceModel,
  SecurityPostureResponse
} from '../../models/application-management/application-management.models';
import {
  DefectDojoDashboardResponse,
  DefectDojoFindingItem,
  DefectDojoFindingStatusAction,
  DefectDojoFindingsPage,
  DefectDojoMetricCard,
  DefectDojoMetricCategory,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';
import { QualityGateService, QualityGateEnvironmentOption } from '../../services/quality-gate/quality-gate.service';
import { isHardBlocked } from '../shared/verdict.util';

const METRIC_META: Record<DefectDojoMetricCategory, { icon: string }> = {
  verified: { icon: '✓' },
  open: { icon: '⚠' },
  risk_accepted: { icon: '⚖' },
  closed: { icon: '✔' },
  false_positive: { icon: '⊘' },
  out_of_scope: { icon: '↗' },
  total: { icon: '∑' },
  inactive: { icon: '○' }
};

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'] as const;

export interface ManagedFindingRow extends DefectDojoFindingItem {
  serviceId: string;
  serviceName: string;
  serviceBranch: string;
}

interface ServiceDashSlice {
  serviceId: string;
  serviceName: string;
  branch: string;
  dashboard: DefectDojoDashboardResponse | null;
  error?: string;
}

interface FindingRowAction {
  action: DefectDojoFindingStatusAction;
  label: string;
  confirm?: string;
}

/**
 * Dashboard DefectDojo côté app managée.
 * Totaux = somme client des getDashboard() par service (filtre actif),
 * fallback posture.bySeverity si aucun engagement live et filtre « tous ».
 */
@Component({
  selector: 'app-managed-security-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './managed-security-dashboard.component.html',
  styleUrls: [
    '../../project/shared/security-list.styles.css',
    '../../project/security-dashboard/security-dashboard.component.css',
    './managed-security-dashboard.component.css'
  ]
})
export class ManagedSecurityDashboardComponent implements OnChanges, OnDestroy {
  @Input() managedAppId!: string;
  @Input() appName = '';
  @Input() services: AppServiceModel[] = [];
  @Input() posture: SecurityPostureResponse | null = null;
  @Input() refreshTick = 0;

  private readonly destroy$ = new Subject<void>();
  private readonly loadCancel$ = new Subject<void>();

  loading = false;
  listLoading = false;
  error: string | null = null;

  /** Filtres — « ALL » par défaut (tous les services / branches / pipelines). */
  serviceFilter = 'ALL';
  branchFilter = 'ALL';
  pipelineFilter = 'ALL';

  branchOptions: string[] = [];
  pipelineOptions: Array<{ id: string; label: string }> = [];

  slices: ServiceDashSlice[] = [];

  bySeverity: Record<string, number> = {};
  metricCards: DefectDojoMetricCard[] = [];
  configuredCount = 0;

  selectedCategory: DefectDojoMetricCategory = 'open';
  showFindingsTable = false;
  findings: ManagedFindingRow[] = [];
  filteredFindings: ManagedFindingRow[] = [];
  page = 0;
  readonly size = 25;
  totalElements = 0;

  filterSeverity = '';
  searchQuery = '';

  readonly severities = [...SEVERITIES];

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

  constructor(
    private defectDojo: DefectDojoService,
    private qualityGate: QualityGateService,
    private router: Router
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['services'] || changes['managedAppId']) {
      this.refreshBranchOptions();
      this.reload();
      this.loadPipelineOptions();
    } else if (changes['refreshTick'] && !changes['refreshTick'].firstChange) {
      this.reload();
      this.loadPipelineOptions();
    } else if (changes['posture']) {
      this.recomputeAggregate();
    }
  }

  ngOnDestroy(): void {
    this.loadCancel$.next();
    this.loadCancel$.complete();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get severityTotal(): number {
    return SEVERITIES.reduce((n, s) => n + this.severityCount(s), 0);
  }

  get openFindingsSubtitle(): string {
    const c = this.severityCount('Critical');
    const h = this.severityCount('High');
    return `${this.severityTotal} open · ${c} Critical · ${h} High — ${this.filterSummary}`;
  }

  get filterSummary(): string {
    const parts = [this.serviceFilterLabel];
    if (this.branchFilter !== 'ALL') parts.push(`branche ${this.branchFilter}`);
    if (this.pipelineFilter !== 'ALL') parts.push(`pipeline #${this.pipelineFilter}`);
    return parts.join(' · ');
  }

  get serviceFilterLabel(): string {
    if (this.serviceFilter === 'ALL') return 'tous les services';
    const s = this.services.find(x => x.id === this.serviceFilter);
    return s?.name || 'service';
  }

  get selectedCategoryLabel(): string {
    const card = this.metricCards.find(c => c.key === this.selectedCategory);
    return card?.label || this.selectedCategory;
  }

  get hasAnyEngagement(): boolean {
    return this.configuredCount > 0;
  }

  get visibleSlices(): ServiceDashSlice[] {
    return this.activeSlices();
  }

  get hasSelection(): boolean {
    return this.selectedFindingIds.size > 0;
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

  isFindingChecked(f: ManagedFindingRow): boolean {
    return f.id != null && this.selectedFindingIds.has(f.id);
  }

  toggleFindingSelection(f: ManagedFindingRow, event: Event): void {
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

  openRowEdit(f: ManagedFindingRow): void {
    if (f.id == null) return;
    this.editTargetIds = [f.id];
    this.bulkEditOpen = true;
    this.rowMenuOpenId = null;
    this.bulkActionError = null;
    this.bulkActionMessage = null;
  }

  applyBulkAction(btn: FindingRowAction): void {
    const ids = this.activeEditIds;
    if (ids.length === 0 || this.bulkActionLoading) return;
    if (btn.confirm && !window.confirm(btn.confirm)) return;

    this.bulkActionLoading = true;
    this.bulkActionError = null;
    this.bulkActionMessage = null;

    from(ids)
      .pipe(
        concatMap(id => {
          const finding = this.findings.find(x => x.id === id);
          if (!finding?.serviceId) {
            return of({ ok: false as const, id, err: { error: { message: 'Service introuvable pour ce finding.' } } });
          }
          let action: DefectDojoFindingStatusAction = btn.action;
          if (action === 'REACTIVATE' && finding.mitigated) {
            action = 'REOPEN';
          }
          return this.defectDojo
            .updateFindingStatus(finding.serviceId, id, action, finding.serviceBranch)
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

  deleteSingleFinding(f: ManagedFindingRow): void {
    if (f.id == null) return;
    this.rowMenuOpenId = null;
    this.deleteFindings([f.id]);
  }

  private deleteFindings(ids: number[]): void {
    if (ids.length === 0 || this.bulkActionLoading) return;
    const label = ids.length === 1 ? 'ce finding' : `${ids.length} findings`;
    if (!window.confirm(`Supprimer définitivement ${label} dans DefectDojo ?`)) return;

    this.bulkActionLoading = true;
    this.bulkActionError = null;
    this.bulkActionMessage = null;

    from(ids)
      .pipe(
        concatMap(id => {
          const finding = this.findings.find(x => x.id === id);
          if (!finding?.serviceId) {
            return of({ ok: false as const, id });
          }
          return this.defectDojo
            .deleteFinding(finding.serviceId, id, finding.serviceBranch)
            .pipe(
              map(() => ({ ok: true as const, id })),
              catchError(() => of({ ok: false as const, id }))
            );
        }),
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

  private patchFindingInList(d: DefectDojoFindingItem): void {
    const idx = this.findings.findIndex(x => x.id === d.id);
    if (idx < 0) return;
    const updated: ManagedFindingRow = {
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

  severityCount(sev: string): number {
    const key = sev.toLowerCase();
    return this.bySeverity[key] ?? this.bySeverity[sev] ?? 0;
  }

  metricMeta(key: DefectDojoMetricCategory): { icon: string } {
    return METRIC_META[key] || { icon: '•' };
  }

  /** (change) natif — évite les boucles ngModelChange sur refresh d’options. */
  onServiceFilterChange(): void {
    this.refreshBranchOptions();
    this.pipelineFilter = 'ALL';
    this.loadPipelineOptions();
    this.reload();
  }

  onBranchFilterChange(): void {
    this.pipelineFilter = 'ALL';
    this.loadPipelineOptions();
    this.reload();
  }

  onPipelineFilterChange(): void {
    this.reload();
  }

  reload(): void {
    const list = this.servicesForLoad();
    if (!list.length) {
      this.slices = [];
      this.bySeverity = {};
      this.metricCards = [];
      this.configuredCount = 0;
      this.error = null;
      this.loading = false;
      return;
    }

    this.loading = true;
    this.error = null;
    this.loadCancel$.next();

    const tags = this.selectedDefectDojoTag();

    const calls = list.map(svc =>
      this.defectDojo.getDashboard(
        svc.id!,
        this.branchForService(svc),
        tags,
        true
      ).pipe(
        timeout(120_000),
        catchError(err => of({
          __error: err?.error?.message || err?.message || 'Erreur DefectDojo',
          configured: false
        } as any))
      )
    );

    forkJoin(calls).pipe(
      takeUntil(this.loadCancel$),
      takeUntil(this.destroy$),
      finalize(() => (this.loading = false))
    ).subscribe({
      next: (results) => {
        this.slices = list.map((svc, i) => {
          const raw = results[i] as any;
          if (raw?.__error) {
            return {
              serviceId: svc.id!,
              serviceName: svc.name,
              branch: this.branchForService(svc),
              dashboard: null,
              error: String(raw.__error)
            };
          }
          return {
            serviceId: svc.id!,
            serviceName: svc.name,
            branch: this.branchForService(svc),
            dashboard: raw as DefectDojoDashboardResponse
          };
        });
        this.recomputeAggregate();
        if (this.showFindingsTable) this.loadFindings();
      },
      error: () => {
        this.error = 'Impossible de charger le dashboard DefectDojo agrégé.';
        this.slices = [];
      }
    });
  }

  private servicesForLoad(): AppServiceModel[] {
    const all = (this.services || []).filter(s => !!s.id);
    if (this.serviceFilter === 'ALL') return all;
    return all.filter(s => s.id === this.serviceFilter);
  }

  private branchForService(svc: AppServiceModel): string {
    if (this.branchFilter !== 'ALL') return this.branchFilter;
    return (svc.gitBranch || 'main').trim() || 'main';
  }

  private selectedDefectDojoTag(): string {
    if (this.pipelineFilter !== 'ALL' && this.pipelineFilter) {
      return this.defectDojo.pipelineTag(this.pipelineFilter);
    }
    return this.defectDojo.scanKindTag();
  }

  private refreshBranchOptions(): void {
    const src = this.serviceFilter === 'ALL'
      ? this.services
      : this.services.filter(s => s.id === this.serviceFilter);
    const set = new Set<string>();
    for (const s of src || []) {
      const b = (s.gitBranch || 'main').trim() || 'main';
      set.add(b);
    }
    if (!set.size) set.add('main');
    this.branchOptions = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (this.branchFilter !== 'ALL' && !this.branchOptions.includes(this.branchFilter)) {
      this.branchFilter = 'ALL';
    }
  }

  private loadPipelineOptions(): void {
    const targets = this.servicesForLoad();
    if (!targets.length) {
      this.pipelineOptions = [];
      return;
    }

    const calls = targets.map(svc =>
      this.qualityGate.listScanPipelines(
        svc.id!,
        this.branchFilter !== 'ALL' ? this.branchFilter : (svc.gitBranch || undefined)
      ).pipe(
        map((envs: QualityGateEnvironmentOption[]) => (envs ?? [])
          .filter(e => e.pipelineId)
          .map(e => String(e.pipelineId))
        ),
        catchError(() => of([] as string[])),
        takeUntil(this.destroy$)
      )
    );

    forkJoin(calls).pipe(takeUntil(this.destroy$)).subscribe(lists => {
      const ids = new Set<string>();
      for (const list of lists) {
        for (const id of list) ids.add(id);
      }
      this.pipelineOptions = Array.from(ids)
        .sort((a, b) => Number(b) - Number(a) || b.localeCompare(a))
        .map(id => ({ id, label: `#${id}` }));
      if (this.pipelineFilter !== 'ALL' && !ids.has(this.pipelineFilter)) {
        this.pipelineFilter = 'ALL';
      }
    });
  }

  private activeSlices(): ServiceDashSlice[] {
    return this.slices;
  }

  private recomputeAggregate(): void {
    const active = this.activeSlices();
    const sev: Record<string, number> = {
      critical: 0, high: 0, medium: 0, low: 0, info: 0
    };
    const cardMap = new Map<DefectDojoMetricCategory, DefectDojoMetricCard>();
    let configured = 0;

    for (const slice of active) {
      const d = slice.dashboard;
      if (!d?.configured || !d.engagementId) continue;
      configured++;
      const bs = d.bySeverity || {};
      for (const k of Object.keys(sev)) {
        const v = bs[k] ?? bs[k.charAt(0).toUpperCase() + k.slice(1)] ?? 0;
        sev[k] += typeof v === 'number' ? v : 0;
      }
      for (const card of d.metricCards || []) {
        const prev = cardMap.get(card.key);
        if (!prev) {
          cardMap.set(card.key, {
            key: card.key,
            label: card.label,
            total: card.total || 0,
            bySeverity: { ...(card.bySeverity || {}) }
          });
        } else {
          prev.total = (prev.total || 0) + (card.total || 0);
          const merged = { ...(prev.bySeverity || {}) };
          for (const [sk, sv] of Object.entries(card.bySeverity || {})) {
            merged[sk] = (merged[sk] || 0) + (sv || 0);
          }
          prev.bySeverity = merged;
        }
      }
    }

    // Fallback posture si DD live vide et filtres « tous »
    if (
      configured === 0
      && this.posture?.bySeverity
      && this.serviceFilter === 'ALL'
      && this.branchFilter === 'ALL'
      && this.pipelineFilter === 'ALL'
    ) {
      for (const k of Object.keys(sev)) {
        sev[k] = this.posture.bySeverity[k] ?? 0;
      }
    }

    this.bySeverity = sev;
    this.metricCards = Array.from(cardMap.values());
    this.configuredCount = configured;

    if (!this.metricCards.length && this.severityTotal > 0) {
      this.metricCards = [
        { key: 'open', label: 'Open', total: this.severityTotal, bySeverity: { ...sev } },
        { key: 'total', label: 'Total', total: this.severityTotal, bySeverity: { ...sev } }
      ];
    }
  }

  filterBySeverity(sev: string): void {
    this.filterSeverity = sev || '';
    this.selectedCategory = 'open';
    this.showFindingsTable = true;
    this.page = 0;
    this.loadFindings();
    this.scrollToFindings();
  }

  selectCategory(card: DefectDojoMetricCard): void {
    this.selectedCategory = card.key;
    this.showFindingsTable = true;
    this.page = 0;
    this.loadFindings();
    this.scrollToFindings();
  }

  private scrollToFindings(): void {
    setTimeout(() => document.getElementById('dd-findings-table')?.scrollIntoView({ behavior: 'smooth' }), 80);
  }

  loadFindings(): void {
    const active = this.activeSlices().filter(s => s.dashboard?.engagementId);
    if (!active.length) {
      this.findings = [];
      this.filteredFindings = [];
      this.totalElements = 0;
      return;
    }

    this.listLoading = true;
    const tags = this.selectedDefectDojoTag();
    const multi = active.length > 1;

    const calls = active.map(slice =>
      this.defectDojo.getFindings(
        slice.serviceId,
        slice.branch,
        this.selectedCategory,
        multi ? 0 : this.page,
        multi ? 50 : this.size,
        this.filterSeverity || undefined,
        tags
      ).pipe(
        timeout(60_000),
        catchError(() => of({
          content: [],
          totalElements: 0,
          totalPages: 0,
          page: 0,
          size: 0,
          category: this.selectedCategory
        } as DefectDojoFindingsPage))
      )
    );

    forkJoin(calls).pipe(
      takeUntil(this.loadCancel$),
      takeUntil(this.destroy$),
      finalize(() => (this.listLoading = false))
    ).subscribe({
      next: (pages) => {
        const rows: ManagedFindingRow[] = [];
        let total = 0;
        pages.forEach((p, i) => {
          const slice = active[i];
          total += p.totalElements ?? 0;
          for (const f of p.content || []) {
            rows.push({
              ...f,
              serviceId: slice.serviceId,
              serviceName: slice.serviceName,
              serviceBranch: slice.branch
            });
          }
        });
        const order: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
        rows.sort((a, b) => {
          const sa = order[a.severity || ''] ?? 9;
          const sb = order[b.severity || ''] ?? 9;
          if (sa !== sb) return sa - sb;
          return String(b.created || '').localeCompare(String(a.created || ''));
        });

        if (multi) {
          const start = this.page * this.size;
          this.findings = rows.slice(start, start + this.size);
          this.totalElements = Math.max(total, rows.length);
        } else {
          this.findings = rows;
          this.totalElements = total;
        }
        this.refreshFilteredFindings();
      }
    });
  }

  onListFiltersChanged(): void {
    this.page = 0;
    this.loadFindings();
  }

  onSearchQueryChanged(): void {
    this.refreshFilteredFindings();
  }

  clearFilters(): void {
    this.filterSeverity = '';
    this.searchQuery = '';
    this.page = 0;
    this.loadFindings();
  }

  private refreshFilteredFindings(): void {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      this.filteredFindings = [...this.findings];
      return;
    }
    this.filteredFindings = this.findings.filter(f =>
      (f.title || '').toLowerCase().includes(q)
      || (f.cve || '').toLowerCase().includes(q)
      || (f.filePath || '').toLowerCase().includes(q)
      || (f.serviceName || '').toLowerCase().includes(q)
      || (f.toolName || '').toLowerCase().includes(q)
    );
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

  toolLabel(f: DefectDojoFindingItem): string {
    return f.toolName || f.scanType || f.testTitle || '—';
  }

  trackFindingRow(_: number, f: ManagedFindingRow): number | string {
    return f.id ?? `${f.serviceId}-${f.title}`;
  }

  trackSlice(_: number, slice: ServiceDashSlice): string {
    return slice.serviceId;
  }

  openDetail(f: ManagedFindingRow): void {
    if (!f.serviceId || f.id == null) return;
    this.rememberManagedApp();
    this.router.navigate(['/project', f.serviceId, 'security-dashboard', 'finding', f.id], {
      queryParams: { branch: f.serviceBranch || undefined }
    });
  }

  openServiceHub(slice: ServiceDashSlice, event?: Event): void {
    event?.stopPropagation();
    this.rememberManagedApp();
    const qp: Record<string, string> = {
      branch: slice.branch || 'main'
    };
    if (this.pipelineFilter !== 'ALL') {
      qp['pipelineId'] = this.pipelineFilter;
    }
    this.router.navigate(['/project', slice.serviceId, 'security-dashboard'], {
      queryParams: qp
    });
  }

  isBlocked(verdict: string | null | undefined): boolean {
    return isHardBlocked(verdict);
  }

  servicePostureVerdict(serviceId: string): string | null {
    return this.posture?.services?.find(s => s.serviceId === serviceId)?.verdict || null;
  }

  serviceRole(serviceId: string): string {
    const role = this.services.find(s => s.id === serviceId)?.role;
    return role ? String(role) : '';
  }

  private rememberManagedApp(): void {
    try {
      localStorage.setItem('envirotest-last-managed-app-id', this.managedAppId);
      if (this.appName) localStorage.setItem('envirotest-last-managed-app-name', this.appName);
    } catch { /* ignore */ }
  }
}
