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
  activeTab: 'overview' | 'issues' | 'hotspots' | 'duplication' = 'overview';
  severityFilter: string = 'ALL';
  typeFilter: string = 'ALL';
  filteredIssues: any[] = [];
  severityCounts: Record<string, number> = {};
  typeCounts: Record<string, number> = {};

  // Branches / Quality gate détails
  branches: string[] = ['master'];
  currentBranch: string = 'master';
  qualityGateConditions: any[] = [];
  duplicationFiles: { name: string; path: string; duplication: number }[] = [];
  duplicationZeroCount = 0;

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
        this.totalHotspots = res.total_hotspots || 0;
        this.issues = (res.issues || []) as any[];
        this.hotspots = (res.hotspots || []) as any[];
        this.qualityGate = res.quality_gate || null;
        this.qualityGateConditions = this.qualityGate?.conditions || [];

        const rawDup = (res.duplication_components || []) as any[];
        const mapped = rawDup.map(c => {
          const measures = c.measures || [];
          const dupMeasure = measures.find((m: any) => m.metric === 'duplicated_lines_density') || measures[0] || {};
          const val = parseFloat(dupMeasure.value || '0');
          return {
            name: c.name || c.key,
            path: c.path || c.key,
            duplication: isNaN(val) ? 0 : val
          };
        });
        this.duplicationFiles = mapped.filter(f => f.duplication > 0);
        this.duplicationZeroCount = Math.max(0, mapped.length - this.duplicationFiles.length);

        this.computeIssueFacets();
        this.applyIssueFilters();
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
   * Quand on clique sur une carte de la vue d'ensemble.
   */
  onOverviewCardClick(kind: 'quality' | 'vuln' | 'bug' | 'smell' | 'hotspot' | 'dup'): void {
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
      case 'quality':
      default:
        this.applyIssueFilters('ALL', 'ALL');
        break;
    }
  }

  setTab(tab: 'overview' | 'issues' | 'hotspots' | 'duplication'): void {
    this.activeTab = tab;
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
}

