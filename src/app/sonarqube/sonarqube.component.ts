import { Component, OnInit } from '@angular/core';
import { SonarQubeService } from '../services/sonarqube/sonarqube.service';

@Component({
  selector: 'app-sonarqube',
  templateUrl: './sonarqube.component.html',
  styleUrls: ['./sonarqube.component.css']
})
export class SonarqubeComponent implements OnInit {
  loading = true;
  error: string | null = null;

  metrics: any = null;
  totalIssues = 0;
  totalHotspots = 0;
  issues: any[] = [];
  hotspots: any[] = [];
  qualityGate: any = null;

  // Vue & filtres
  activeTab: 'overview' | 'quality' | 'issues' | 'hotspots' | 'duplication' = 'overview';
  severityFilter: string = 'ALL';
  typeFilter: string = 'ALL';
  filteredIssues: any[] = [];
  severityCounts: Record<string, number> = {};
  typeCounts: Record<string, number> = {};

  // Branches / Quality gate détails
  branches: string[] = ['master'];
  currentBranch: string = 'master';
  qualityGateConditions: any[] = [];
  duplicationFiles: { name: string; path: string; duplication: number; key?: string; url?: string }[] = [];
  duplicationZeroCount = 0;
  coverageFiles: { path: string; coverage: number; uncoveredLines: number; uncoveredConditions: number }[] = [];

  private sonarHostUrl: string | null = null;
  private sonarProjectKey: string | null = null;

  // Détail duplication sélectionné
  selectedDupFile: any | null = null;
  selectedDupSourceLines: string[] = [];
  selectedDupMeta: any = null;

  // Security Hotspots : filtre et détail
  hotspotStatusFilter: string = 'ALL';
  filteredHotspots: any[] = [];
  hotspotCountByStatus: Record<string, number> = {};
  selectedHotspot: any | null = null;
  selectedHotspotDetails: any | null = null;
  hotspotDetailTab: 'where' | 'risk' | 'fix' | 'access' | 'activity' = 'where';

  // View modes
  coverageView: 'list' | 'tree' = 'list';
  duplicationView: 'list' | 'tree' = 'list';
  coverageTree: { group: string; files: { path: string; coverage: number; uncoveredLines: number; uncoveredConditions: number }[] }[] = [];
  duplicationTree: { group: string; files: { name: string; path: string; duplication: number; key?: string; url?: string }[] }[] = [];
  coverageExpanded: Record<string, boolean> = {};
  duplicationExpanded: Record<string, boolean> = {};

  constructor(private sonarService: SonarQubeService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    this.sonarService.getSonarQubeResults().subscribe({
      next: (res) => {
        this.metrics = res.metrics || {};
        this.totalIssues = res.total_issues || 0;
        const rawHotspots = (res.hotspots || []) as any[];
        this.hotspots = rawHotspots;
        this.totalHotspots = Math.max(res.total_hotspots || 0, rawHotspots.length);
        this.qualityGate = res.quality_gate || null;
        this.qualityGateConditions = this.qualityGate?.conditions || [];

        this.sonarHostUrl = res.sonar_host_url || null;
        this.sonarProjectKey = res.sonar_project_key || null;

        const rawDup = (res.duplication_components || []) as any[];
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

        const rawCov = (res.coverage_components || []) as any[];
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
        this.duplicationTree = this.buildTree(this.duplicationFiles);
        this.duplicationExpanded = {};

        this.computeIssueFacets();
        this.applyIssueFilters();
        this.applyHotspotStatusFilter();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Impossible de charger les résultats SonarQube';
      }
    });
  }

  getQualityGateStatus(): string {
    return this.qualityGate?.status || 'UNKNOWN';
  }

  qualityGateClass(): string {
    const status = this.getQualityGateStatus().toUpperCase();
    if (status === 'OK') return 'qg-ok';
    if (status === 'ERROR') return 'qg-error';
    if (status === 'WARN') return 'qg-warn';
    return 'qg-unknown';
  }

