import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { SonarQubeService } from '../services/sonarqube/sonarqube.service';
import { UserService } from '../services/user/user.service';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-sonarqube',
  templateUrl: './sonarqube.component.html',
  styleUrls: ['./sonarqube.component.css']
})
export class SonarqubeComponent implements OnInit, OnDestroy, AfterViewInit {
  /** Active des logs console pour diagnostiquer les facets issues. */
  readonly debugIssues = true;

  @ViewChild('donutCanvas') donutCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('coverageBarCanvas') coverageBarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('severityBarCanvas') severityBarCanvas!: ElementRef<HTMLCanvasElement>;

  loading = true;
  error: string | null = null;

  metrics: any = null;
  totalIssues = 0;
  totalHotspots = 0;
  issues: any[] = [];
  /** Toutes les issues renvoyées par l’API (inclut RESOLVED pour les filtres Fixed/Accepted/False Positive). */
  allIssues: any[] = [];
  hotspots: any[] = [];
  qualityGate: any = null;

  // Tabs
  activeTab: 'overview' | 'quality' | 'issues' | 'hotspots' | 'duplication' | 'coverage' = 'overview';

  // Issues
  severityFilter: string = 'ALL';
  typeFilter: string = 'ALL';
  statusFilter: string = 'ALL';
  softwareQualityFilter: 'ALL' | 'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY' = 'ALL';
  languageFilter: string = 'ALL';
  ruleFilter: string = 'ALL';
  tagFilter: string = 'ALL';
  codeAttributeFilter: string = 'ALL';
  securityCategoryFilter: string = 'ALL';
  directoryFilter: string = 'ALL';
  fileFilter: string = 'ALL';
  assigneeFilter: 'ALL' | 'UNASSIGNED' | 'ME' | 'ASSIGNED' = 'ALL';
  directorySearch: string = '';
  fileSearch: string = '';
  issueSearch: string = '';
  filteredIssues: any[] = [];
  filteredIssuesTotal = 0;
  /** Total de la base courante (All) — doit rester stable quand on clique d'autres facets. */
  issuesBaseTotal = 0;
  severityCounts: Record<string, number> = {};
  typeCounts: Record<string, number> = {};
  statusCounts: Record<string, number> = {};
  statusResolutionCounts: Record<string, number> = {};
  softwareQualityCounts: Record<string, number> = {};
  languageCounts: Record<string, number> = {};
  ruleCounts: Record<string, number> = {};
  tagCounts: Record<string, number> = {};
  codeAttributeCounts: Record<string, number> = {};
  securityCategoryCounts: Record<string, number> = {};
  directoryCounts: Record<string, number> = {};
  fileCounts: Record<string, number> = {};
  assigneeCounts: Record<string, number> = {};
  topRules: { key: string; count: number }[] = [];
  topTags: { key: string; count: number }[] = [];
  topDirectories: { key: string; count: number }[] = [];
  topFiles: { key: string; count: number }[] = [];
  topSecurityCategories: { key: string; count: number }[] = [];
  topCodeAttributes: { key: string; count: number }[] = [];

  // Branches
  branches: string[] = ['master'];
  currentBranch: string = 'master';
  qualityGateConditions: any[] = [];

  // Coverage
  coverageFiles: { path: string; coverage: number; uncoveredLines: number; uncoveredConditions: number }[] = [];
  coverageView: 'list' | 'tree' = 'tree';
  coverageTree: { group: string; files: any[] }[] = [];
  coverageExpanded: Record<string, boolean> = {};

  // Duplication
  duplicationFiles: { name: string; path: string; duplication: number; key?: string; url?: string }[] = [];
  duplicationZeroCount = 0;
  duplicationView: 'list' | 'tree' = 'list';
  duplicationTree: { group: string; files: any[] }[] = [];
  duplicationExpanded: Record<string, boolean> = {};
  selectedDupFile: any | null = null;
  selectedDupSourceLines: string[] = [];
  selectedDupMeta: any = null;

  // Hotspots
  hotspotStatusFilter: string = 'ALL';
  filteredHotspots: any[] = [];
  hotspotCountByStatus: Record<string, number> = {};
  selectedHotspot: any | null = null;
  selectedHotspotDetails: any | null = null;
  hotspotDetailTab: 'where' | 'risk' | 'fix' | 'access' = 'where';

  // Misc
  sonarHostUrl: string | null = null;
  sonarProjectKey: string | null = null;
  issueUpdatingKey: string | null = null;
  issueUpdateError: Record<string, string> = {};

  readonly issueTransitions = [
    { value: 'confirm', label: 'Confirmer' },
    { value: 'unconfirm', label: 'Annuler confirmation' },
    { value: 'resolve', label: 'Résoudre (Fixed)' },
    { value: 'reopen', label: 'Rouvrir' },
    { value: 'falsepositive', label: 'Faux positif' },
    { value: 'wontfix', label: "Ne pas corriger (Won't fix)" },
    { value: 'accept', label: 'Accepter' }
  ];

