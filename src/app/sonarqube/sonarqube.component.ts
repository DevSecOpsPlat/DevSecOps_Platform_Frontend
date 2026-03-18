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

  @ViewChild('donutCanvas') donutCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('coverageBarCanvas') coverageBarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('severityBarCanvas') severityBarCanvas!: ElementRef<HTMLCanvasElement>;

  loading = true;
  error: string | null = null;

  metrics: any = null;
  totalIssues = 0;
  totalHotspots = 0;
  issues: any[] = [];
  hotspots: any[] = [];
  qualityGate: any = null;

  // Tabs
  activeTab: 'overview' | 'quality' | 'issues' | 'hotspots' | 'duplication' | 'coverage' = 'overview';

  // Issues
  severityFilter: string = 'ALL';
  typeFilter: string = 'ALL';
  filteredIssues: any[] = [];
  severityCounts: Record<string, number> = {};
  typeCounts: Record<string, number> = {};

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

    this.sonarService.getSonarQubeResults().subscribe({
      next: (res) => {
        this.metrics = res.metrics || {};

        const rawIssues = (res.issues || []) as any[];
        this.issues = rawIssues;
        this.totalIssues = rawIssues.length;

        const rawHotspots = (res.hotspots || []) as any[];
        this.hotspots = rawHotspots;
        this.totalHotspots = Math.max(res.total_hotspots || 0, rawHotspots.length);

        this.qualityGate = res.quality_gate || null;
        this.qualityGateConditions = this.qualityGate?.conditions || [];

        this.sonarHostUrl = res.sonar_host_url || null;
        this.sonarProjectKey = res.sonar_project_key || null;

        this.processDuplication(res.duplication_components || []);
        this.processCoverage(res.coverage_components || []);

        this.computeIssueFacets();
        this.applyIssueFilters();
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

  private computeIssueFacets(): void {
    const sevCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    this.issues.forEach(issue => {
      const sev = (issue.severity || 'UNKNOWN').toUpperCase();
      const type = (issue.type || 'OTHER').toUpperCase();
      sevCounts[sev] = (sevCounts[sev] || 0) + 1;
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    this.severityCounts = sevCounts;
    this.typeCounts = typeCounts;
  }

  applyIssueFilters(severity?: string, type?: string): void {
    if (severity) this.severityFilter = severity;
    if (type) this.typeFilter = type;
    this.filteredIssues = this.issues.filter(issue => {
      const sev = (issue.severity || 'UNKNOWN').toUpperCase();
      const t = (issue.type || 'OTHER').toUpperCase();
      return (this.severityFilter === 'ALL' || sev === this.severityFilter)
          && (this.typeFilter === 'ALL' || t === this.typeFilter);
    });
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
    this.issueUpdatingKey = key;
    this.sonarService.issueTransition(key, transition).subscribe({
      next: () => { this.issueUpdatingKey = null; this.load(); },
      error: () => { this.issueUpdatingKey = null; this.load(); }
    });
  }

  assignIssueToMe(issue: any): void {
    const key = issue?.key;
    if (!key) return;
    this.issueUpdatingKey = key;
    this.sonarService.issueAssignToMe(key).subscribe({
      next: () => { this.issueUpdatingKey = null; this.load(); },
      error: () => { this.issueUpdatingKey = null; this.load(); }
    });
  }

  unassignIssue(issue: any): void {
    const key = issue?.key;
    if (!key) return;
    this.issueUpdatingKey = key;
    this.sonarService.issueUnassign(key).subscribe({
      next: () => { this.issueUpdatingKey = null; this.load(); },
      error: () => { this.issueUpdatingKey = null; this.load(); }
    });
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
    this.loading = true;
    this.sonarService.getResultsForBranch(branch).subscribe({
      next: (res) => { this.metrics = res.metrics || this.metrics; this.loading = false; },
      error: (err) => { this.loading = false; this.error = err?.error?.message || 'Erreur'; }
    });
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