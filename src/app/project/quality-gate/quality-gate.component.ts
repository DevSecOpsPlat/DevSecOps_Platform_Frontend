import { CommonModule } from '@angular/common';

import { Component, OnDestroy, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';

import { ActivatedRoute, Router } from '@angular/router';

import { Subject, interval } from 'rxjs';

import { switchMap, takeUntil, catchError } from 'rxjs/operators';

import { of } from 'rxjs';

import {

  QualityGateResult,

  QualityGateService,

  QualityGateStage,

  QualityGateToolMetric,

  QualityGateEnvironmentOption,

  SoftwareQualityDimension

} from '../../services/quality-gate/quality-gate.service';



@Component({

  selector: 'app-quality-gate',

  standalone: true,

  imports: [CommonModule, FormsModule],

  templateUrl: './quality-gate.component.html',

  styleUrls: ['./quality-gate.component.css']

})

export class QualityGateComponent implements OnInit, OnDestroy {

  private static readonly TOOL_STAGE_MATCHERS: Record<string, string[]> = {
    trivy: ['sca', 'trivy'],
    semgrep: ['sast', 'semgrep'],
    gitleaks: ['secret', 'gitleaks'],
    grype: ['container', 'grype'],
    checkov: ['iac', 'checkov'],
    zap: ['zap', 'dast'],
    hadolint: ['hadolint', 'lint'],
    sonarqube: ['sonar', 'code-analysis']
  };

  private static readonly EMPTY_BY_SEVERITY: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };



  private readonly destroy$ = new Subject<void>();



  appId: string | null = null;

  branches: string[] = [];
  environments: QualityGateEnvironmentOption[] = [];
  selectedBranch = 'main';
  selectedEnvironmentId: string | null = null;

  loading = true;

  aiLoading = false;

  error: string | null = null;

  aiError: string | null = null;

  aiInsight: string | null = null;

  result: QualityGateResult | null = null;

  selectedStage: QualityGateStage | null = null;

  animatedScore = 0;

  showScoringMethod = false;

  /** Évite boucle infinie auto-capture SNAPSHOT_MISSING → refresh → load */
  private autoCaptureAttemptedForEnv: string | null = null;



  constructor(

    private route: ActivatedRoute,

    private router: Router,

    private qualityGateService: QualityGateService

  ) {}



  ngOnInit(): void {

    this.route.parent?.paramMap.pipe(takeUntil(this.destroy$)).subscribe(params => {

      this.appId = params.get('appId');

      if (!this.appId) return;

      this.loadBranches();
      this.loadEnvironments();
      this.load();

      this.startPolling();

    });



    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(qp => {
      const branch = qp.get('branch');
      const environmentId = qp.get('environmentId');
      if (branch) {
        this.selectedBranch = branch;
      }
      if (environmentId) {
        this.selectedEnvironmentId = environmentId;
      }
      if (branch || environmentId) {
        this.loadEnvironments();
        this.load();
      }
    });

  }



  ngOnDestroy(): void {

    this.destroy$.next();

    this.destroy$.complete();

  }



  loadEnvironments(): void {
    if (!this.appId) return;
    // Tous les environnements (sans filtre branche) pour voir chaque nouveau test.
    this.qualityGateService.listEnvironments(this.appId).pipe(
      catchError(() => of([] as QualityGateEnvironmentOption[]))
    ).subscribe(envs => {
      this.environments = envs;
      if (this.selectedEnvironmentId && !envs.some(e => e.environmentId === this.selectedEnvironmentId)) {
        this.selectedEnvironmentId = null;
      }
    });
  }

  loadBranches(): void {

    if (!this.appId) return;

    this.qualityGateService.listBranches(this.appId).pipe(

      catchError(() => of([] as string[]))

    ).subscribe(branches => {

      this.branches = branches.length ? branches : ['main', 'master', 'test'];

      if (!this.branches.includes(this.selectedBranch)) {

        this.selectedBranch = this.branches[0];

      }

    });

  }



  load(refresh = false): void {
    if (!this.appId) return;
    this.loading = true;
    this.error = null;
    this.aiInsight = null;
    this.aiError = null;
    this.qualityGateService.getQualityGate(
      this.appId, this.selectedBranch, this.selectedEnvironmentId, refresh
    ).pipe(

      catchError(err => {

        this.error = err?.error?.message || err?.error?.detail || 'Impossible de charger le quality gate';

        return of(null);

      })

    ).subscribe(res => {

      this.result = res ? this.normalizeResult(res) : null;

      if (this.result?.availableBranches?.length) {

        this.branches = this.result.availableBranches;

      }

      this.loading = false;

      this.animateScoreTo(this.scoreValue);

      this.maybeAutoCaptureMissingSnapshot();

    });

  }

  /** Sans webhook : tente une capture API une fois si snapshot absent et pipeline terminé. */
  private maybeAutoCaptureMissingSnapshot(): void {
    if (!this.appId || !this.selectedEnvironmentId || !this.result) return;
    if (this.result.verdictSource !== 'SNAPSHOT_MISSING') return;
    const ps = (this.result.pipelineStatus || '').toUpperCase();
    if (ps === 'RUNNING' || ps === 'PENDING') return;
    if (this.autoCaptureAttemptedForEnv === this.selectedEnvironmentId) return;
    this.autoCaptureAttemptedForEnv = this.selectedEnvironmentId;
    this.refreshData();
  }



  loadAiInsight(): void {

    if (!this.appId) return;

    this.aiLoading = true;

    this.aiError = null;

    this.qualityGateService.generateAiInsight(this.appId, this.selectedBranch).pipe(

      catchError(() => of({ insight: '', message: 'Erreur lors de l\'appel IA' }))

    ).subscribe(res => {

      this.aiLoading = false;

      if (res.insight) {

        this.aiInsight = res.insight;

      } else {

        this.aiError = res.message || 'IA non disponible (Ollama/Groq)';

      }

    });

  }



  onBranchChange(): void {
    this.selectedEnvironmentId = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { branch: this.selectedBranch, environmentId: null },
      queryParamsHandling: 'merge'
    });
    this.loadEnvironments();
    this.load();
  }

  refreshData(): void {
    if (!this.appId) return;
    if (this.selectedEnvironmentId) {
      this.loading = true;
      this.error = null;
      this.qualityGateService.refreshSnapshot(this.appId, this.selectedEnvironmentId).pipe(
        catchError(err => {
          const msg = err?.error?.message || err?.error?.detail || 'Capture du snapshot impossible';
          this.error = msg;
          return of(null);
        })
      ).subscribe(res => {
        if (res) {
          this.result = this.normalizeResult(res);
          this.loadEnvironments();
          this.animateScoreTo(this.scoreValue);
        } else if (!this.error) {
          this.load(false);
        }
        this.loading = false;
      });
      return;
    }
    this.loading = true;
    this.error = null;
    this.qualityGateService.backfillSnapshots(this.appId).pipe(
      catchError(err => {
        this.error = err?.error?.message || 'Backfill snapshots impossible';
        return of({ status: 'error', created: 0 });
      })
    ).subscribe(() => {
      this.loadEnvironments();
      this.load(false);
    });
  }

  onEnvironmentChange(): void {
    this.autoCaptureAttemptedForEnv = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { environmentId: this.selectedEnvironmentId || null },
      queryParamsHandling: 'merge'
    });
    this.load();
  }



  get pipelinePolling(): boolean {

    const s = this.result?.pipelineStatus;

    return s === 'running' || s === 'pending';

  }



  get scoreValue(): number {

    return this.result?.securityScore?.score ?? 0;

  }



  get scoreGrade(): string {

    return this.result?.securityScore?.grade ?? '—';

  }



  get scoreArcOffset(): number {

    const circumference = 2 * Math.PI * 54;

    const pct = Math.max(0, Math.min(100, this.animatedScore)) / 100;

    return circumference * (1 - pct);

  }



  get scoreArcColor(): string {

    const s = this.animatedScore;

    if (s >= 75) return '#22C55E';

    if (s >= 60) return '#EAB308';

    if (s >= 40) return '#F97316';

    return '#EF4444';

  }



  verdictClass(verdict?: string): string {

    switch (verdict) {

      case 'RECOMMENDED': return 'qg-verdict--ok';

      case 'WITH_WARNINGS': return 'qg-verdict--warn';

      case 'NOT_RECOMMENDED': return 'qg-verdict--fail';

      default: return 'qg-verdict--unknown';

    }

  }



  verdictLabel(verdict?: string): string {

    switch (verdict) {

      case 'RECOMMENDED': return 'RECOMMANDÉ';

      case 'WITH_WARNINGS': return 'AVEC AVERTISSEMENTS';

      case 'NOT_RECOMMENDED': return 'NON RECOMMANDÉ';

      default: return 'INCONNU';

    }

  }



  verdictEmoji(verdict?: string): string {

    switch (verdict) {

      case 'RECOMMENDED': return '🟢';

      case 'WITH_WARNINGS': return '🟡';

      case 'NOT_RECOMMENDED': return '🔴';

      default: return '⚪';

    }

  }



  stageIcon(status?: string): string {

    switch (status) {

      case 'PASS': return '✅';

      case 'WARN': return '⚠️';

      case 'FAIL': return '❌';

      case 'SKIPPED': return '⏭️';

      default: return '○';

    }

  }



  stageClass(status?: string): string {

    return `qg-stage--${(status || 'unknown').toLowerCase()}`;

  }



  toolStatusClass(tool: QualityGateToolMetric): string {
    const status = tool.stageStatus || this.stageForTool(tool)?.status;
    if (status) {
      if (status === 'FAIL') return 'qg-tool-card--fail';
      if (status === 'WARN') return 'qg-tool-card--warn';
      if (status === 'SKIPPED') return 'qg-tool-card--skipped';
      if (status === 'PASS') return 'qg-tool-card--pass';
    }
    return 'qg-tool-card--pass';
  }

  toolStatusLabel(tool: QualityGateToolMetric): string {
    if (tool.stageStatus) return tool.stageStatus;
    const stage = this.stageForTool(tool);
    if (stage?.status) return stage.status;
    return 'PASS';
  }

  toolStageLine(tool: QualityGateToolMetric): string | null {
    const label = tool.stageLabel || tool.stageName || this.stageForTool(tool)?.toolLabel;
    const status = tool.stageStatus || this.stageForTool(tool)?.statusLabel || this.stageForTool(tool)?.status;
    if (!label && !status) return null;
    return `${label || 'Stage'} · ${status || '—'}`;
  }

  showToolTotal(tool: QualityGateToolMetric): boolean {
    return tool.id === 'sonarqube' && tool.total > 0
      && !tool.critical && !tool.high && !tool.medium && !tool.low;
  }



  sqLabel(dimension: string): string {

    switch (dimension) {

      case 'SECURITY': return 'Sécurité';

      case 'RELIABILITY': return 'Fiabilité';

      case 'MAINTAINABILITY': return 'Maintenabilité';

      default: return dimension;

    }

  }



  ratingClass(rating?: string): string {

    if (!rating) return '';

    return `qg-rating--${rating.toLowerCase()}`;

  }



  radarPoints(dimensions: SoftwareQualityDimension[]): string {

    const center = 60;

    const maxR = 42;

    const order = ['SECURITY', 'RELIABILITY', 'MAINTAINABILITY'];

    const pts: string[] = [];

    for (let i = 0; i < 3; i++) {

      const dim = dimensions.find(d => d.dimension === order[i]);

      const val = dim?.ratingValue ?? 3;

      const r = maxR * (val / 5);

      const angle = (i * 120 - 90) * (Math.PI / 180);

      const x = center + r * Math.cos(angle);

      const y = center + r * Math.sin(angle);

      pts.push(`${x},${y}`);

    }

    return pts.join(' ');

  }



  stageRowClass(stage: QualityGateStage): string {
    const base = this.stageClass(stage.status);
    if (stage.status === 'SKIPPED' && this.isCascadeSkipped(stage)) {
      return base + ' qg-stage--cascade';
    }
    return base;
  }

  isCascadeSkipped(stage: QualityGateStage): boolean {
    const stages = this.result?.stages ?? [];
    let afterBlock = false;
    for (const s of stages) {
      if (afterBlock && s.name === stage.name) return true;
      if (s.blocking && s.status === 'FAIL') afterBlock = true;
    }
    return stage.status === 'SKIPPED';
  }

  stageForTool(tool: QualityGateToolMetric): QualityGateStage | null {
    const matchers = QualityGateComponent.TOOL_STAGE_MATCHERS[tool.id];
    if (!matchers?.length || !this.result?.stages?.length) return null;
    return this.result.stages.find(s => {
      const key = (s.name || '').toLowerCase();
      return matchers.some(m => key.includes(m));
    }) ?? null;
  }

  openStageForTool(tool: QualityGateToolMetric): void {
    const stage = this.stageForTool(tool);
    if (stage) {
      this.openStage(stage);
      this.scrollToStage(stage.name);
    }
  }

  scrollToStage(stageName: string): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('qg-stage-' + stageName);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el?.classList.add('qg-stage--highlight');
    setTimeout(() => el?.classList.remove('qg-stage--highlight'), 2000);
  }

  get showSoftwareQualitySection(): boolean {
    return !!this.result?.sonarAvailability?.available;
  }

  get sonarBranchLabel(): string {
    const sa = this.result?.sonarAvailability;
    if (!sa?.available) return '';
    const req = sa.requestedBranch || this.selectedBranch;
    const res = sa.resolvedBranch;
    if (res && req && res !== req) return `${req} → ${res}`;
    return res || req || '';
  }

  get sonarQgPassedWithIssues(): boolean {
    const sm = this.sonarMetrics;
    if (!sm || sm.status !== 'OK') return false;
    const open = (sm.bugs ?? 0) + (sm.vulnerabilities ?? 0) + (sm.codeSmells ?? 0);
    const sev = sm.bySeverity;
    const sevSum = sev
      ? (sev['blocker'] ?? 0) + (sev['critical'] ?? 0) + (sev['major'] ?? 0) + (sev['minor'] ?? 0)
      : 0;
    return open > 0 || sevSum > 0;
  }

  blockingLabel(stage: QualityGateStage): string {
    if (!stage.blocking) return '—';
    return stage.status === 'FAIL' ? 'Oui' : 'Seuil';
  }

  openStage(stage: QualityGateStage): void {
    this.selectedStage = stage;
  }

  closeStage(): void {
    this.selectedStage = null;
  }



  toggleScoringMethod(): void {

    this.showScoringMethod = !this.showScoringMethod;

  }



  get sonarMetrics(): QualityGateResult['metrics']['sonarQube'] | undefined {

    return this.result?.metrics?.sonarQube;

  }



  get sonarQgLabel(): string {

    const s = this.sonarMetrics?.status;

    if (!s) return '—';

    return s === 'OK' ? 'OK ✅' : s === 'ERROR' ? 'ÉCHEC ❌' : String(s);

  }



  get sonarFailedConditions(): string[] {

    const conditions = this.sonarMetrics?.conditions;

    if (!Array.isArray(conditions)) return [];

    return conditions

      .filter((c: Record<string, unknown>) => String(c['status'] || '').toUpperCase() === 'ERROR')

      .map((c: Record<string, unknown>) =>

        String(c['errorDescription'] || `${c['metricKey']}: ${c['actualValue']} (seuil ${c['errorThreshold']})`)

      );

  }



  get criticalCount(): number {

    return this.result?.metrics.bySeverity?.['critical'] ?? 0;

  }



  get highCount(): number {

    return this.result?.metrics.bySeverity?.['high'] ?? 0;

  }



  get mediumCount(): number {

    return this.result?.metrics.bySeverity?.['medium'] ?? 0;

  }



  get lowCount(): number {

    return this.result?.metrics.bySeverity?.['low'] ?? 0;

  }



  get blockingStages(): number {

    return this.result?.metrics.blockingStages ?? this.result?.metrics.failedStages ?? 0;

  }



  severityCount(map: Record<string, number> | undefined, key: string): number {
    if (!map) return 0;
    return map[key] ?? 0;
  }

  breakdownImpactLabel(item: { impact: number; capScore?: number | null }): string {

    if (item.capScore != null) return `plafond ${item.capScore}`;

    if (item.impact < 0) return String(item.impact);

    return '';

  }



  private normalizeResult(res: QualityGateResult): QualityGateResult {

    return {

      ...res,

      stages: res.stages ?? [],

      toolMetrics: res.toolMetrics ?? [],

      softwareQuality: res.softwareQuality ?? [],

      detailedRecommendations: res.detailedRecommendations ?? [],

      practicalAdvice: res.practicalAdvice ?? res.detailedRecommendations ?? [],

      verdictExplanation: res.verdictExplanation ?? [],

      securityScore: res.securityScore

        ? { ...res.securityScore, breakdown: res.securityScore.breakdown ?? [] }

        : undefined,

      metrics: {

        totalVulnerabilities: 0,

        failedStages: 0,

        blockingStages: 0,

        warningStages: 0,

        ...res.metrics,

        bySeverity: {

          ...QualityGateComponent.EMPTY_BY_SEVERITY,

          ...(res.metrics?.bySeverity ?? {})

        }

      }

    };

  }



  private animateScoreTo(target: number): void {

    const prefersReduced = typeof window !== 'undefined'

      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {

      this.animatedScore = target;

      return;

    }

    const start = 0;

    const duration = 800;

    const t0 = performance.now();

    const step = (now: number) => {

      const p = Math.min(1, (now - t0) / duration);

      this.animatedScore = Math.round(start + (target - start) * p);

      if (p < 1) requestAnimationFrame(step);

    };

    requestAnimationFrame(step);

  }



  private startPolling(): void {

    interval(30_000).pipe(

      takeUntil(this.destroy$),

      switchMap(() => {

        if (!this.appId || this.loading) return of(null);

        if (!this.pipelinePolling) return of(null);

        return this.qualityGateService.getQualityGate(this.appId, this.selectedBranch, this.selectedEnvironmentId).pipe(

          catchError(() => of(null))

        );

      })

    ).subscribe(res => {

      if (res) {

        this.result = this.normalizeResult(res);

        this.animateScoreTo(this.scoreValue);

      }

    });

  }

}