  /**
   * Quand on clique sur une carte de la vue d'ensemble (hors Quality Gate).
   */
  onOverviewCardClick(kind: 'vuln' | 'bug' | 'smell' | 'hotspot' | 'dup'): void {
    if (kind === 'hotspot') {
      this.setTab('hotspots');
      return;
    }

    if (kind === 'dup') {
      this.setTab('duplication');
      return;
    }

    this.setTab('issues');

    switch (kind) {
      case 'vuln':
        this.applyIssueFilters(undefined, 'VULNERABILITY');
        break;
      case 'bug':
        this.applyIssueFilters(undefined, 'BUG');
        break;
      case 'smell':
        this.applyIssueFilters(undefined, 'CODE_SMELL');
        break;
      default:
        this.applyIssueFilters('ALL', 'ALL');
        break;
    }
  }

  setTab(tab: 'overview' | 'quality' | 'issues' | 'hotspots' | 'duplication'): void {
    this.activeTab = tab;
  }

  openQualityGateTab(): void {
    this.setTab('quality');
  }

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
      const sevOk = this.severityFilter === 'ALL' || sev === this.severityFilter;
      const typeOk = this.typeFilter === 'ALL' || t === this.typeFilter;
      return sevOk && typeOk;
    });
  }

  /**
   * Changement de branche (simple sélecteur).
   */
  onBranchChange(branch: string): void {
    if (!branch || branch === this.currentBranch) {
      return;
    }
    this.currentBranch = branch;
    this.loading = true;
    this.error = null;

    this.sonarService.getResultsForBranch(branch).subscribe({
      next: (res) => {
        this.metrics = res.metrics || this.metrics;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Impossible de charger les résultats pour cette branche';
      }
    });
  }

  /**
   * Label lisible pour une condition de Quality Gate.
   */
  formatConditionMetric(metric: string | undefined): string {
    if (!metric) return '';
    const key = metric.toLowerCase();
    if (key.includes('coverage')) return 'Coverage';
    if (key.includes('security_hotspots_reviewed')) return 'Security Hotspots Reviewed';
    return metric;
  }

  isCoverageCondition(cond: any): boolean {
    const key = (cond.metric || cond.metricKey || '').toString().toLowerCase();
    return key.includes('coverage');
  }

  isSecurityHotspotsCondition(cond: any): boolean {
    const key = (cond.metric || cond.metricKey || '').toString().toLowerCase();
    return key.includes('security_hotspots_reviewed');
  }

  isCoverageGroupExpanded(group: string): boolean {
    return !!this.coverageExpanded[group];
  }

  toggleCoverageGroup(group: string): void {
    this.coverageExpanded[group] = !this.coverageExpanded[group];
  }

  isDuplicationGroupExpanded(group: string): boolean {
    return !!this.duplicationExpanded[group];
  }

  toggleDuplicationGroup(group: string): void {
    this.duplicationExpanded[group] = !this.duplicationExpanded[group];
  }

  /** Normalise le statut SonarQube (ex: "To Review" → "TO_REVIEW") pour comparaison. */
  private normalizeHotspotStatus(status: string): string {
    return (status || '').toUpperCase().replace(/\s+/g, '_');
  }

  applyHotspotStatusFilter(status?: string): void {
    if (status) this.hotspotStatusFilter = status;
    if (!this.hotspots?.length) {
      this.filteredHotspots = [];
      this.hotspotCountByStatus = { ALL: 0, TO_REVIEW: 0, FIXED: 0, SAFE: 0 };
      return;
    }
    this.computeHotspotCountByStatus();
    if (this.hotspotStatusFilter === 'ALL') {
      this.filteredHotspots = [...this.hotspots];
      return;
    }
    this.filteredHotspots = this.hotspots.filter((h: any) =>
      this.normalizeHotspotStatus(h.status) === this.hotspotStatusFilter
    );
  }

  private computeHotspotCountByStatus(): void {
    const counts: Record<string, number> = { ALL: this.hotspots?.length || 0, TO_REVIEW: 0, FIXED: 0, SAFE: 0 };
    (this.hotspots || []).forEach((h: any) => {
      const s = this.normalizeHotspotStatus(h.status);
      if (s === 'TO_REVIEW') counts['TO_REVIEW']++;
      else if (s === 'FIXED') counts['FIXED']++;
      else if (s === 'SAFE') counts['SAFE']++;
    });
    this.hotspotCountByStatus = counts;
  }

  loadHotspotDetails(h: any): void {
  const key = h?.key;
  if (!key) return;
  
  this.selectedHotspot = h;
  this.selectedHotspotDetails = null;
  
  this.sonarService.getHotspotDetails(key).subscribe({
    next: (res) => {
      // Normalisation : s'assurer que rule est au bon endroit
      const normalizedRes = { ...res };
      
      // Si rule est dans hotspot.rule, on le remonte
      if (res.hotspot?.rule && !res.rule) {
        normalizedRes.rule = res.hotspot.rule;
      }
      
      this.selectedHotspotDetails = normalizedRes;
      
      // Logs pour debug
      console.log('[SonarQube] Détails hotspot normalisés:', normalizedRes);
      console.log('[SonarQube] rule:', normalizedRes.rule);
      console.log('[SonarQube] riskDescription:', normalizedRes.rule?.riskDescription);
      console.log('[SonarQube] fixRecommendations:', normalizedRes.rule?.fixRecommendations);
    },
    error: () => {
      this.selectedHotspotDetails = { error: true };
    }
  });
}
  getHotspotStatusLabel(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'TO_REVIEW') return 'À revoir';
    if (s === 'FIXED') return 'Corrigé';
    if (s === 'SAFE') return 'Sûr';
    return status || '–';
  }

 /** Contenu pour l’onglet « Quel est le risque ? » */