  readonly overviewSeverityOrder = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];

  // Charts instances
  private donutChart: Chart | null = null;
  private coverageBarChart: Chart | null = null;
  private severityBarChart: Chart | null = null;

  constructor(
    private sonarService: SonarQubeService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngAfterViewInit(): void {
    // Charts are initialized after data loads + tab is active
  }

  ngOnDestroy(): void {
    this.donutChart?.destroy();
    this.coverageBarChart?.destroy();
    this.severityBarChart?.destroy();
  }

  // ─── Data Loading ───────────────────────────────────────────────────────────

  load(): void {
    this.loading = true;
    this.error = null;

    // Charger selon la branche sélectionnée pour aligner avec SonarCloud (Issues/mesures par branche)
    this.sonarService.getResultsForBranch(this.currentBranch).subscribe({
      next: (res) => {
        this.metrics = res.metrics || {};

        const rawIssues = (res.issues || []) as any[];
        this.allIssues = rawIssues;
        // SonarCloud UI “Issues” affiche par défaut OPEN + CONFIRMED + REOPENED (pas RESOLVED).
        const defaultStatuses = new Set(['OPEN', 'CONFIRMED', 'REOPENED']);
        this.issues = rawIssues.filter(i => defaultStatuses.has(String(i?.status || 'OPEN').toUpperCase()));
        this.totalIssues = this.issues.length;

        if (this.debugIssues) {
          // eslint-disable-next-line no-console
          console.log('[Sonar][Issues] branch=', this.currentBranch, 'allCount=', rawIssues.length, 'defaultCount=', this.issues.length);
          // eslint-disable-next-line no-console
          console.log('[Sonar][Issues] sample issue keys=', rawIssues.slice(0, 3).map(i => Object.keys(i || {})));
          const s0 = rawIssues[0] || null;
          // eslint-disable-next-line no-console
          console.log('[Sonar][Issues] sample0=', s0);
          // eslint-disable-next-line no-console
          console.log('[Sonar][Issues] sample0.cleanCodeAttribute=', s0?.cleanCodeAttribute, 'cleanCodeAttributeCategory=', s0?.cleanCodeAttributeCategory, 'impacts=', s0?.impacts);
        }

        const rawHotspots = (res.hotspots || []) as any[];
        this.hotspots = rawHotspots;
        this.totalHotspots = Math.max(res.total_hotspots || 0, rawHotspots.length);

        this.qualityGate = res.quality_gate || null;
        this.qualityGateConditions = this.qualityGate?.conditions || [];

        this.sonarHostUrl = res.sonar_host_url || null;
        this.sonarProjectKey = res.sonar_project_key || null;

        this.processDuplication(res.duplication_components || []);
        this.processCoverage(res.coverage_components || []);

        this.applyIssueFilters();

        if (this.debugIssues) {
          // eslint-disable-next-line no-console
          console.log('[Sonar][Issues] codeAttributeCounts=', this.codeAttributeCounts);
          // eslint-disable-next-line no-console
          console.log('[Sonar][Issues] topCodeAttributes=', this.topCodeAttributes);
        }
        this.applyHotspotStatusFilter();
        this.selectFirstHotspotIfNeeded();
        this.selectFirstDuplicationIfNeeded();

        this.loading = false;
        setTimeout(() => this.initChartsForTab(this.activeTab), 80);
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Impossible de charger les résultats SonarQube';
      }
    });
  }

  private processDuplication(rawDup: any[]): void {
    const mapped = rawDup.map(c => {
      const measures = c.measures || [];
      const dupMeasure = measures.find((m: any) => m.metric === 'duplicated_lines_density') || measures[0] || {};
      const val = parseFloat(dupMeasure.value || '0');
      const key = c.key || c.path || c.name;
      return {
        name: c.name || c.key,
        path: c.path || c.key,
        duplication: isNaN(val) ? 0 : val,
        key,
        url: this.buildSonarFileUrl(key)
      };
    });
    this.duplicationFiles = mapped.filter(f => f.duplication > 0);
    this.duplicationZeroCount = Math.max(0, mapped.length - this.duplicationFiles.length);
    this.duplicationTree = this.buildTree(this.duplicationFiles);
    this.duplicationExpanded = {};
  }

  private processCoverage(rawCov: any[]): void {
    this.coverageFiles = rawCov.map(c => {
      const measures = c.measures || [];
      const cov = measures.find((m: any) => m.metric === 'coverage') || {};
      const unl = measures.find((m: any) => m.metric === 'uncovered_lines') || {};
      const unc = measures.find((m: any) => m.metric === 'uncovered_conditions') || {};
      return {
        path: c.path || c.key,
        coverage: parseFloat(cov.value || '0'),
        uncoveredLines: parseInt(unl.value || '0', 10),
        uncoveredConditions: parseInt(unc.value || '0', 10)
      };
    }).sort((a, b) => a.coverage - b.coverage);
    this.coverageTree = this.buildTree(this.coverageFiles);
    this.coverageExpanded = {};
  }

  // ─── Tab Management ──────────────────────────────────────────────────────────

  setTab(tab: 'overview' | 'quality' | 'issues' | 'hotspots' | 'duplication' | 'coverage'): void {
    this.activeTab = tab;
    if (tab === 'hotspots') this.selectFirstHotspotIfNeeded();
    if (tab === 'duplication') this.selectFirstDuplicationIfNeeded();
    setTimeout(() => this.initChartsForTab(tab), 80);
  }

  private initChartsForTab(tab: string): void {
    if (tab === 'overview') {
      this.initDonutChart();
      this.initSeverityBarChart();
    }
    if (tab === 'quality') {
      this.initCoverageBarChart();
    }
  }

  // ─── Charts ──────────────────────────────────────────────────────────────────

  private initDonutChart(): void {
    if (!this.donutCanvas?.nativeElement) return;
    this.donutChart?.destroy();

    const bugsCount = this.typeCounts['BUG'] || 0;
    const vulnCount = this.typeCounts['VULNERABILITY'] || 0;
    const smellCount = this.typeCounts['CODE_SMELL'] || 0;

    this.donutChart = new Chart(this.donutCanvas.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['Bugs', 'Vulnerabilities', 'Code Smells'],
        datasets: [{
          data: [bugsCount, vulnCount, smellCount],
          backgroundColor: ['#1d4ed8', '#b91c1c', '#6b7280'],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
        }
      }
    });
  }

  private initCoverageBarChart(): void {
    if (!this.coverageBarCanvas?.nativeElement) return;
    this.coverageBarChart?.destroy();

    const files = this.coverageFiles.slice(0, 8);
    const labels = files.map(f => f.path.split('/').pop() || f.path);
    const covered = files.map(f => Math.round(f.coverage));
    const uncovered = files.map(f => Math.round(100 - f.coverage));

    this.coverageBarChart = new Chart(this.coverageBarCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Covered',
            data: covered,
            backgroundColor: '#16a34a',
            borderRadius: 4,
            stack: 'stack'
          },
          {
            label: 'Uncovered',
            data: uncovered,
            backgroundColor: 'rgba(185,28,28,0.15)',
            borderRadius: 4,
            stack: 'stack'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: {
            stacked: true,
            max: 100,
            ticks: { callback: (v) => v + '%', font: { size: 11 } },
            grid: { color: 'rgba(100,116,139,0.1)' }
          },
          y: { stacked: true, ticks: { font: { size: 11 } } }
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { font: { size: 11 }, boxWidth: 10 }
          },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.x}%` } }
        }
      }
    });
  }

  private initSeverityBarChart(): void {
    if (!this.severityBarCanvas?.nativeElement) return;
    this.severityBarChart?.destroy();

    const labels = this.overviewSeverityOrder;
    const data = labels.map(s => this.severityCounts[s] || 0);
    const colors = ['#7f1d1d', '#b91c1c', '#c2410c', '#b45309', '#6b7280'];

    this.severityBarChart = new Chart(this.severityBarCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Issues',
          data,
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} issues` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } },
            grid: { color: 'rgba(100,116,139,0.1)' }
          }
        },
        onClick: (_, elements) => {
          if (elements.length) {
            const sev = this.overviewSeverityOrder[elements[0].index];
            this.setTab('issues');
            this.applyIssueFilters(sev, 'ALL');
          }
        }
      }
    });
  }

  // ─── Metrics Helpers ─────────────────────────────────────────────────────────

  getQualityGateStatus(): string {
    return this.qualityGate?.status || 'UNKNOWN';
  }

  getQualityGateFailedCount(): number {
    if (!this.qualityGateConditions?.length) return 0;
    return this.qualityGateConditions.filter((c: any) => (c.status || '').toUpperCase() === 'ERROR').length;
  }

  qualityGateClass(): string {
    const status = this.getQualityGateStatus().toUpperCase();
    if (status === 'OK') return 'qg-ok';
    if (status === 'ERROR') return 'qg-error';
    if (status === 'WARN') return 'qg-warn';
    return 'qg-unknown';
  }

  getCoveragePercent(): number {
    const v = this.metrics?.coverage;
    if (v === undefined || v === null) return 0;
    const n = parseFloat(String(v));
    return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
  }

  getDuplicationPercent(): number {
    const v = this.metrics?.duplicated_lines_density;
    if (v === undefined || v === null) return 0;
    const n = parseFloat(String(v));
    return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
  }

  getSeverityCount(sev: string): number {
    return this.severityCounts[sev] ?? 0;
  }

  getSeverityBarWidth(sev: string): number {
    if (!this.totalIssues) return 0;
    return (this.getSeverityCount(sev) / this.totalIssues) * 100;
  }

  getRatingLabel(value: string | number | undefined): string {
    if (value === undefined || value === null) return '—';
    const n = typeof value === 'string' ? parseInt(value, 10) : value;
    if (isNaN(n) || n < 1 || n > 5) return String(value);
    return ['A', 'B', 'C', 'D', 'E'][n - 1];
  }

  getRatingClass(value: string | number | undefined): string {
    if (value === undefined || value === null) return 'rating-unknown';
    const n = typeof value === 'string' ? parseInt(value, 10) : value;
    return ['', 'rating-a', 'rating-b', 'rating-c', 'rating-d', 'rating-e'][n] || 'rating-unknown';
  }

  getCoverageColor(coverage: number): string {
    if (coverage >= 80) return 'var(--c-ok)';
    if (coverage >= 50) return 'var(--c-warn)';
    return 'var(--c-err)';
  }

  // ─── Issues ──────────────────────────────────────────────────────────────────

  private countBy<T extends string>(items: any[], keyFn: (i: any) => T | '' | null | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    for (const it of (items || [])) {
      const k = keyFn(it);
      if (!k) continue;
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  private countMany(items: any[], keysFn: (i: any) => string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const it of (items || [])) {
      const keys = keysFn(it) || [];
      for (const raw of keys) {
        const k = String(raw || '').trim();
        if (!k) continue;
        out[k] = (out[k] || 0) + 1;
      }
    }
    return out;
  }

  /**
   * Applique les filtres "hors status" (severity/type/quality/lang/rule/tag/codeAttr/secCat/dir/file/assignee/search).
   * Utilisé pour calculer les facets "comme SonarCloud".
   */
  private matchesNonStatusFilters(issue: any, overrides?: Partial<{
    severityFilter: string;
    typeFilter: string;
    softwareQualityFilter: 'ALL' | 'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY';
    languageFilter: string;
    ruleFilter: string;
    tagFilter: string;
    codeAttributeFilter: string;
    securityCategoryFilter: string;
    directoryFilter: string;
    fileFilter: string;
    assigneeFilter: 'ALL' | 'UNASSIGNED' | 'ME' | 'ASSIGNED';
    issueSearch: string;
  }>): boolean {
    const sev = String(issue?.severity || 'UNKNOWN').toUpperCase();
    const t = String(issue?.type || 'OTHER').toUpperCase();
    const comp = String(issue?.component || '');
    const lang = this.guessLanguageFromComponent(comp);
    const rule = String(issue?.rule || issue?.ruleKey || issue?.rule_key || '');
    const tags: string[] = Array.isArray(issue?.tags) ? issue.tags.map((x: any) => String(x)) : [];
    const codeAttr = this.getCodeAttributeKey(issue);
    const secCats = this.getSecurityCategories(issue);
    const filePath = this.getComponentPath(issue?.component);
    const dir = this.getDirectoryFromPath(filePath);
    const assignee = String(issue?.assignee || '').trim();

    const sf = overrides?.severityFilter ?? this.severityFilter;
    const tf = overrides?.typeFilter ?? this.typeFilter;
    const qf = overrides?.softwareQualityFilter ?? this.softwareQualityFilter;
    const lf = overrides?.languageFilter ?? this.languageFilter;
    const rf = overrides?.ruleFilter ?? this.ruleFilter;
    const tagf = overrides?.tagFilter ?? this.tagFilter;
    const caf = overrides?.codeAttributeFilter ?? this.codeAttributeFilter;
    const scf = overrides?.securityCategoryFilter ?? this.securityCategoryFilter;
    const df = overrides?.directoryFilter ?? this.directoryFilter;
    const ff = overrides?.fileFilter ?? this.fileFilter;
    const af = overrides?.assigneeFilter ?? this.assigneeFilter;
    const q = (overrides?.issueSearch ?? this.issueSearch ?? '').trim().toLowerCase();

    const sevOk = sf === 'ALL' || sev === sf;
    const typeOk = tf === 'ALL' || t === tf;
    const langOk = lf === 'ALL' || (lang || 'Unknown') === lf;
    const ruleOk = rf === 'ALL' || rule === rf;
    const tagOk = tagf === 'ALL' || tags.includes(tagf);

    const quality = this.getSoftwareQualityKeyFromType(t);
    const qualityOk = qf === 'ALL' || quality === qf;

    const codeAttrOk = caf === 'ALL' || codeAttr === caf;
    const secCatOk = scf === 'ALL' || secCats.includes(scf);
    const dirOk = df === 'ALL' || dir === df;
    const fileOk = ff === 'ALL' || filePath === ff;
    const assigneeOk =
      af === 'ALL'
        ? true
        : af === 'UNASSIGNED'
          ? !assignee
          : af === 'ASSIGNED'
            ? !!assignee
            : !!assignee; // ME : compte technique

    const searchOk = !q
      || String(issue?.message || '').toLowerCase().includes(q)
      || comp.toLowerCase().includes(q)
      || rule.toLowerCase().includes(q);

    return sevOk && typeOk && qualityOk && langOk && ruleOk && tagOk && codeAttrOk && secCatOk && dirOk && fileOk && assigneeOk && searchOk;
  }

  /** Base = All selon le status (All/Open/Confirmed/Fixed/etc). */
  private getIssuesBase(): any[] {
    const s = (this.statusFilter || 'ALL').toUpperCase();
    const defaultStatuses = new Set(['OPEN', 'CONFIRMED', 'REOPENED']);
    // OPEN_GROUP et ALL correspondent au "groupe Open" (par défaut comme SonarCloud UI)
    if (s === 'OPEN_GROUP' || s === 'ALL') {
      return (this.allIssues || []).filter(i => defaultStatuses.has(String(i?.status || 'OPEN').toUpperCase()));
    }
    if (s === 'FIXED') {
      return (this.allIssues || []).filter(i => {
        const st = String(i?.status || '').toUpperCase();
        const resolution = String(i?.resolution || '').toUpperCase();
        return (st === 'RESOLVED' || st === 'CLOSED') && (!resolution || resolution.includes('FIXED'));
      });
    }
    if (s === 'FALSE_POSITIVE') {
      return (this.allIssues || []).filter(i => String(i?.resolution || '').toUpperCase().includes('FALSE'));
    }
    if (s === 'ACCEPTED') {
      return (this.allIssues || []).filter(i => String(i?.resolution || '').toUpperCase().includes('ACCEPT'));
    }
    // OPEN / CONFIRMED / REOPENED / RESOLVED / CLOSED
    return (this.allIssues || []).filter(i => String(i?.status || '').toUpperCase() === s);
  }

  applyIssueFilters(severity?: string, type?: string): void {
    if (severity !== undefined) this.severityFilter = severity;
    if (type !== undefined) this.typeFilter = type;
    const baseStatusOnly = this.getIssuesBase(); // Base basée sur Status uniquement
    this.issuesBaseTotal = baseStatusOnly.length; // "All" stable (selon status)

    // IMPORTANT: pas d'ajout spécial "closed" dans Type=CODE_SMELL.
    // Le périmètre de l'affichage dépend uniquement du filtre Status (OPEN/FIXED/etc),
    // sinon on gonfle les counts (effet doublement).
    const base = baseStatusOnly;

    this.filteredIssues = base.filter(i => this.matchesNonStatusFilters(i));
    this.filteredIssuesTotal = this.filteredIssues.length;

    // Facets: chaque section = base + tous les autres filtres sauf elle
    const baseNoSeverity = base.filter(i => this.matchesNonStatusFilters(i, { severityFilter: 'ALL' }));
    this.severityCounts = this.countBy(baseNoSeverity, (i) => String(i?.severity || 'UNKNOWN').toUpperCase());

    const baseNoType = base.filter(i => this.matchesNonStatusFilters(i, { typeFilter: 'ALL' }));
    this.typeCounts = this.countBy(baseNoType, (i) => String(i?.type || 'OTHER').toUpperCase());

    const baseNoQuality = base.filter(i => this.matchesNonStatusFilters(i, { softwareQualityFilter: 'ALL' }));
    this.softwareQualityCounts = {
      SECURITY: baseNoQuality.filter(i => this.getSoftwareQualityKeyFromType(String(i?.type || '')) === 'SECURITY').length,
      RELIABILITY: baseNoQuality.filter(i => this.getSoftwareQualityKeyFromType(String(i?.type || '')) === 'RELIABILITY').length,
      MAINTAINABILITY: baseNoQuality.filter(i => this.getSoftwareQualityKeyFromType(String(i?.type || '')) === 'MAINTAINABILITY').length
    };

    const baseNoLang = base.filter(i => this.matchesNonStatusFilters(i, { languageFilter: 'ALL' }));
    this.languageCounts = this.countBy(baseNoLang, (i) => this.guessLanguageFromComponent(String(i?.component || '')) || 'Unknown');

    const baseNoRule = base.filter(i => this.matchesNonStatusFilters(i, { ruleFilter: 'ALL' }));
    this.ruleCounts = this.countBy(baseNoRule, (i) => String(i?.rule || i?.ruleKey || i?.rule_key || '').trim());
    this.topRules = Object.entries(this.ruleCounts).filter(([k]) => !!k).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => ({ key, count }));

    const baseNoTag = base.filter(i => this.matchesNonStatusFilters(i, { tagFilter: 'ALL' }));
    this.tagCounts = this.countMany(baseNoTag, (i) => (Array.isArray(i?.tags) ? i.tags.map((x: any) => String(x)) : []));
    this.topTags = Object.entries(this.tagCounts).filter(([k]) => !!k).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, count]) => ({ key, count }));

    const baseNoCodeAttr = base.filter(i => this.matchesNonStatusFilters(i, { codeAttributeFilter: 'ALL' }));
    this.codeAttributeCounts = this.countBy(baseNoCodeAttr, (i) => this.getCodeAttributeKey(i));

    const baseNoSecCat = base.filter(i => this.matchesNonStatusFilters(i, { securityCategoryFilter: 'ALL' }));
    this.securityCategoryCounts = this.countMany(baseNoSecCat, (i) => this.getSecurityCategories(i));
    this.topSecurityCategories = Object.entries(this.securityCategoryCounts).filter(([k]) => !!k).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, count]) => ({ key, count }));

    const baseNoDir = base.filter(i => this.matchesNonStatusFilters(i, { directoryFilter: 'ALL' }));
    this.directoryCounts = this.countBy(baseNoDir, (i) => this.getDirectoryFromPath(this.getComponentPath(i?.component)));
    // Afficher toutes les directories (pas seulement les "top 10"), comme SonarCloud.
    this.topDirectories = Object.entries(this.directoryCounts)
      .filter(([k]) => !!k)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));

    const baseNoFile = base.filter(i => this.matchesNonStatusFilters(i, { fileFilter: 'ALL' }));
    this.fileCounts = this.countBy(baseNoFile, (i) => this.getComponentPath(i?.component));
    // Afficher tous les fichiers ayant au moins 1 issue (pas de top 10).
    this.topFiles = Object.entries(this.fileCounts)
      .filter(([k]) => !!k)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));

    const baseNoAssignee = base.filter(i => this.matchesNonStatusFilters(i, { assigneeFilter: 'ALL' }));
    const currentUsername = this.userService.getUser()?.username || '';
    const aCounts: Record<string, number> = { UNASSIGNED: 0, ME: 0, ASSIGNED: 0 };
    for (const i of baseNoAssignee) {
      const a = String(i?.assignee || '').trim();
      if (!a) aCounts['UNASSIGNED']++;
      else aCounts['ASSIGNED']++;
      if (a && currentUsername) aCounts['ME']++;
    }
    this.assigneeCounts = aCounts;

    // Status resolution counts (Fixed/Accepted/False Positive) : calculés sur allIssues + autres filtres (hors status)
    const allNoStatus = (this.allIssues || []).filter(i => this.matchesNonStatusFilters(i, {}));
    // Status basic counts (OPEN / CONFIRMED / REOPENED / RESOLVED / CLOSED) pour l'affichage
    this.statusCounts = this.countBy(allNoStatus, (i) => String(i?.status || 'OPEN').toUpperCase());
    const resCounts: Record<string, number> = { FIXED: 0, FALSE_POSITIVE: 0, ACCEPTED: 0 };
    for (const i of allNoStatus) {
      const st = String(i?.status || '').toUpperCase();
      const resolution = String(i?.resolution || '').toUpperCase();
      if ((st === 'RESOLVED' || st === 'CLOSED') && (!resolution || resolution.includes('FIXED'))) resCounts['FIXED']++;
      if (resolution.includes('FALSE')) resCounts['FALSE_POSITIVE']++;
      if (resolution.includes('ACCEPT')) resCounts['ACCEPTED']++;
    }
    this.statusResolutionCounts = resCounts;
  }

  setStatusFilter(status: string): void {
    this.statusFilter = status || 'ALL';
    this.applyIssueFilters();
  }

  setCodeAttributeFilter(v: string): void {
    this.codeAttributeFilter = v || 'ALL';
    this.applyIssueFilters();
  }

  setSecurityCategoryFilter(v: string): void {
    this.securityCategoryFilter = v || 'ALL';
    this.applyIssueFilters();
  }

  setDirectoryFilter(v: string): void {
    this.directoryFilter = v || 'ALL';
    this.applyIssueFilters();
  }

  setFileFilter(v: string): void {
    this.fileFilter = v || 'ALL';
    this.applyIssueFilters();
  }

  setAssigneeFilter(v: 'ALL' | 'UNASSIGNED' | 'ME' | 'ASSIGNED'): void {
    this.assigneeFilter = v || 'ALL';
    this.applyIssueFilters();
  }

  setSoftwareQualityFilter(q: 'ALL' | 'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY'): void {
    this.softwareQualityFilter = q;
    this.applyIssueFilters();
  }

  setLanguageFilter(lang: string): void {
    this.languageFilter = lang || 'ALL';
    this.applyIssueFilters();
  }

  setRuleFilter(rule: string): void {
    this.ruleFilter = rule || 'ALL';
    this.applyIssueFilters();
  }

  setTagFilter(tag: string): void {
    this.tagFilter = tag || 'ALL';
    this.applyIssueFilters();
  }

  clearIssueFilters(): void {
    this.severityFilter = 'ALL';
    this.typeFilter = 'ALL';
    this.statusFilter = 'ALL';
    this.softwareQualityFilter = 'ALL';
    this.languageFilter = 'ALL';
    this.ruleFilter = 'ALL';
    this.tagFilter = 'ALL';
    this.codeAttributeFilter = 'ALL';
    this.securityCategoryFilter = 'ALL';
    this.directoryFilter = 'ALL';
    this.fileFilter = 'ALL';
    this.assigneeFilter = 'ALL';
    this.directorySearch = '';
    this.fileSearch = '';
    this.issueSearch = '';
    this.applyIssueFilters();
  }

  private getComponentPath(component: any): string {
    const raw = String(component || '');
    if (!raw) return '';
    // SonarCloud components can be "projectKey:src/app/x.ts"
    const idx = raw.indexOf(':');
    const path = idx >= 0 ? raw.slice(idx + 1) : raw;
    return path.replace(/^\/+/, '');
  }

  private getDirectoryFromPath(path: string): string {
    if (!path) return '';
    const p = path.replace(/\\/g, '/');
    const i = p.lastIndexOf('/');
    return i > 0 ? p.slice(0, i) : '(root)';
  }

  private getCodeAttributeKey(issue: any): string {
    // SonarCloud peut renvoyer des structures différentes selon l’édition / API:
    // - cleanCodeAttribute (string)
    // - cleanCodeAttributeCategory (string ou objet { key })
    // - impacts[] (objets contenant parfois cleanCodeAttribute / cleanCodeAttributeCategory)
    // IMPORTANT: `cleanCodeAttribute` peut être LOGICAL / ... (pas nos 4 valeurs).
    // Le filtre SonarCloud utilise `cleanCodeAttributeCategory` (ex: INTENTIONAL).
    const directCategory =
      issue?.cleanCodeAttributeCategory ??
      issue?.cleanCodeAttributeCategory?.key ??
      issue?.clean_code_attribute_category;
    const fromCategory = this.normalizeCodeAttribute(directCategory);
    if (fromCategory) return fromCategory;

    const directAttribute =
      issue?.cleanCodeAttribute ??
      issue?.codeAttribute ??
      issue?.code_attribute ??
      issue?.clean_code_attribute;
    const fromAttribute = this.normalizeCodeAttribute(directAttribute);
    if (fromAttribute) return fromAttribute;

    const impacts: any[] = Array.isArray(issue?.impacts) ? issue.impacts : [];
    for (const imp of impacts) {
      const v =
        imp?.cleanCodeAttribute ??
        imp?.cleanCodeAttributeCategory ??
        imp?.cleanCodeAttributeCategory?.key ??
        imp?.clean_code_attribute ??
        imp?.clean_code_attribute_category;
      const normalized = this.normalizeCodeAttribute(v);
      if (normalized) return normalized;
    }

    return '';
  }

  private normalizeCodeAttribute(value: any): 'Consistency' | 'Intentionality' | 'Adaptability' | 'Responsibility' | '' {
    if (!value) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const up = raw.toUpperCase();

    // Valeurs typiques : CONSISTENCY / INTENTIONALITY / ADAPTABILITY / RESPONSIBILITY
    if (up === 'CONSISTENCY' || up.includes('CONSIST')) return 'Consistency';
    if (up === 'INTENTIONALITY' || up.includes('INTENTION')) return 'Intentionality';
    if (up === 'ADAPTABILITY' || up.includes('ADAPT')) return 'Adaptability';
    if (up === 'RESPONSIBILITY' || up.includes('RESPONS')) return 'Responsibility';
    return '';
  }

  private getSecurityCategories(issue: any): string[] {
    const standards: any = issue?.securityStandards || issue?.security_standards;
    const cats: string[] = [];
    if (Array.isArray(standards)) {
      standards.forEach((s: any) => {
        const k = String(s || '').trim();
        if (k) cats.push(k);
      });
    }
    const secCat = issue?.securityCategory || issue?.security_category;
    if (secCat) cats.push(String(secCat));
    return Array.from(new Set(cats));
  }

  getSoftwareQualityKeyFromType(type: string): 'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY' | 'OTHER' {
    const t = (type || '').toUpperCase();
    if (t === 'VULNERABILITY') return 'SECURITY';
    if (t === 'BUG') return 'RELIABILITY';
    if (t === 'CODE_SMELL') return 'MAINTAINABILITY';
    return 'OTHER';
  }

  getSoftwareQualityLabel(key: 'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY'): string {
    if (key === 'SECURITY') return 'Security';
    if (key === 'RELIABILITY') return 'Reliability';
    return 'Maintainability';
  }

  private guessLanguageFromComponent(component: string): string {
    const c = (component || '').toLowerCase();
    const m = c.match(/\.([a-z0-9]+)$/i);
    const ext = m?.[1] || '';
    if (!ext) return 'Unknown';
    if (ext === 'ts' || ext === 'tsx') return 'TypeScript';
    if (ext === 'js' || ext === 'jsx') return 'JavaScript';
    if (ext === 'java') return 'Java';
    if (ext === 'py') return 'Python';
    if (ext === 'cs') return 'C#';
    if (ext === 'html' || ext === 'htm') return 'HTML';
    if (ext === 'css' || ext === 'scss' || ext === 'sass') return 'CSS';
    if (ext === 'xml') return 'XML';
    if (ext === 'json') return 'JSON';
    return ext.toUpperCase();
  }

  getIssueStatusLabel(status: string): string {
    const s = (status || '').toUpperCase();
    const map: Record<string, string> = {
      OPEN: 'Ouvert', CONFIRMED: 'Confirmé', RESOLVED: 'Résolu', REOPENED: 'Rouvert', CLOSED: 'Fermé'
    };
    return map[s] || status || '–';
  }

  getIssueAssigneeLabel(assignee: string | undefined | null): string {
    if (!assignee) return 'Not assigned';
    const user = this.userService.getUser();
    return user?.username || 'Assigned';
  }

  changeIssueStatus(issue: any, transition: string): void {
    const key = issue?.key;
    if (!key || !transition) return;
    if (!this.canChangeIssueStatus(issue)) {
      this.issueUpdateError[key] = 'Issue fermée (Fixed) — statut non modifiable.';
      return;
    }
    this.issueUpdatingKey = key;
    delete this.issueUpdateError[key];
    this.sonarService.issueTransition(key, transition).subscribe({
      next: () => { this.issueUpdatingKey = null; this.load(); },
      error: (err) => {
        this.issueUpdatingKey = null;
        this.issueUpdateError[key] = err?.error?.message || 'Transition refusée par SonarCloud.';
        this.load();
      }
    });
  }

  assignIssueToMe(issue: any): void {
    const key = issue?.key;
    if (!key) return;
    this.issueUpdatingKey = key;
    delete this.issueUpdateError[key];
    this.sonarService.issueAssignToMe(key).subscribe({
      next: () => { this.issueUpdatingKey = null; this.load(); },
      error: (err) => {
        this.issueUpdatingKey = null;
        this.issueUpdateError[key] = err?.error?.message || 'Assignation refusée par SonarCloud.';
        this.load();
      }
    });
  }

  unassignIssue(issue: any): void {
    const key = issue?.key;
    if (!key) return;
    this.issueUpdatingKey = key;
    delete this.issueUpdateError[key];
    this.sonarService.issueUnassign(key).subscribe({
      next: () => { this.issueUpdatingKey = null; this.load(); },
      error: (err) => {
        this.issueUpdatingKey = null;
        this.issueUpdateError[key] = err?.error?.message || 'Désassignation refusée par SonarCloud.';
        this.load();
      }
    });
  }

  canChangeIssueStatus(issue: any): boolean {
    const st = String(issue?.status || '').toUpperCase();
    // SonarCloud: CLOSED (souvent Fixed) n'est généralement pas transitionnable via UI.
    return st !== 'CLOSED';
  }

  getIssueStatusHint(issue: any): string {
    const st = String(issue?.status || '').toUpperCase();
    if (st === 'CLOSED') return 'Issue fermée (Fixed) : changement de statut désactivé.';
    return '';
  }

  // ─── Hotspots ────────────────────────────────────────────────────────────────

  applyHotspotStatusFilter(status?: string): void {
    if (status) this.hotspotStatusFilter = status;
    if (!this.hotspots?.length) {
      this.filteredHotspots = [];
      this.hotspotCountByStatus = { ALL: 0, TO_REVIEW: 0, FIXED: 0, SAFE: 0 };
      return;
    }
    this.computeHotspotCountByStatus();
    this.filteredHotspots = this.hotspotStatusFilter === 'ALL'
      ? [...this.hotspots]
      : this.hotspots.filter(h => this.normalizeHotspotStatus(h.status) === this.hotspotStatusFilter);
  }

  private computeHotspotCountByStatus(): void {
    const counts: Record<string, number> = { ALL: this.hotspots?.length || 0, TO_REVIEW: 0, FIXED: 0, SAFE: 0 };
    (this.hotspots || []).forEach(h => {
      const s = this.normalizeHotspotStatus(h.status);
      if (counts[s] !== undefined) counts[s]++;
    });
    this.hotspotCountByStatus = counts;
  }

  private normalizeHotspotStatus(status: string): string {
    return (status || '').toUpperCase().replace(/\s+/g, '_');
  }

  private selectFirstHotspotIfNeeded(): void {
    if (this.selectedHotspot || !this.filteredHotspots?.length) return;
    this.hotspotDetailTab = 'where';
    this.loadHotspotDetails(this.filteredHotspots[0]);
  }

  loadHotspotDetails(h: any): void {
    if (!h?.key) return;
    this.selectedHotspot = h;
    this.selectedHotspotDetails = null;
    this.sonarService.getHotspotDetails(h.key).subscribe({
      next: (res) => {
        const normalizedRes: any = { ...res };
        if (res.hotspot?.rule && !res.rule) normalizedRes.rule = res.hotspot.rule;
        this.selectedHotspotDetails = normalizedRes;
      },
      error: () => { this.selectedHotspotDetails = { error: true }; }
    });
  }

  getHotspotStatusLabel(status: string): string {
    const s = (status || '').toUpperCase();
    return s === 'TO_REVIEW' ? 'À revoir' : s === 'FIXED' ? 'Corrigé' : s === 'SAFE' ? 'Sûr' : status || '–';
  }

  getHotspotComponentDisplay(): string {
    const h = this.selectedHotspotDetails?.hotspot;
    if (!h) return '';
    const key = h.componentKey;
    if (typeof key === 'string') return key;
    const comp = h.component;
    if (typeof comp === 'string') return comp;
    if (comp && typeof comp === 'object') return comp.key || comp.path || comp.name || '';
    return '';
  }

  getRuleRiskContent(): string {
    const rule: any = this.selectedHotspotDetails?.rule;
    if (!rule) return '';
    if (rule.riskDescription?.trim()) return this.sanitizeRuleHtml(rule.riskDescription);
    if (rule.vulnerabilityDescription?.trim()) return this.sanitizeRuleHtml(rule.vulnerabilityDescription);
    const sections = rule.descriptionSections as any[] | undefined;
    if (sections?.length) {
      for (const key of ['risk', 'vulnerability', 'risk_description', 'what_is_the_risk']) {
        const s = sections.find(s => (s.key || '').toLowerCase().includes(key));
        if (s?.htmlContent) return this.sanitizeRuleHtml(s.htmlContent);
        if (s?.content) return this.sanitizeRuleHtml(s.content);
      }
    }
    return this.sanitizeRuleHtml(rule.htmlDesc || rule.mdDesc || '');
  }

  getRuleFixContent(): string {
    const rule: any = this.selectedHotspotDetails?.rule;
    if (!rule) return '';
    if (rule.fixRecommendations?.trim()) return this.sanitizeRuleHtml(rule.fixRecommendations);
    const sections = rule.descriptionSections as any[] | undefined;
    if (sections?.length) {
      for (const key of ['fix', 'how_to_fix', 'remediation', 'fix_recommendation']) {
        const s = sections.find(s => (s.key || '').toLowerCase().includes(key));
        if (s?.htmlContent) return this.sanitizeRuleHtml(s.htmlContent);
        if (s?.content) return this.sanitizeRuleHtml(s.content);
      }
    }
    return this.sanitizeRuleHtml(rule.htmlDesc || rule.mdDesc || '');
  }

  getRuleAccessContent(): string {
    const rule: any = this.selectedHotspotDetails?.rule;
    if (!rule) return 'Aucune description du risque disponible.';
    if (rule.vulnerabilityDescription?.trim()) return this.sanitizeRuleHtml(rule.vulnerabilityDescription);
    if (rule.riskDescription?.trim()) return this.sanitizeRuleHtml(rule.riskDescription);
    return 'Aucune description du risque disponible.';
  }

  /** Empêche l'exécution de <script> dans les contenus de règles tout en les affichant comme texte. */
  private sanitizeRuleHtml(html: string | undefined | null): string {
    if (!html) return '';
    return String(html)
      .replace(/<script/gi, '&lt;script')
      .replace(/<\/script>/gi, '&lt;/script&gt;');
  }

  // ─── Duplication ─────────────────────────────────────────────────────────────

  private selectFirstDuplicationIfNeeded(): void {
    if (this.selectedDupFile || !this.duplicationFiles?.length) return;
    const first = this.duplicationFiles[0];
    if (first?.key) this.loadDuplicationDetails(first);
  }

  loadDuplicationDetails(file: { key?: string }): void {
    if (!file.key) return;
    this.selectedDupFile = { ...file, loading: true };
    this.selectedDupSourceLines = [];
    this.selectedDupMeta = null;
    this.sonarService.getFileDuplications(file.key).subscribe({
      next: res => {
        this.selectedDupSourceLines = (res.source || '').split(/\r?\n/);
        this.selectedDupMeta = res.duplications || null;
        this.selectedDupFile.loading = false;
      },
      error: () => { this.selectedDupFile.loading = false; }
    });
  }

  // ─── Quality Gate ────────────────────────────────────────────────────────────

  formatConditionMetric(metric: string | undefined): string {
    if (!metric) return '';
    const key = metric.toLowerCase();
    if (key.includes('coverage')) return 'Coverage';
    if (key.includes('security_hotspots_reviewed')) return 'Security Hotspots Reviewed';
    if (key.includes('reliability_rating')) return 'Fiabilité';
    if (key.includes('security_rating')) return 'Sécurité';
    if (key.includes('maintainability_rating')) return 'Maintenabilité';
    if (key.includes('duplicated_lines')) return 'Duplication';
    return metric;
  }

  isCoverageCondition(cond: any): boolean {
    return (cond?.metric || cond?.metricKey || '').toLowerCase().includes('coverage');
  }

  isSecurityHotspotsCondition(cond: any): boolean {
    return (cond?.metric || cond?.metricKey || '').toLowerCase().includes('security_hotspots_reviewed');
  }

  isDuplicationCondition(cond: any): boolean {
    return (cond?.metric || cond?.metricKey || '').toLowerCase().includes('duplicated_lines');
  }

  onQualityGateConditionClick(cond: any): void {
    if (!cond) return;
    if (this.isDuplicationCondition(cond)) { this.setTab('duplication'); return; }
    if (this.isSecurityHotspotsCondition(cond)) { this.setTab('hotspots'); return; }
    if (this.isCoverageCondition(cond)) { this.setTab('coverage'); return; }
    this.setTab('quality');
  }

  onBranchChange(branch: string): void {
    if (!branch || branch === this.currentBranch) return;
    this.currentBranch = branch;
    this.load();
  }

  // ─── Overview Cards ──────────────────────────────────────────────────────────

  onOverviewCardClick(kind: 'vuln' | 'bug' | 'smell' | 'hotspot' | 'dup' | 'coverage'): void {
    if (kind === 'hotspot') {
      this.setTab('hotspots');
      return;
    }
    if (kind === 'dup') {
      this.setTab('duplication');
      return;
    }
    if (kind === 'coverage') {
      this.setTab('quality');
      return;
    }
  
    this.setTab('issues');
    const typeMap: Record<string, string> = {
      vuln: 'VULNERABILITY',
      bug: 'BUG',
      smell: 'CODE_SMELL'
    };
    this.applyIssueFilters(undefined, typeMap[kind] || 'ALL');
  }

  openQualityGateTab(): void {
    this.setTab('quality');
  }

  // ─── Tree / Group Helpers ────────────────────────────────────────────────────

  private buildTree<T extends { path: string }>(files: T[]): { group: string; files: T[] }[] {
    const groups = new Map<string, T[]>();
    files.forEach(f => {
      const firstSegment = (f.path || '').split(/[\\/]/)[0] || '(root)';
      if (!groups.has(firstSegment)) groups.set(firstSegment, []);
      groups.get(firstSegment)!.push(f);
    });
    return Array.from(groups.entries())
      .map(([group, items]) => ({
        group,
        files: items.sort((a: any, b: any) => (a.path || '').localeCompare(b.path || ''))
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }

  isCoverageGroupExpanded(group: string): boolean { return !!this.coverageExpanded[group]; }
  toggleCoverageGroup(group: string): void { this.coverageExpanded[group] = !this.coverageExpanded[group]; }
  isDuplicationGroupExpanded(group: string): boolean { return !!this.duplicationExpanded[group]; }
  toggleDuplicationGroup(group: string): void { this.duplicationExpanded[group] = !this.duplicationExpanded[group]; }

  private buildSonarFileUrl(componentKey: string | undefined | null): string | undefined {
    if (!componentKey || !this.sonarHostUrl || !this.sonarProjectKey) return undefined;
    const base = this.sonarHostUrl.replace(/\/+$/, '');
    return `${base}/code?id=${encodeURIComponent(this.sonarProjectKey)}&selected=${encodeURIComponent(componentKey)}`;
  }
}