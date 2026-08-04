import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, finalize, takeUntil, timeout } from 'rxjs/operators';
import {
  AppServiceModel,
  QualityGateItem,
  SecurityPostureResponse
} from '../../models/application-management/application-management.models';
import {
  DefectDojoDashboardResponse,
  DefectDojoFindingItem,
  DefectDojoFindingsPage,
  DefectDojoMetricCard,
  DefectDojoMetricCategory,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';
import { isHardBlocked, verdictLabelFr, verdictTone } from '../shared/verdict.util';

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

  private readonly destroy$ = new Subject<void>();
  private readonly loadCancel$ = new Subject<void>();

  loading = false;
  listLoading = false;
  error: string | null = null;

  serviceFilter = 'ALL';
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

  constructor(
    private defectDojo: DefectDojoService,
    private router: Router
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['services'] || changes['managedAppId']) {
      this.reload();
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

  get qualityGates(): QualityGateItem[] {
    return this.posture?.qualityGates || [];
  }

  get severityTotal(): number {
    return SEVERITIES.reduce((n, s) => n + this.severityCount(s), 0);
  }

  get openFindingsSubtitle(): string {
    const c = this.severityCount('Critical');
    const h = this.severityCount('High');
    return `${this.severityTotal} open · ${c} Critical · ${h} High — rollup ${this.serviceFilterLabel}`;
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

  get verdictLabel(): string {
    return verdictLabelFr(this.posture?.verdict);
  }

  get verdictToneClass(): string {
    return 'ad-verdict-' + verdictTone(this.posture?.verdict);
  }

  get hasAnyEngagement(): boolean {
    return this.configuredCount > 0;
  }

  severityCount(sev: string): number {
    const key = sev.toLowerCase();
    return this.bySeverity[key] ?? this.bySeverity[sev] ?? 0;
  }

  metricMeta(key: DefectDojoMetricCategory): { icon: string } {
    return METRIC_META[key] || { icon: '•' };
  }

  qualityGateStatusLabel(status: string | null | undefined): string {
    const s = (status || '').toUpperCase();
    if (s === 'FAIL') return 'Échec';
    if (s === 'PASS') return 'OK';
    if (s === 'WARN') return 'Attention';
    return 'Inconnu';
  }

  reload(): void {
    const list = (this.services || []).filter(s => !!s.id);
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

    const calls = list.map(svc =>
      this.defectDojo.getDashboard(
        svc.id!,
        (svc.gitBranch || 'main').trim() || 'main',
        this.defectDojo.scanKindTag(),
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
              branch: svc.gitBranch || 'main',
              dashboard: null,
              error: String(raw.__error)
            };
          }
          return {
            serviceId: svc.id!,
            serviceName: svc.name,
            branch: svc.gitBranch || 'main',
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

  onServiceFilterChange(): void {
    this.recomputeAggregate();
    this.page = 0;
    if (this.showFindingsTable) this.loadFindings();
  }

  private activeSlices(): ServiceDashSlice[] {
    if (this.serviceFilter === 'ALL') return this.slices;
    return this.slices.filter(s => s.serviceId === this.serviceFilter);
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

    // Fallback sévérité depuis posture si DD live vide
    if (configured === 0 && this.posture?.bySeverity && this.serviceFilter === 'ALL') {
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
  }

  selectCategory(card: DefectDojoMetricCard): void {
    this.selectedCategory = card.key;
    this.showFindingsTable = true;
    this.page = 0;
    this.loadFindings();
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
    const calls = active.map(slice =>
      this.defectDojo.getFindings(
        slice.serviceId,
        slice.branch,
        this.selectedCategory,
        this.serviceFilter === 'ALL' ? 0 : this.page,
        this.serviceFilter === 'ALL' ? 50 : this.size,
        this.filterSeverity || undefined,
        this.defectDojo.scanKindTag()
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
        // Tri sévérité puis date
        const order: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
        rows.sort((a, b) => {
          const sa = order[a.severity || ''] ?? 9;
          const sb = order[b.severity || ''] ?? 9;
          if (sa !== sb) return sa - sb;
          return String(b.created || '').localeCompare(String(a.created || ''));
        });

        if (this.serviceFilter === 'ALL') {
          const start = this.page * this.size;
          this.findings = rows.slice(start, start + this.size);
          this.totalElements = rows.length; // client-side merge page
          // Prefer server totals when single round: use sum of totals as estimate
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

  openDetail(f: ManagedFindingRow): void {
    if (!f.serviceId || f.id == null) return;
    try {
      localStorage.setItem('envirotest-last-managed-app-id', this.managedAppId);
      if (this.appName) localStorage.setItem('envirotest-last-managed-app-name', this.appName);
    } catch { /* ignore */ }
    this.router.navigate(['/project', f.serviceId, 'security-dashboard', 'finding', f.id], {
      queryParams: { branch: f.serviceBranch || undefined }
    });
  }

  openServiceHub(slice: ServiceDashSlice): void {
    try {
      localStorage.setItem('envirotest-last-managed-app-id', this.managedAppId);
      if (this.appName) localStorage.setItem('envirotest-last-managed-app-name', this.appName);
    } catch { /* ignore */ }
    this.router.navigate(['/project', slice.serviceId, 'security-dashboard']);
  }

  isBlocked(verdict: string | null | undefined): boolean {
    return isHardBlocked(verdict);
  }

  servicePostureVerdict(serviceId: string): string | null {
    return this.posture?.services?.find(s => s.serviceId === serviceId)?.verdict || null;
  }
}