getRuleRiskContent(): string {
  const rule: any = this.selectedHotspotDetails?.rule;
  if (!rule) return '';

  // Log pour debug
  console.log('[SonarQube] Règle complète pour risk:', rule);

  // 1. Essayer riskDescription (présent dans ta console)
  if (typeof rule.riskDescription === 'string' && rule.riskDescription.trim()) {
    console.log('[SonarQube] Utilisation de riskDescription');
    return rule.riskDescription;
  }

  // 2. Essayer vulnerabilityDescription (présent dans ta console)
  if (typeof rule.vulnerabilityDescription === 'string' && rule.vulnerabilityDescription.trim()) {
    console.log('[SonQube] Utilisation de vulnerabilityDescription');
    return rule.vulnerabilityDescription;
  }

  // 3. Chercher dans les sections si présentes
  const sections = rule.descriptionSections as any[] | undefined;
  if (sections && sections.length) {
    for (const key of ['risk', 'vulnerability', 'risk_description', 'what_is_the_risk']) {
      const section = sections.find(s => 
        (s.key || '').toString().toLowerCase().includes(key)
      );
      if (section?.htmlContent) return section.htmlContent;
      if (section?.content) return section.content;
    }
  }

  // 4. Fallback sur la description globale
  if (rule.htmlDesc) return rule.htmlDesc;
  if (rule.mdDesc) return rule.mdDesc;
  
  return '';
}

