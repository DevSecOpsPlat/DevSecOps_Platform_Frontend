import { Component, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import Chart from 'chart.js/auto';
import { SonarQubeService } from 'src/app/services/sonarqube/sonarqube.service';
import { UserService } from 'src/app/services/user/user.service';
import {
  translateSonarMessage,
  translateSonarSeverity,
  translateSonarIssueType,
  translateSonarImpactSeverity,
  translateSonarCodeAttribute,
  translateSonarSecurityCategory,
  translateSonarTag,
  translateSonarVulnerabilityProbability,
  translateSonarQgStatus,
} from './sonarqube-message-i18n';

@Component({
  selector: 'app-sonarqube',
  templateUrl: './sonarqube.component.html',
  styleUrls: ['./sonarqube.component.css']
})
export class SonarqubeComponent implements OnInit, OnDestroy, AfterViewInit {
  /** Active des logs console pour diagnostiquer les facets issues. */
  readonly debugIssues = false;

  @ViewChild('donutCanvas') donutCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('coverageBarCanvas') coverageBarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('severityBarCanvas') severityBarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('activityCanvas') activityCanvas?: ElementRef<HTMLCanvasElement>;

  loading = true;
  error: string | null = null;

  metrics: any = null;
  softwareQualityDimensions: any[] = [];
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
  /** Page courante des issues (0-based), reconstruite après filtres. */
  readonly issuesPageSize = 100;
  issuesPageIndex = 0;
  /** Issues de la page courante (champs UI précalculés). */
  displayedIssues: any[] = [];
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
  branches: string[] = ['main'];
  currentBranch: string = 'main';
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

  // Activity (historique analyses)
  activityLoading = false;
  activityHistory: any = null;
  activityAnalyses: any[] = [];
  activityGraphType: 'issues' | 'coverage' | 'duplications' = 'issues';

  // Issue detail (master-detail)
  selectedIssue: any | null = null;
  selectedIssueDetails: any | null = null;
  issueViewMode: 'list' | 'detail' = 'list';
  issueDetailTab: 'where' | 'why' | 'fix' | 'more' = 'where';
  issueDetailLoading = false;

  // Misc
  sonarHostUrl: string | null = null;
  sonarProjectKey: string | null = null;
  serviceId: string | null = null;
  issueUpdatingKey: string | null = null;
  issueUpdateError: Record<string, string> = {};

  readonly issueTransitions = [
    { value: 'confirm', label: 'Confirmer' },
    { value: 'unconfirm', label: 'Annuler confirmation' },
    { value: 'resolve', label: 'Résoudre (corrigé)' },
    { value: 'reopen', label: 'Rouvrir' },
    { value: 'falsepositive', label: 'Faux positif' },
    { value: 'wontfix', label: 'Ne pas corriger (accepté)' },
    { value: 'accept', label: 'Accepter' }
  ];

  readonly overviewSeverityOrder = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'];

  // Charts instances
  private donutChart: Chart | null = null;
  private coverageBarChart: Chart | null = null;
  private severityBarChart: Chart | null = null;
  private activityChart: Chart | null = null;

  constructor(
    private sonarService: SonarQubeService,
    private userService: UserService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.serviceId = this.route.parent?.snapshot.paramMap.get('appId') || null;
    this.loadBranches();
    this.load();
  }

  private loadBranches(): void {
    const preserve = [...this.branches];
    this.sonarService.getBranches(this.serviceId || undefined).subscribe({
      next: (branches) => {
        const merged = new Set<string>([
          ...preserve,
          ...(branches || []),
          this.currentBranch,
          'main',
          'test'
        ].filter((b): b is string => !!b && String(b).trim() !== ''));
        this.branches = Array.from(merged);
        if (!this.branches.includes(this.currentBranch)) {
          this.currentBranch = this.branches[0] || 'main';
        }
      },
      error: () => {
        if (!this.branches.length) {
          this.branches = ['main', 'test'];
        }
      }
    });
  }

  ngAfterViewInit(): void {
    // Charts are initialized after data loads + tab is active
  }

  ngOnDestroy(): void {
    this.donutChart?.destroy();
    this.coverageBarChart?.destroy();
    this.severityBarChart?.destroy();
    this.activityChart?.destroy();
  }

  // ─── Data Loading ───────────────────────────────────────────────────────────

  load(): void {
    this.loading = true;
    this.error = null;

    // Charger selon la branche sélectionnée pour aligner avec SonarCloud (Issues/mesures par branche)
    this.sonarService.getResultsForBranch(this.currentBranch, this.serviceId || undefined).subscribe({
      next: (res) => {
        try {
          this.metrics = res.metrics || {};
          this.softwareQualityDimensions = res.software_quality_dimensions
            || res.metrics?.software_quality_dimensions
            || [];

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
          this.syncRatingsFromQualityGate();
          this.syncRatingsFromSoftwareQualityDimensions();
          this.syncRatingsFromOpenIssues();

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
          this.loadActivityHistory();
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[Sonar] Erreur traitement réponse', e);
          this.error = 'Erreur lors du traitement des données SonarQube.';
        } finally {
          this.loading = false;
        }
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
      if (this.activityAnalyses?.length) {
        setTimeout(() => this.initActivityChart(), 80);
      }
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
        labels: ['Bugs', 'Vulnérabilités', 'Code smells'],
        datasets: [{
          data: [bugsCount, vulnCount, smellCount],
          backgroundColor: ['#f87171', '#c4b5fd', '#1b3661'],
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
            label: 'Couvert',
            data: covered,
            backgroundColor: '#16a34a',
            borderRadius: 4,
            stack: 'stack'
          },
          {
            label: 'Non couvert',
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
    const colors = ['#fecdd3', '#f87171', '#fb923c', '#fdba74', '#e2e8f0'];

    this.severityBarChart = new Chart(this.severityBarCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Problèmes',
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

  getCoveragePercent(): number | null {
    if (!this.isCoverageComputed()) return null;
    const n = parseFloat(String(this.metrics.coverage));
    return isNaN(n) ? null : Math.min(100, Math.max(0, n));
  }

  getDuplicationPercent(): number | null {
    if (!this.isDuplicationComputed()) return null;
    const n = parseFloat(String(this.metrics.duplicated_lines_density));
    return isNaN(n) ? null : Math.min(100, Math.max(0, n));
  }

  isCoverageComputed(): boolean {
    const v = this.metrics?.coverage;
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  isDuplicationComputed(): boolean {
    const v = this.metrics?.duplicated_lines_density;
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  formatCoverageDisplay(): string {
    const p = this.getCoveragePercent();
    return p === null ? 'Non calculé' : `${p.toFixed(1)}%`;
  }

  formatDuplicationDisplay(): string {
    const p = this.getDuplicationPercent();
    return p === null ? 'Non calculé' : `${p.toFixed(1)}%`;
  }

  getDimensionRatingLetter(metricKey: 'reliability_rating' | 'security_rating' | 'maintainability_rating'): string {
    return this.resolveDimensionRating(metricKey).letter;
  }

  getDimensionRatingClass(metricKey: 'reliability_rating' | 'security_rating' | 'maintainability_rating'): string {
    const letter = this.resolveDimensionRating(metricKey).letter;
    if (letter === '—') return 'rating-unknown';
    const map: Record<string, string> = { A: 'rating-a', B: 'rating-b', C: 'rating-c', D: 'rating-d', E: 'rating-e' };
    return map[letter] || 'rating-unknown';
  }

  private resolveDimensionRating(metricKey: 'reliability_rating' | 'security_rating' | 'maintainability_rating'): { letter: string } {
    const m = this.metrics || {};
    const sqKeyMap: Record<string, string> = {
      reliability_rating: 'software_quality_reliability_rating',
      security_rating: 'software_quality_security_rating',
      maintainability_rating: 'software_quality_maintainability_rating'
    };
    const sqKey = sqKeyMap[metricKey];
    const letterCandidates = [
      m[`${metricKey}_letter`],
      sqKey ? m[`${sqKey}_letter`] : null,
      metricKey === 'maintainability_rating' ? m.sqale_rating_letter : null
    ];
    for (const c of letterCandidates) {
      if (c) {
        const s = String(c).trim().toUpperCase();
        if (s.length === 1 && s >= 'A' && s <= 'E') return { letter: s };
      }
    }

    const rawCandidates = [
      m[metricKey],
      sqKey ? m[sqKey] : null,
      metricKey === 'maintainability_rating' ? (m.maintainability_rating ?? m.sqale_rating) : null
    ];
    for (const raw of rawCandidates) {
      const label = this.getRatingLabel(raw);
      if (label !== '—') return { letter: label };
    }

    const dimName = metricKey === 'reliability_rating' ? 'RELIABILITY'
      : metricKey === 'security_rating' ? 'SECURITY' : 'MAINTAINABILITY';
    const dim = (this.softwareQualityDimensions || []).find(
      (d: any) => String(d?.dimension || '').toUpperCase() === dimName
    );
    if (dim?.rating) {
      const label = this.getRatingLabel(dim.rating);
      if (label !== '—') return { letter: label };
    }

    return { letter: '—' };
  }

  /** Complète les notes A–E depuis les conditions Quality Gate si measures est vide. */
  private syncRatingsFromQualityGate(): void {
    if (!this.metrics || !this.qualityGateConditions?.length) return;
    const map: Record<string, string[]> = {
      security_rating: ['security_rating', 'new_security_rating', 'software_quality_security_rating'],
      reliability_rating: ['reliability_rating', 'new_reliability_rating', 'software_quality_reliability_rating'],
      maintainability_rating: ['sqale_rating', 'maintainability_rating', 'new_maintainability_rating', 'software_quality_maintainability_rating']
    };
    for (const cond of this.qualityGateConditions) {
      const mk = String(cond?.metricKey || cond?.metric || '').toLowerCase();
      const val = cond?.actualValue ?? cond?.actual;
      if (!mk || val === undefined || val === null || String(val).trim() === '') continue;
      for (const [target, keys] of Object.entries(map)) {
        if (!keys.includes(mk)) continue;
        if (!this.metrics[target] && !this.metrics[`${target}_letter`]) {
          this.metrics[target] = val;
          const letter = this.getRatingLabel(val);
          if (letter !== '—') this.metrics[`${target}_letter`] = letter;
        }
      }
    }
  }

  /** Complète les notes depuis software_quality_dimensions (Sonar 10+). */
  private syncRatingsFromSoftwareQualityDimensions(): void {
    if (!this.metrics) return;
    const dimToMetric: Record<string, string> = {
      SECURITY: 'security_rating',
      RELIABILITY: 'reliability_rating',
      MAINTAINABILITY: 'maintainability_rating'
    };
    for (const dim of this.softwareQualityDimensions || []) {
      const name = String(dim?.dimension || '').toUpperCase();
      const target = dimToMetric[name];
      if (!target || !dim?.rating) continue;
      const letter = this.getRatingLabel(dim.rating);
      if (letter === '—') continue;
      if (!this.metrics[`${target}_letter`]) {
        this.metrics[`${target}_letter`] = letter;
      }
      if (!this.metrics[target]) {
        this.metrics[target] = dim.ratingValue ?? dim.rating;
      }
    }
  }

  /** Dérive A–E depuis les issues ouvertes si les métriques Sonar sont absentes. */
  private syncRatingsFromOpenIssues(): void {
    if (!this.metrics) return;
    const open = (this.issues || []).filter(i =>
      ['OPEN', 'CONFIRMED', 'REOPENED'].includes(String(i?.status || 'OPEN').toUpperCase())
    );
    const apply = (metricKey: string, type: string, emptyRating: number) => {
      if (this.metrics[`${metricKey}_letter`] || this.getRatingLabel(this.metrics[metricKey]) !== '—') return;
      const rating = this.worstSeverityRatingForType(open, type, emptyRating);
      if (rating < 1 || rating > 5) return;
      this.metrics[metricKey] = rating;
      this.metrics[`${metricKey}_letter`] = this.getRatingLabel(rating);
    };
    apply('security_rating', 'VULNERABILITY', 1);
    apply('reliability_rating', 'BUG', 1);
    apply('maintainability_rating', 'CODE_SMELL', 1);
    if (!this.metrics.sqale_rating_letter && this.metrics.maintainability_rating_letter) {
      this.metrics.sqale_rating = this.metrics.maintainability_rating;
      this.metrics.sqale_rating_letter = this.metrics.maintainability_rating_letter;
    }
  }

  private worstSeverityRatingForType(issues: any[], type: string, whenEmpty: number): number {
    const ofType = issues.filter(i => String(i?.type || '').toUpperCase() === type);
    if (!ofType.length) return whenEmpty;
    const map: Record<string, number> = { BLOCKER: 5, CRITICAL: 4, MAJOR: 3, MINOR: 2, INFO: 2 };
    return ofType.reduce((worst, i) => {
      const r = map[String(i?.severity || '').toUpperCase()] ?? 2;
      return Math.max(worst, r);
    }, whenEmpty);
  }

  translateIssueMessage(message: string | undefined | null): string {
    return translateSonarMessage(message);
  }

  getSeverityLabel(severity: string | undefined | null): string {
    return translateSonarSeverity(severity);
  }

  getIssueTypeLabel(type: string | undefined | null): string {
    return translateSonarIssueType(type);
  }

  translateSecurityCategory(key: string | undefined | null): string {
    return translateSonarSecurityCategory(key);
  }

  translateTag(tag: string | undefined | null): string {
    return translateSonarTag(tag);
  }

  translateVulnerabilityProbability(prob: string | undefined | null): string {
    return translateSonarVulnerabilityProbability(prob);
  }

  translateQgStatus(status: string | undefined | null): string {
    return translateSonarQgStatus(status);
  }

  translateCodeAttribute(attr: string | undefined | null): string {
    return translateSonarCodeAttribute(attr);
  }

  closeIssueDetail(): void {
    this.issueViewMode = 'list';
    this.selectedIssue = null;
    this.selectedIssueDetails = null;
    this.issueDetailLoading = false;
  }

  getSeverityCount(sev: string): number {
    return this.severityCounts[sev] ?? 0;
  }

  getSeverityBarWidth(sev: string): number {
    if (!this.totalIssues) return 0;
    return (this.getSeverityCount(sev) / this.totalIssues) * 100;
  }

  getRatingLabel(value: string | number | undefined): string {
    if (value === undefined || value === null || String(value).trim() === '') return '—';
    const s = String(value).trim().toUpperCase();
    if (s.length === 1 && s >= 'A' && s <= 'E') return s;
    const n = typeof value === 'string' ? parseInt(value, 10) : value;
    if (isNaN(n as number) || (n as number) < 1 || (n as number) > 5) return String(value);
    return ['A', 'B', 'C', 'D', 'E'][(n as number) - 1];
  }

  getRatingClass(value: string | number | undefined): string {
    if (value === undefined || value === null || String(value).trim() === '') return 'rating-unknown';
    const s = String(value).trim().toUpperCase();
    if (s.length === 1 && s >= 'A' && s <= 'E') {
      return `rating-${s.toLowerCase()}`;
    }
    const n = typeof value === 'string' ? parseInt(value, 10) : value;
    return ['', 'rating-a', 'rating-b', 'rating-c', 'rating-d', 'rating-e'][n as number] || 'rating-unknown';
  }

  getCoverageColor(coverage: number | null): string {
    if (coverage === null) return 'var(--c-muted)';
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

    const qualities = this.getSoftwareQualityKeys(issue, t);
    const qualityOk = qf === 'ALL' || qualities.includes(qf);

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
            : af === 'ME'
              ? this.issueAssigneeMatchesCurrentUser(assignee)
              : true;

    const searchOk = !q
      || String(issue?.message || '').toLowerCase().includes(q)
      || comp.toLowerCase().includes(q)
      || rule.toLowerCase().includes(q);

    return sevOk && typeOk && qualityOk && langOk && ruleOk && tagOk && codeAttrOk && secCatOk && dirOk && fileOk && assigneeOk && searchOk;
  }

  private getSoftwareQualityKeys(issue: any, fallbackType?: string): Array<'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY'> {
    const out = new Set<'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY'>();

    // SonarCloud Clean Code: impacts[] contient la "softwareQuality" réelle
    const impacts: any[] = Array.isArray(issue?.impacts) ? issue.impacts : [];
    for (const imp of impacts) {
      const q = String(imp?.softwareQuality || imp?.software_quality || '').toUpperCase();
      if (q === 'SECURITY' || q === 'RELIABILITY' || q === 'MAINTAINABILITY') {
        out.add(q as any);
      }
    }

    // Fallback ancien modèle: déduire depuis le type
    if (out.size === 0) {
      const q = this.getSoftwareQualityKeyFromType(String(fallbackType || issue?.type || ''));
      if (q === 'SECURITY' || q === 'RELIABILITY' || q === 'MAINTAINABILITY') out.add(q);
    }

    return Array.from(out);
  }

  /** Base = All selon le status (All/Open/Confirmed/Fixed/etc). */
  private getIssuesBase(): any[] {
    const s = (this.statusFilter || 'ALL').toUpperCase();
    const defaultStatuses = new Set(['OPEN', 'CONFIRMED', 'REOPENED']);
    // OPEN_GROUP et ALL correspondent au "groupe Open" (par défaut comme SonarCloud UI)
    if (s === 'OPEN_GROUP' || s === 'ALL') {
      return (this.allIssues || []).filter(i => defaultStatuses.has(String(i?.status || 'OPEN').toUpperCase()));
    }
    if (s === 'FALSE_POSITIVE') {
      return (this.allIssues || []).filter(i => this.isFalsePositiveIssue(i));
    }
    if (s === 'ACCEPTED') {
      return (this.allIssues || []).filter(i => this.isAcceptedIssue(i));
    }
    if (s === 'FIXED') {
      return (this.allIssues || []).filter(i => this.isFixedIssue(i));
    }
    // OPEN / CONFIRMED / REOPENED / RESOLVED / CLOSED
    return (this.allIssues || []).filter(i => String(i?.status || '').toUpperCase() === s);
  }

  applyIssueFilters(severity?: string, type?: string): void {
    if (severity !== undefined) {
      this.severityFilter = severity;
      if (severity === 'ALL') {
        this.softwareQualityFilter = 'ALL';
      }
    }
    if (type !== undefined) {
      this.typeFilter = type;
      if (type === 'ALL') {
        this.softwareQualityFilter = 'ALL';
      }
    }
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

    // Compteurs Software quality : même logique que les autres facettes (hors filtre SQ),
    // pour rester alignés avec la liste affichée (Type + Severity inchangés).
    const baseNoQuality = base.filter(i => this.matchesNonStatusFilters(i, { softwareQualityFilter: 'ALL' }));
    this.softwareQualityCounts = {
      SECURITY: baseNoQuality.filter(i => this.getSoftwareQualityKeys(i, String(i?.type || '')).includes('SECURITY')).length,
      RELIABILITY: baseNoQuality.filter(i => this.getSoftwareQualityKeys(i, String(i?.type || '')).includes('RELIABILITY')).length,
      MAINTAINABILITY: baseNoQuality.filter(i => this.getSoftwareQualityKeys(i, String(i?.type || '')).includes('MAINTAINABILITY')).length
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
    // Afficher toutes les security categories (pas seulement top 12),
    // comme SonarCloud.
    this.topSecurityCategories = Object.entries(this.securityCategoryCounts)
      .filter(([k]) => !!k)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }));

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
    const aCounts: Record<string, number> = { UNASSIGNED: 0, ME: 0, ASSIGNED: 0 };
    for (const i of baseNoAssignee) {
      const a = String(i?.assignee || '').trim();
      if (!a) aCounts['UNASSIGNED']++;
      else {
        aCounts['ASSIGNED']++;
        if (this.issueAssigneeMatchesCurrentUser(a)) aCounts['ME']++;
      }
    }
    this.assigneeCounts = aCounts;

    // Status resolution counts (Fixed/Accepted/False Positive) : calculés sur allIssues + autres filtres (hors status)
    const allNoStatus = (this.allIssues || []).filter(i => this.matchesNonStatusFilters(i, {}));
    // Status basic counts (OPEN / CONFIRMED / REOPENED / RESOLVED / CLOSED) pour l'affichage
    this.statusCounts = this.countBy(allNoStatus, (i) => String(i?.status || 'OPEN').toUpperCase());
    const resCounts: Record<string, number> = { FIXED: 0, FALSE_POSITIVE: 0, ACCEPTED: 0 };
    for (const i of allNoStatus) {
      if (this.isFixedIssue(i)) resCounts['FIXED']++;
      if (this.isFalsePositiveIssue(i)) resCounts['FALSE_POSITIVE']++;
      if (this.isAcceptedIssue(i)) resCounts['ACCEPTED']++;
    }
    this.statusResolutionCounts = resCounts;

    this.issuesPageIndex = 0;
    this.refreshIssuesPage();
  }

  /** Reconstruit `displayedIssues` pour la page courante (max `issuesPageSize` lignes). */
  private refreshIssuesPage(): void {
    const start = this.issuesPageIndex * this.issuesPageSize;
    this.displayedIssues = this.filteredIssues
      .slice(start, start + this.issuesPageSize)
      .map((i) => this.toDisplayedIssue(i));
  }

  goIssuesNextPage(): void {
    const n = this.filteredIssues.length;
    if ((this.issuesPageIndex + 1) * this.issuesPageSize >= n) return;
    this.issuesPageIndex++;
    this.refreshIssuesPage();
  }

  goIssuesPrevPage(): void {
    if (this.issuesPageIndex <= 0) return;
    this.issuesPageIndex--;
    this.refreshIssuesPage();
  }

  issuesHasNextPage(): boolean {
    return (this.issuesPageIndex + 1) * this.issuesPageSize < this.filteredIssues.length;
  }

  issuesHasPrevPage(): boolean {
    return this.issuesPageIndex > 0;
  }

  /** Libellé du type « 1–100 sur 556 ». */
  issuesPageRangeLabel(): string {
    const n = this.filteredIssues.length;
    if (n === 0) return '';
    const start = this.issuesPageIndex * this.issuesPageSize + 1;
    const end = Math.min((this.issuesPageIndex + 1) * this.issuesPageSize, n);
    return `${start}–${end} sur ${n}`;
  }

  issuesPageTotalPages(): number {
    const n = this.filteredIssues.length;
    return Math.max(1, Math.ceil(n / this.issuesPageSize));
  }

  /**
   * Chemin fichier sans préfixe projet / groupe (ex. public/about.html).
   * Utilisé seulement sur les lignes affichées.
   */
  private stripProjectPrefixForDisplay(path: string): string {
    let p = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p) return '';
    const roots = ['public/', 'src/', 'app/', 'lib/', 'www/', 'frontend/', 'backend/', 'main/', 'test/'];
    for (const r of roots) {
      const i = p.indexOf(r);
      if (i >= 0) return p.slice(i);
    }
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0];
      if (/^[a-z0-9][a-z0-9_.-]*_[a-z0-9][a-z0-9_.-]*$/i.test(first)) {
        return parts.slice(1).join('/');
      }
    }
    return p;
  }

  private getDisplayPath(component: any): string {
    return this.stripProjectPrefixForDisplay(this.getComponentPath(component));
  }

  private formatImpactSeverityForUi(sev: string): string {
    return translateSonarImpactSeverity(sev);
  }

  private buildIssueImpactsUi(issue: any): { quality: string; impactSev: string }[] {
    const impacts: any[] = Array.isArray(issue?.impacts) ? issue.impacts : [];
    const out: { quality: string; impactSev: string }[] = [];
    const fallbackSev = this.formatImpactSeverityForUi(String(issue?.severity || ''));

    for (const imp of impacts.slice(0, 2)) {
      const qRaw = String(imp?.softwareQuality || imp?.software_quality || '').toUpperCase();
      if (qRaw !== 'SECURITY' && qRaw !== 'RELIABILITY' && qRaw !== 'MAINTAINABILITY') continue;
      const q = this.getSoftwareQualityLabel(qRaw as 'SECURITY' | 'RELIABILITY' | 'MAINTAINABILITY');
      const impSev = imp?.severity ?? imp?.impactSeverity ?? issue?.severity;
      out.push({
        quality: q,
        impactSev: this.formatImpactSeverityForUi(String(impSev || fallbackSev))
      });
    }

    if (out.length === 0) {
      const keys = this.getSoftwareQualityKeys(issue, String(issue?.type || ''));
      for (const k of keys.slice(0, 2)) {
        out.push({
          quality: this.getSoftwareQualityLabel(k),
          impactSev: fallbackSev
        });
      }
    }
    return out;
  }

  private toDisplayedIssue(issue: any): any {
    const row = { ...issue };
    const tags: string[] = Array.isArray(issue?.tags) ? issue.tags.map((x: any) => String(x)) : [];
    (row as any)._displayPath = this.getDisplayPath(issue?.component);
    (row as any)._translatedMessage = this.translateIssueMessage(issue?.message);
    (row as any)._impactsUi = this.buildIssueImpactsUi(issue);
    (row as any)._codeAttr = this.translateCodeAttribute(this.getCodeAttributeKey(issue) || '');
    (row as any)._tags = tags.slice(0, 3).map(t => this.translateTag(t));
    return row;
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
        if (!s) return;
        if (typeof s === 'string') {
          const k = String(s || '').trim();
          if (k) cats.push(k);
          return;
        }
        // SonarCloud peut renvoyer un objet { key, name, type, ... }
        const k =
          s?.key ??
          s?.name ??
          s?.label ??
          s?.standard ??
          s?.value;
        const ks = String(k || '').trim();
        if (ks) cats.push(ks);
      });
    }
    const secCat = issue?.securityCategory || issue?.security_category;
    if (secCat) {
      if (Array.isArray(secCat)) {
        secCat.forEach((x: any) => {
          const ks = String(x || '').trim();
          if (ks) cats.push(ks);
        });
      } else {
        cats.push(String(secCat).trim());
      }
    }
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
    if (key === 'SECURITY') return 'Sécurité';
    if (key === 'RELIABILITY') return 'Fiabilité';
    return 'Maintenabilité';
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
      OPEN: 'Ouvert', CONFIRMED: 'Confirmé', RESOLVED: 'Résolu', REOPENED: 'Rouvert', CLOSED: 'Fermé', ACCEPTED: 'Accepté'
    };
    return map[s] || status || '–';
  }

  private getIssueResolution(issue: any): string {
    return String(issue?.resolution || '').toUpperCase().replace(/-/g, '_');
  }

  isFalsePositiveIssue(issue: any): boolean {
    return this.getIssueResolution(issue).includes('FALSE');
  }

  isAcceptedIssue(issue: any): boolean {
    const r = this.getIssueResolution(issue);
    if (r.includes('ACCEPT')) return true;
    if (r.includes('WONTFIX') || r.includes('WONT_FIX')) return true;
    return String(issue?.status || '').toUpperCase() === 'ACCEPTED';
  }

  isFixedIssue(issue: any): boolean {
    if (this.isFalsePositiveIssue(issue) || this.isAcceptedIssue(issue)) return false;
    const st = String(issue?.status || '').toUpperCase();
    const r = this.getIssueResolution(issue);
    return (st === 'RESOLVED' || st === 'CLOSED') && (!r || r.includes('FIXED'));
  }

  getIssueDisplayStatus(issue: any): string {
    if (!issue) return '–';
    if (this.isFalsePositiveIssue(issue)) return 'Faux positif';
    if (this.isAcceptedIssue(issue)) return 'Accepté';
    if (this.isFixedIssue(issue)) return 'Corrigé';
    return this.getIssueStatusLabel(issue.status);
  }

  getIssueAssigneeLabel(assignee: string | undefined | null): string {
    if (!assignee) return 'Non assigné';
    if (this.issueAssigneeMatchesCurrentUser(assignee)) {
      const user = this.userService.getUser();
      return user?.username ? `Moi (${user.username})` : 'Moi';
    }
    return String(assignee);
  }

  /** Compare le login Sonar de l’issue avec l’utilisateur connecté (username ou email). */
  private issueAssigneeMatchesCurrentUser(assignee: string | undefined | null): boolean {
    const a = String(assignee || '').trim().toLowerCase();
    if (!a) return false;
    const user = this.userService.getUser();
    if (!user) return false;
    const u = String(user.username || '').trim().toLowerCase();
    const e = String(user.email || '').trim().toLowerCase();
    return a === u || (!!e && a === e);
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
      next: () => {
        this.issueUpdatingKey = null;
        const filterByTransition: Record<string, string> = {
          confirm: 'CONFIRMED',
          unconfirm: 'OPEN',
          falsepositive: 'FALSE_POSITIVE',
          accept: 'ACCEPTED',
          wontfix: 'ACCEPTED',
          resolve: 'FIXED',
          reopen: 'REOPENED'
        };
        const nextFilter = filterByTransition[transition.toLowerCase()];
        if (nextFilter) this.statusFilter = nextFilter;
        this.load();
      },
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
    this.hotspotDetailTab = 'where';
    this.sonarService.getHotspotDetails(h.key).subscribe({
      next: (res) => {
        this.selectedHotspotDetails = {
          ...res,
          rule: res.rule ?? res.hotspot?.rule ?? null,
        };
        setTimeout(() => {
          document.getElementById('hotspot-highlight-line')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 80);
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

  /** Contenu de règle déjà traduit côté backend — pas de retraduction frontend. */
  private presentRuleHtml(html: string | undefined | null): string {
    return this.sanitizeRuleHtml(html || '');
  }

  getRuleRiskContent(): string {
    const rule: any = this.selectedHotspotDetails?.rule;
    if (!rule) return '';
    return this.presentRuleHtml(this.getRuleWhySectionsContent(rule));
  }

  getRuleFixContent(): string {
    const rule: any = this.selectedHotspotDetails?.rule;
    if (!rule) return '';
    const raw = this.getRuleFixSectionsContent(rule);
    if (raw) return this.presentRuleHtml(raw);
    if (rule.fixRecommendations?.trim()) {
      return this.presentRuleHtml(rule.fixRecommendations);
    }
    return '';
  }

  hasRuleMoreInfo(): boolean {
    return this.hasRuleMoreInfoData(this.selectedHotspotDetails?.rule);
  }

  getRuleMoreInfoContent(): string {
    const rule: any = this.selectedHotspotDetails?.rule;
    if (!rule) return '';
    return this.buildRuleMoreInfoContent(rule);
  }

  getRuleAccessContent(): string {
    const rule: any = this.selectedHotspotDetails?.rule;
    if (!rule) return 'Aucune description d\'accès disponible.';
    const raw = this.getRuleAccessSectionsContent(rule);
    if (raw) return this.presentRuleHtml(raw);
    return 'Aucune description d\'accès disponible.';
  }

  getHotspotHighlightLineNumber(lineIndex: number): number {
    const nums = this.selectedHotspotDetails?.sourceLineNumbers as number[] | undefined;
    if (nums?.length && nums[lineIndex] != null) return nums[lineIndex];
    return (this.selectedHotspotDetails?.sourceLineFrom || 1) + lineIndex;
  }

  isHotspotHighlightLine(lineIndex: number): boolean {
    const highlight = this.selectedHotspotDetails?.highlightLine;
    if (!highlight) return false;
    return this.getHotspotHighlightLineNumber(lineIndex) === highlight;
  }

  getHotspotInlineMessage(): string {
    const h = this.selectedHotspotDetails?.hotspot || this.selectedHotspot;
    return String(h?.message || '').trim();
  }

  getHotspotLineParts(lineIndex: number, lineText: string): { before: string; highlight: string; after: string } {
    const text = lineText ?? '';
    if (!this.isHotspotHighlightLine(lineIndex)) {
      return { before: text, highlight: '', after: '' };
    }
    const h = this.selectedHotspotDetails?.hotspot || this.selectedHotspot;
    const tr = h?.textRange;
    const lineNo = this.getHotspotHighlightLineNumber(lineIndex);
    if (tr && Number(tr.startLine) === lineNo) {
      const start = Math.max(0, Number(tr.startOffset) || 0);
      const end = Math.min(text.length, Number(tr.endOffset) || text.length);
      if (end > start) {
        return { before: text.slice(0, start), highlight: text.slice(start, end), after: text.slice(end) };
      }
    }
    return { before: '', highlight: text, after: '' };
  }

  /** Empêche l'exécution de <script> dans les contenus de règles tout en les affichant comme texte. */
  private sanitizeRuleHtml(html: string | undefined | null): string {
    if (!html) return '';
    return String(html)
      .replace(/<script/gi, '&lt;script')
      .replace(/<\/script>/gi, '&lt;/script&gt;');
  }

  /** Sections SonarCloud (clés exactes : root_cause, how_to_fix, resources, …). */
  private getRuleSectionContent(rule: any, ...sectionKeys: string[]): string {
    const sections = rule?.descriptionSections as any[] | undefined;
    if (!sections?.length) return '';
    for (const want of sectionKeys) {
      const w = want.toLowerCase();
      const match = sections.find((sec: any) => String(sec?.key || '').toLowerCase() === w);
      if (match?.htmlContent?.trim()) return this.sanitizeRuleHtml(match.htmlContent);
      if (match?.content?.trim()) return this.sanitizeRuleHtml(match.content);
    }
    return '';
  }

  /** Concatène toutes les sections correspondantes (ex. plusieurs blocs resources). */
  private getRuleSectionsContent(rule: any, ...sectionKeys: string[]): string {
    const sections = rule?.descriptionSections as any[] | undefined;
    if (!sections?.length) return '';
    const want = new Set(sectionKeys.map(k => k.toLowerCase()));
    const chunks: string[] = [];
    for (const sec of sections) {
      const key = String(sec?.key || '').toLowerCase();
      if (!want.has(key)) continue;
      const html = sec?.htmlContent?.trim() || sec?.content?.trim();
      if (html) chunks.push(this.sanitizeRuleHtml(html));
    }
    return chunks.join('<hr class="rule-section-sep" />');
  }

  private getRuleWhySectionsContent(rule: any): string {
    const fromSections = this.getRuleSectionsContent(rule, 'root_cause', 'introduction', 'assess_the_problem');
    if (fromSections) return fromSections;
    const fromHtml = this.extractRuleHtmlDescSection(rule, 'why');
    if (fromHtml) return fromHtml;
    if (rule.riskDescription?.trim()) return this.sanitizeRuleHtml(rule.riskDescription);
    if (rule.vulnerabilityDescription?.trim()) return this.sanitizeRuleHtml(rule.vulnerabilityDescription);
    if (rule.htmlDesc?.trim() && !this.isShortRuleText(rule, rule.htmlDesc)) {
      return this.sanitizeRuleHtml(rule.htmlDesc);
    }
    return this.sanitizeRuleHtml(rule.mdDesc || '');
  }

  private getRuleFixSectionsContent(rule: any): string {
    const fromSection = this.getRuleSectionsContent(rule, 'how_to_fix');
    if (fromSection) return fromSection;
    return this.extractRuleHtmlDescSection(rule, 'fix');
  }

  private getRuleAccessSectionsContent(rule: any): string {
    const parts: string[] = [];
    const assess = this.getRuleSectionsContent(rule, 'assess_the_problem');
    if (assess) parts.push(assess);
    if (rule.vulnerabilityDescription?.trim()) {
      parts.push(this.sanitizeRuleHtml(rule.vulnerabilityDescription));
    }
    if (rule.riskDescription?.trim()) {
      parts.push(this.sanitizeRuleHtml(rule.riskDescription));
    }
    const riskBlock = this.extractRuleHtmlDescSection(rule, 'risk');
    if (riskBlock) parts.push(riskBlock);
    const askBlock = this.extractRuleHtmlDescSection(rule, 'ask');
    if (askBlock) parts.push(askBlock);
    return parts.join('<hr class="rule-section-sep" />');
  }

  /** Extrait une section du htmlDesc Sonar (format legacy). */
  private extractRuleHtmlDescSection(rule: any, kind: 'why' | 'fix' | 'more' | 'risk' | 'ask'): string {
    const html = String(rule?.htmlDesc || rule?.mdDesc || '');
    if (!html.trim()) return '';
    const patterns: Record<string, RegExp[]> = {
      why: [
        /<h2>\s*Why is this an issue\??\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
        /<h2>\s*Root [Cc]ause\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      ],
      risk: [
        /<h2>\s*What is the risk\??\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
        /<h2>\s*What's the risk\??\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      ],
      ask: [
        /<h2>\s*Ask [Yy]ourself [Ww]hether\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
        /<h2>\s*Ask [Yy]ourself\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      ],
      fix: [
        /<h2>\s*How can I fix it\??\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
        /<h2>\s*Recommended Secure Coding Practices\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
        /<h2>\s*How to fix\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      ],
      more: [
        /<h2>\s*Resources\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
        /<h2>\s*More info\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
        /<h2>\s*See\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      ],
    };
    for (const re of patterns[kind] || []) {
      const m = html.match(re);
      if (m?.[1]?.trim()) return this.sanitizeRuleHtml(m[1].trim());
    }
    return '';
  }

  private buildRuleMoreInfoContent(rule: any): string {
    const parts: string[] = [];
    const resources = this.getRuleSectionsContent(rule, 'resources');
    if (resources) parts.push(this.presentRuleHtml(resources));

    const seeSection = this.extractRuleDocumentationSection(rule);
    if (seeSection) parts.push(seeSection);

    if (rule?.htmlNote?.trim()) {
      parts.push(this.sanitizeRuleHtml(rule.htmlNote));
    }

    const principles = rule?.educationPrinciples;
    if (Array.isArray(principles) && principles.length) {
      const items = principles
        .map((p: any) => `<li>${this.sanitizeRuleHtml(String(p))}</li>`)
        .join('');
      parts.push(`<h4>Principes</h4><ul class="rule-principles">${items}</ul>`);
    }

    return parts.join('');
  }

  /** Extrait la section Documentation / See / Resources du htmlDesc Sonar. */
  private extractRuleDocumentationSection(rule: any): string {
    const html = String(rule?.htmlDesc || rule?.mdDesc || '');
    if (!html.trim()) return '';
    const patterns = [
      /<h2>\s*Resources\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      /<h2>\s*More info\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      /<h2>\s*See\s*<\/h2>([\s\S]*?)(?=<h2>|$)/i,
      /<h3>\s*Resources\s*<\/h3>([\s\S]*?)(?=<h[23]>|$)/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]?.trim()) {
        return this.presentRuleHtml(`<div class="rule-resources-block">${m[1].trim()}</div>`);
      }
    }
    return '';
  }

  private hasRuleMoreInfoData(rule: any): boolean {
    if (!rule) return false;
    if (this.getRuleSectionsContent(rule, 'resources')) return true;
    if (this.extractRuleDocumentationSection(rule)) return true;
    if (rule.htmlNote?.trim()) return true;
    return Array.isArray(rule.educationPrinciples) && rule.educationPrinciples.length > 0;
  }

  private getSonarRuleDocumentationUrl(_rule: any): string | null {
    return null;
  }

  private isShortRuleText(rule: any, text: string | undefined | null): boolean {
    if (!text?.trim()) return true;
    const t = text.trim();
    const name = String(rule?.name || '').trim();
    return t === name || t.length < 80;
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

  /**
   * Libellés proches de l’UI SonarQube : les métriques *_rating sont des notes 1–5 (1=A … 5=E),
   * pas un nombre de bugs. « Fiabilité » seule prêtait à confusion avec le nombre d’issues.
   */
  formatConditionMetric(metric: string | undefined, cond?: any): string {
    if (cond?.metricLabel) return cond.metricLabel;
    if (!metric) return '';
    const key = metric.toLowerCase();
    if (key.includes('coverage')) return key.includes('new') ? 'Couverture sur le nouveau code' : 'Couverture';
    if (key.includes('security_hotspots')) return 'Points sensibles revus';
    if (key.includes('reliability_rating')) return 'Note de fiabilité';
    if (key.includes('security_rating')) return 'Note de sécurité';
    if (key.includes('maintainability_rating') || key.includes('sqale_rating')) return 'Note de maintenabilité';
    if (key.includes('duplicated')) return 'Duplication';
    if (key.includes('vulnerabilit')) return 'Vulnérabilités';
    if (key.includes('bugs')) return 'Bugs';
    if (key.includes('code_smell')) return 'Code smells';
    return metric;
  }

  /** Métriques Sonar encodées en 1=A, 2=B, 3=C, 4=D, 5=E (API / project_status). */
  isRatingMetric(metricKey: string | undefined): boolean {
    const k = (metricKey || '').toLowerCase();
    return (
      k.includes('reliability_rating') ||
      k.includes('security_rating') ||
      k.includes('maintainability_rating') ||
      k.includes('sqale_rating')
    );
  }

  sonarRatingNumberToLetter(value: string | undefined | null): string {
    const n = parseInt(String(value ?? '').trim(), 10);
    if (n >= 1 && n <= 5) {
      return ['A', 'B', 'C', 'D', 'E'][n - 1];
    }
    return String(value ?? '–');
  }

  /** Valeur affichée (lettre pour les notes, % pour couverture / hotspots / duplication). */
  formatQgPrimaryValue(cond: any): string {
    const raw = cond?.actualValue;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return 'Non calculé';
    }
    const m = (cond?.metric || cond?.metricKey || '').toLowerCase();
    if (this.isRatingMetric(m)) {
      return this.sonarRatingNumberToLetter(cond?.actualValue);
    }
    if (this.isCoverageCondition(cond) || m.includes('security_hotspots_reviewed')) {
      const x = parseFloat(String(cond?.actualValue ?? '0'));
      return `${isNaN(x) ? cond?.actualValue : x.toFixed(1)}%`;
    }
    if (m.includes('duplicated_lines')) {
      const x = parseFloat(String(cond?.actualValue ?? '0'));
      return `${isNaN(x) ? cond?.actualValue : x.toFixed(1)}%`;
    }
    return String(cond?.actualValue ?? '0');
  }

  private formatQgThresholdFormatted(cond: any): string {
    const m = (cond?.metric || cond?.metricKey || '').toLowerCase();
    if (this.isRatingMetric(m)) {
      return this.sonarRatingNumberToLetter(cond?.errorThreshold);
    }
    if (this.isCoverageCondition(cond) || m.includes('security_hotspots_reviewed')) {
      const x = parseFloat(String(cond?.errorThreshold ?? '0'));
      return `${isNaN(x) ? cond?.errorThreshold : x.toFixed(1)}%`;
    }
    if (m.includes('duplicated_lines')) {
      const x = parseFloat(String(cond?.errorThreshold ?? '0'));
      return `${isNaN(x) ? cond?.errorThreshold : x.toFixed(1)}%`;
    }
    return String(cond?.errorThreshold ?? '');
  }

  /**
   * Phrase type SonarQube : « Rating required A », « ≥ 80.0% required », etc.
   */
  formatQgRequirementHint(cond: any): string {
    const m = (cond?.metric || cond?.metricKey || '').toLowerCase();
    const comp = String(cond?.comparator || '').toUpperCase();
    const t = this.formatQgThresholdFormatted(cond);

    if (m.includes('reliability_rating')) {
      return `Note requise : ${t} (fiabilité)`;
    }
    if (m.includes('security_rating')) {
      return `Note requise : ${t} (sécurité)`;
    }
    if (m.includes('maintainability_rating') || m.includes('sqale_rating')) {
      return `Note requise : ${t} (maintenabilité)`;
    }
    if (this.isCoverageCondition(cond) || m.includes('security_hotspots_reviewed')) {
      if (comp === 'LT') {
        return `Minimum ${t} requis`;
      }
      return `Seuil ${t}`;
    }
    if (m.includes('duplicated_lines')) {
      if (comp === 'GT') {
        return `Au plus ${t} autorisé`;
      }
      return `Seuil ${t}`;
    }
    const sym = comp === 'LT' ? '<' : comp === 'GT' ? '>' : comp === 'EQ' ? '=' : '≥';
    return `Seuil ${sym} ${t}`;
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

  /**
   * Depuis le Quality Gate : même comportement que les boutons « Software quality » du panneau Issues
   * (pas de Type forcé BUG/VULN/SMELL — sinon Maintainability + BUG = 0 résultat alors que la facette affiche 495).
   */
  private openIssuesTabWithSoftwareQualityOnly(q: 'RELIABILITY' | 'SECURITY' | 'MAINTAINABILITY'): void {
    this.setTab('issues');
    this.softwareQualityFilter = q;
    this.typeFilter = 'ALL';
    this.severityFilter = 'ALL';
    this.applyIssueFilters();
  }

  onQualityGateConditionClick(cond: any): void {
    if (!cond) return;
    const m = (cond?.metric || cond?.metricKey || '').toLowerCase();
    if (this.isDuplicationCondition(cond)) {
      this.setTab('duplication');
      return;
    }
    if (this.isSecurityHotspotsCondition(cond)) {
      this.setTab('hotspots');
      return;
    }
    if (this.isCoverageCondition(cond)) {
      this.setTab('coverage');
      return;
    }
    if (m.includes('reliability_rating')) {
      this.openIssuesTabWithSoftwareQualityOnly('RELIABILITY');
      return;
    }
    if (m.includes('security_rating')) {
      this.openIssuesTabWithSoftwareQualityOnly('SECURITY');
      return;
    }
    if (m.includes('maintainability_rating') || m.includes('sqale_rating')) {
      this.openIssuesTabWithSoftwareQualityOnly('MAINTAINABILITY');
      return;
    }
    this.setTab('quality');
  }

  onBranchChange(branch: string): void {
    if (!branch || branch === this.currentBranch) return;
    this.currentBranch = branch;
    this.activityHistory = null;
    this.load();
  }

  // ─── Activity (historique) ───────────────────────────────────────────────────

  loadActivityHistory(): void {
    if (!this.currentBranch) return;
    this.activityLoading = true;
    this.sonarService.getActivityHistory(this.currentBranch, this.serviceId || undefined).subscribe({
      next: (res) => {
        this.activityHistory = res;
        this.activityAnalyses = res?.analyses || [];
        this.activityLoading = false;
        if (this.activeTab === 'overview') {
          setTimeout(() => this.initActivityChart(), 80);
        }
      },
      error: () => {
        this.activityHistory = null;
        this.activityAnalyses = [];
        this.activityLoading = false;
      }
    });
  }

  setActivityGraphType(type: 'issues' | 'coverage' | 'duplications'): void {
    if (this.activityGraphType === type) return;
    this.activityGraphType = type;
    setTimeout(() => this.initActivityChart(), 0);
  }

  private parseMeasureHistory(metricName: string): { date: string; value: number }[] {
    const measures = this.activityHistory?.measure_history as any[] | undefined;
    if (!measures?.length) return [];
    const entry = measures.find((m: any) => m.metric === metricName);
    if (!entry?.history?.length) return [];
    return entry.history.map((h: any) => ({
      date: h.date,
      value: parseFloat(h.value) || 0
    }));
  }

  formatActivityDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString('fr-FR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  formatAnalysisDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  getAnalysisIssueDelta(analysis: any, index: number): string {
    if (index >= this.activityAnalyses.length - 1) return '+0 problème(s)';
    const cur = this.parseMeasureHistory('violations');
    if (cur.length < 2) return '+0 problème(s)';
    const delta = cur[cur.length - 1 - index]?.value - cur[cur.length - 2 - index]?.value;
    if (delta === 0) return '= +0 problème(s)';
    return delta > 0 ? `+${delta} problème(s)` : `${delta} problème(s)`;
  }

  private initActivityChart(): void {
    const canvas = this.activityCanvas?.nativeElement;
    if (!canvas) return;
    this.activityChart?.destroy();

    let labels: string[] = [];
    let datasets: Chart['data']['datasets'] = [];

    if (this.activityGraphType === 'issues') {
      const points = this.parseMeasureHistory('violations');
      labels = points.map(p => this.formatActivityDate(p.date));
      datasets = [{
        label: 'Problèmes',
        data: points.map(p => p.value),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.15,
        pointRadius: 4
      }];
    } else if (this.activityGraphType === 'coverage') {
      const points = this.parseMeasureHistory('coverage');
      labels = points.map(p => this.formatActivityDate(p.date));
      datasets = [{
        label: 'Couverture',
        data: points.map(p => p.value),
        borderColor: '#16a34a',
        backgroundColor: 'rgba(22,163,74,0.12)',
        fill: true,
        tension: 0.15,
        pointRadius: 4
      }];
    } else {
      const ncloc = this.parseMeasureHistory('ncloc');
      const dupLines = this.parseMeasureHistory('duplicated_lines');
      const len = Math.max(ncloc.length, dupLines.length);
      labels = (ncloc.length ? ncloc : dupLines).map(p => this.formatActivityDate(p.date));
      datasets = [
        {
          label: 'Lignes de code',
          data: ncloc.map(p => p.value),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          fill: true,
          tension: 0.15,
          pointRadius: 3
        },
        {
          label: 'Lignes dupliquées',
          data: dupLines.map(p => p.value),
          borderColor: '#94a3b8',
          borderDash: [4, 4],
          fill: false,
          tension: 0.15,
          pointRadius: 3
        }
      ];
    }

    if (!labels.length) return;

    this.activityChart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              title: items => items[0]?.label || ''
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // ─── Issue detail ────────────────────────────────────────────────────────────

  loadIssueDetails(issue: any): void {
    if (!issue?.key) return;
    if (!this.userService.getToken()) {
      this.selectedIssue = issue;
      this.issueViewMode = 'detail';
      this.issueDetailLoading = false;
      this.selectedIssueDetails = { error: true, unauthorized: true };
      return;
    }
    this.selectedIssue = issue;
    this.selectedIssueDetails = null;
    this.issueViewMode = 'detail';
    this.issueDetailTab = 'where';
    this.issueDetailLoading = true;
    this.sonarService.getIssueDetails(issue.key, this.currentBranch).subscribe({
      next: (res) => {
        this.selectedIssueDetails = res;
        const detailIssue = res?.issue;
        if (detailIssue) {
          (this.selectedIssue as any)._impactsUi = this.buildIssueImpactsUi(detailIssue);
        }
        this.issueDetailLoading = false;
        setTimeout(() => {
          document.getElementById('issue-highlight-line')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 80);
      },
      error: (err) => {
        const unauthorized = err?.status === 401;
        this.selectedIssueDetails = { error: true, unauthorized };
        this.issueDetailLoading = false;
      }
    });
  }

  getIssueComponentDisplay(): string {
    const issue = this.selectedIssueDetails?.issue || this.selectedIssue;
    if (!issue) return '';
    const comp = issue.component || issue._displayPath || '';
    if (!comp) return '';
    const sep = comp.indexOf(':');
    return sep >= 0 ? comp.substring(sep + 1) : comp;
  }

  getIssueRuleContent(): string {
    const rule: any = this.selectedIssueDetails?.rule;
    if (!rule) return '';
    return this.presentRuleHtml(this.getRuleWhySectionsContent(rule));
  }

  getIssueFixContent(): string {
    const rule: any = this.selectedIssueDetails?.rule;
    if (!rule) return '';
    const raw = this.getRuleFixSectionsContent(rule);
    if (raw) return this.presentRuleHtml(raw);
    if (rule.fixRecommendations?.trim()) {
      return this.presentRuleHtml(rule.fixRecommendations);
    }
    return '';
  }

  hasIssueMoreInfo(): boolean {
    return this.hasRuleMoreInfoData(this.selectedIssueDetails?.rule);
  }

  getIssueMoreInfoContent(): string {
    const rule: any = this.selectedIssueDetails?.rule;
    if (!rule) return '';
    return this.buildRuleMoreInfoContent(rule);
  }

  getIssueHighlightLineNumber(lineIndex: number): number {
    const nums = this.selectedIssueDetails?.sourceLineNumbers as number[] | undefined;
    if (nums?.length && nums[lineIndex] != null) return nums[lineIndex];
    return (this.selectedIssueDetails?.sourceLineFrom || 1) + lineIndex;
  }

  isIssueHighlightLine(lineIndex: number): boolean {
    const highlight = this.selectedIssueDetails?.highlightLine;
    if (!highlight) return false;
    return this.getIssueHighlightLineNumber(lineIndex) === highlight;
  }

  getIssueInlineMessage(): string {
    const issue = this.selectedIssueDetails?.issue || this.selectedIssue;
    return String(issue?.message || '').trim();
  }

  getIssueLineParts(lineIndex: number, lineText: string): { before: string; highlight: string; after: string } {
    const text = lineText ?? '';
    if (!this.isIssueHighlightLine(lineIndex)) {
      return { before: text, highlight: '', after: '' };
    }
    const issue = this.selectedIssueDetails?.issue || this.selectedIssue;
    const tr = issue?.textRange;
    const lineNo = this.getIssueHighlightLineNumber(lineIndex);
    if (tr && Number(tr.startLine) === lineNo) {
      const start = Math.max(0, Number(tr.startOffset) || 0);
      const end = Math.min(text.length, Number(tr.endOffset) || text.length);
      if (end > start) {
        return { before: text.slice(0, start), highlight: text.slice(start, end), after: text.slice(end) };
      }
    }
    return { before: '', highlight: text, after: '' };
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
      this.coverageView = 'tree';
      this.setTab('coverage');
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