/** Contenu pour l’onglet « Comment corriger ? » */
getRuleFixContent(): string {
  const rule: any = this.selectedHotspotDetails?.rule;
  if (!rule) return '';

  // Log pour debug
  console.log('[SonarQube] Règle complète pour fix:', rule);

  // 1. Essayer fixRecommendations (présent dans ta console)
  if (typeof rule.fixRecommendations === 'string' && rule.fixRecommendations.trim()) {
    console.log('[SonarQube] Utilisation de fixRecommendations');
    return rule.fixRecommendations;
  }

  // 2. Chercher dans les sections si présentes
  const sections = rule.descriptionSections as any[] | undefined;
  if (sections && sections.length) {
    for (const key of ['fix', 'how_to_fix', 'remediation', 'fix_recommendation']) {
      const section = sections.find(s => 
        (s.key || '').toString().toLowerCase().includes(key)
      );
      if (section?.htmlContent) return section.htmlContent;
      if (section?.content) return section.content;
    }
  }

  // 3. Fallback sur la description globale
  if (rule.htmlDesc) return rule.htmlDesc;
  if (rule.mdDesc) return rule.mdDesc;
  
  return '';
}

  /** Contenu pour l’onglet « Quel est le risque ? » (plusieurs clés + htmlDesc). */
 // Dans sonarqube.component.ts, remplace getRuleRiskContent et getRuleFixContent



  /** Affiche le composant (fichier) du hotspot sans [object Object]. */
  getHotspotComponentDisplay(): string {
    const h = this.selectedHotspotDetails?.hotspot;
    if (!h) return '';
    const key = h.componentKey;
    if (typeof key === 'string') return key;
    const comp = h.component;
    if (typeof comp === 'string') return comp;
    if (comp && typeof comp === 'object') return (comp as any).key || (comp as any).path || (comp as any).name || '';
    return '';
  }

  /** Contenu pour l’onglet « Accès au risque » - Affiche vulnerabilityDescription */
getRuleAccessContent(): string {
  const rule: any = this.selectedHotspotDetails?.rule;
  if (!rule) return '';

  // Log pour debug
  console.log('[SonarQube] Règle complète pour access:', rule);

  // Afficher vulnerabilityDescription
  if (typeof rule.vulnerabilityDescription === 'string' && rule.vulnerabilityDescription.trim()) {
    console.log('[SonarQube] Utilisation de vulnerabilityDescription');
    return rule.vulnerabilityDescription;
  }

  // Fallback si vulnerabilityDescription n'existe pas
  if (typeof rule.riskDescription === 'string' && rule.riskDescription.trim()) {
    console.log('[SonarQube] Fallback sur riskDescription');
    return rule.riskDescription;
  }

  return 'Aucune description du risque disponible.';
}

  private buildTree<T extends { path: string }>(files: T[]): { group: string; files: T[] }[] {
    const groups = new Map<string, T[]>();
    files.forEach(f => {
      const rawPath = f.path || '';
      const firstSegment = rawPath.split(/[\\/]/)[0] || '(root)';
      const groupKey = firstSegment || '(root)';
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(f);
    });

    return Array.from(groups.entries())
      .map(([group, items]) => ({
        group,
        files: items.sort((a: any, b: any) => (a.path || '').localeCompare(b.path || ''))
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }

  private buildSonarFileUrl(componentKey: string | undefined | null): string | undefined {
    if (!componentKey || !this.sonarHostUrl || !this.sonarProjectKey) return undefined;
    const base = this.sonarHostUrl.replace(/\/+$/, '');
    return `${base}/code?id=${encodeURIComponent(this.sonarProjectKey)}&selected=${encodeURIComponent(componentKey)}`;
  }

  /**
   * Charge les lignes dupliquées pour un fichier et son code source.
   */
  loadDuplicationDetails(file: { key?: string }): void {
    if (!file.key) return;
    this.selectedDupFile = { ...file, loading: true };
    this.selectedDupSourceLines = [];
    this.selectedDupMeta = null;

    this.sonarService.getFileDuplications(file.key).subscribe({
      next: res => {
        const src: string = res.source || '';
        this.selectedDupSourceLines = src.split(/\r?\n/);
        this.selectedDupMeta = res.duplications || null;
        this.selectedDupFile.loading = false;
      },
      error: () => {
        this.selectedDupFile.loading = false;
      }
    });
  }
  
}

