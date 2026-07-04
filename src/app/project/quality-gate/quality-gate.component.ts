import { CommonModule } from '@angular/common';

import { Component, OnDestroy, OnInit } from '@angular/core';

import { FormsModule } from '@angular/forms';

import { ActivatedRoute, Router } from '@angular/router';

import { trigger, transition, style, animate } from '@angular/animations';

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

export interface DeploymentCondition {
  id: string;
  label: string;
  rule: string;
  status: 'ok' | 'violated' | 'indeterminate';
  detail?: string;
}

@Component({

  selector: 'app-quality-gate',

  standalone: true,

  imports: [CommonModule, FormsModule],

  templateUrl: './quality-gate.component.html',

  styleUrls: ['./quality-gate.component.css'],

  animations: [
    trigger('verdictPop', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.85)' }),
        animate('260ms cubic-bezier(0.34,1.56,0.64,1)',
          style({ opacity: 1, transform: 'scale(1)' }))
      ])
    ])
  ]

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

  nclocInfoOpen = false;

  readonly gradeScale: Array<{ grade: string; min: number; label: string }> = [
    { grade: 'A', min: 90, label: 'Excellent' },
    { grade: 'B', min: 75, label: 'Bon' },
    { grade: 'C', min: 60, label: 'Moyen' },
    { grade: 'D', min: 40, label: 'Faible' },
    { grade: 'E', min: 0, label: 'Critique' }
  ];

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
    this.qualityGateService.listEnvironments(this.appId, this.selectedBranch).pipe(
      catchError(() => of([] as QualityGateEnvironmentOption[]))
    ).subscribe(envs => {
      this.environments = envs;
      if (this.selectedEnvironmentId && !envs.some(e => e.environmentId === this.selectedEnvironmentId)) {
        this.selectedEnvironmentId = envs.length ? envs[0].environmentId : null;
      }
      if (!this.selectedEnvironmentId && envs.length) {
        this.selectedEnvironmentId = envs[0].environmentId;
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

  /** Sans webhook : tente un refresh API une fois si snapshot absent et pipeline terminé. */
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

    this.qualityGateService.generateAiInsight(this.appId, this.selectedBranch, this.selectedEnvironmentId).pipe(

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
    this.autoCaptureAttemptedForEnv = null;
    this.result = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { branch: this.selectedBranch, environmentId: null },
      queryParamsHandling: 'merge'
    });
    this.loadEnvironmentsAndRefresh();
  }

  /** Après changement de branche : sélectionne le 1er env puis recharge le snapshot BDD. */
  private loadEnvironmentsAndRefresh(): void {
    if (!this.appId) return;
    this.qualityGateService.listEnvironments(this.appId, this.selectedBranch).pipe(
      catchError(() => of([] as QualityGateEnvironmentOption[]))
    ).subscribe(envs => {
      this.environments = envs;
      if (this.selectedEnvironmentId && !envs.some(e => e.environmentId === this.selectedEnvironmentId)) {
        this.selectedEnvironmentId = envs.length ? envs[0].environmentId : null;
      }
      if (!this.selectedEnvironmentId && envs.length) {
        this.selectedEnvironmentId = envs[0].environmentId;
      }
      if (this.selectedEnvironmentId) {
        this.load(false);
      } else {
        this.loading = false;
        this.result = null;
      }
    });
  }

  /** Recharge le snapshot enregistré (quality_gate_snapshots) et synchronise le statut GitLab. */
  refreshData(): void {
    const appId = this.appId;
    const environmentId = this.selectedEnvironmentId;
    if (!appId || !environmentId) {
      this.error = 'Sélectionnez un environnement pour actualiser.';
      return;
    }
    this.loading = true;
    this.error = null;
    this.qualityGateService.getQualityGate(
      appId, this.selectedBranch, environmentId, false
    ).pipe(
      catchError(err => {
        const msg = err?.error?.message || err?.error?.detail || 'Actualisation impossible';
        this.error = msg;
        return of(null);
      })
    ).subscribe(res => {
      if (res) {
        this.result = this.normalizeResult(res);
        this.animateScoreTo(this.scoreValue);
      }
      this.loadEnvironments();
      this.loading = false;
    });
  }

  /** Recapture live (DefectDojo + Sonar) et persiste un nouveau snapshot en BDD. */
  captureSnapshot(): void {
    const appId = this.appId;
    const environmentId = this.selectedEnvironmentId;
    if (!appId || !environmentId) {
      this.error = 'Sélectionnez un environnement.';
      return;
    }
    this.loading = true;
    this.error = null;
    this.qualityGateService.refreshSnapshot(appId, environmentId).pipe(
      catchError(err => {
        const msg = err?.error?.message || err?.error?.detail || 'Capture du snapshot impossible';
        this.error = msg;
        return of(null);
      })
    ).subscribe(res => {
      if (res) {
        this.result = this.normalizeResult(res);
        this.animateScoreTo(this.scoreValue);
      }
      this.loadEnvironments();
      this.loading = false;
    });
  }

  onEnvironmentChange(): void {
    this.autoCaptureAttemptedForEnv = null;
    this.result = null;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { environmentId: this.selectedEnvironmentId || null },
      queryParamsHandling: 'merge'
    });
    this.load(false);
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



  get deduplicatedStages(): QualityGateStage[] {
    if (!this.result?.stages?.length) return [];
    const seen = new Map<string, QualityGateStage>();
    for (const stage of this.result.stages) {
      const key = this.stageDedupKey(stage);
      if (!seen.has(key)) {
        seen.set(key, stage);
      }
    }
    return Array.from(seen.values());
  }

  get hasHardGateViolations(): boolean {
    return (this.result?.hardGateViolations?.length ?? 0) > 0;
  }

  get showIncompleteBanner(): boolean {
    if (this.usesPipelineVulnFallback()) {
      return false;
    }
    if (this.result?.verdictSource === 'PIPELINE_IN_PROGRESS') {
      return false;
    }
    if (this.result?.verdict === 'INDETERMINE') {
      return true;
    }
    const sources = this.result?.indeterminateSources ?? [];
    if (!sources.length) {
      return false;
    }
    // Ne pas afficher « Sonar indisponible » si les hard gates Sonar sont déjà évalués (OK ou violés).
    const sonarOnly = sources.length === 1 && sources[0] === 'SonarQube';
    const sonarEvaluated = this.deploymentConditions
      .filter(c => c.id === 'sonar_blocker' || c.id === 'sonar_qg')
      .every(c => c.status !== 'indeterminate');
    if (sonarOnly && sonarEvaluated) {
      return false;
    }
    return sources.length > 0;
  }

  get vulnCentralizationLabel(): string {
    if (this.metricsFromSecurityValidation && this.result?.defectDojoAvailable === false) {
      return 'Rapport security-validation';
    }
    return 'Centralisation des vulnérabilités';
  }

  get canCaptureSnapshot(): boolean {
    return this.result?.canCaptureSnapshot === true;
  }

  get refreshButtonTitle(): string {
    return 'Recharger le snapshot enregistré pour cet environnement et synchroniser le statut GitLab';
  }

  /** Données issues de quality_gate_snapshots (pas un recalcul live DefectDojo/Sonar). */
  get isViewingFrozenSnapshot(): boolean {
    const r = this.result;
    return !!(r && (r.fromSnapshot === true || r.snapshotId));
  }

  /** Job security-validation en échec sur GitLab (pas le verdict NON_RECOMMANDÉ). */
  get securityValidationFailed(): boolean {
    const r = this.result;
    if (!r) return false;
    if (r.verdictSource === 'SECURITY_VALIDATION_FAILED') return true;
    if (r.metrics?.securityValidationFailed === true) return true;
    if (r.metrics?.securityValidationGitlabFailed === true) return true;
    return false;
  }

  get showToolsAndMetricsDetail(): boolean {
    return this.showPipelineDetail && !this.securityValidationFailed;
  }

  get showTimeline(): boolean {
    if (this.securityValidationFailed) {
      return this.deduplicatedStages.length > 0;
    }
    return this.showPipelineDetail;
  }

  get pipelineInProgress(): boolean {
    if (this.hasFrozenQualityGateDisplay()) return false;
    const ps = this.result?.pipelineStatus?.toLowerCase();
    if (ps === 'running' || ps === 'pending' || ps === 'created') return true;
    return this.result?.verdictSource === 'PIPELINE_IN_PROGRESS';
  }

  /** Snapshot ou security-validation déjà figés : ne pas masquer le détail ni rebasculer les conditions. */
  private hasFrozenQualityGateDisplay(): boolean {
    const r = this.result;
    if (!r) return false;
    if (this.securityValidationFailed) return false;
    if (r.metricsFromSecurityValidation || r.metrics?.metricsFromSecurityValidation) return true;
    if (r.fromSnapshot && r.verdict && r.verdict !== 'INDETERMINE') return true;
    const hasTools = (r.toolMetrics?.length ?? 0) > 0;
    const hasStages = (r.stages?.length ?? 0) > 0;
    const hasSq = (r.softwareQuality?.length ?? 0) > 0;
    if ((hasTools || hasStages || hasSq) && r.verdictSource !== 'PIPELINE_IN_PROGRESS') return true;
    return false;
  }

  /** Pipeline GitLab terminé — l'état d'avancement vient de pipelineStatus (rafraîchi
   *  à chaque lecture), jamais de la valeur figée dans le snapshot. */
  get pipelineFinished(): boolean {
    const ps = this.result?.pipelineStatus?.toLowerCase();
    if (ps === 'success' || ps === 'failed' || ps === 'canceled' || ps === 'cancelled') {
      return true;
    }
    if (ps === 'running' || ps === 'pending' || ps === 'created') {
      return false;
    }
    // pipelineStatus absent : on retombe sur la valeur figée
    return this.result?.pipelineFinished === true;
  }

  get showPipelineDetail(): boolean {
    if (this.hasDisplayablePipelineDetail()) return true;
    if (this.pipelineInProgress) return false;
    return this.pipelineFinished || this.result?.pipelineFinished === true;
  }

  private hasDisplayablePipelineDetail(): boolean {
    const r = this.result;
    if (!r) return false;
    const hasTools = (r.toolMetrics?.length ?? 0) > 0;
    const hasStages = (r.stages?.length ?? 0) > 0;
    if (hasTools || hasStages) return true;
    if (this.metricsFromSecurityValidation || r.fromSnapshot) {
      return hasTools
        || hasStages
        || (r.softwareQuality?.length ?? 0) > 0
        || this.sonarResultsAvailable;
    }
    return false;
  }

  get practicalAdviceList(): string[] {
    return this.result?.practicalAdvice?.length
      ? this.result.practicalAdvice
      : (this.result?.detailedRecommendations ?? []);
  }

  trackAdvice(_index: number, rec: string): string {
    return rec;
  }

  trackCondition(_index: number, c: DeploymentCondition): string {
    return c.id;
  }

  /** Agrège les sévérités depuis les cartes outils (fallback security-validation). */
  private severityFromTools(): Record<string, number> {
    const tools = this.result?.toolMetrics ?? [];
    const out = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const t of tools) {
      out.critical += t.critical ?? 0;
      out.high += t.high ?? 0;
      out.medium += t.medium ?? 0;
      out.low += t.low ?? 0;
    }
    return out;
  }

  private preferToolSeverity(key: 'critical' | 'high' | 'medium' | 'low'): number {
    const fromMetrics = this.result?.metrics?.bySeverity?.[key] ?? 0;
    if (this.result?.defectDojoAvailable && !this.metricsFromSecurityValidation) {
      return fromMetrics;
    }
    if (fromMetrics > 0) {
      return fromMetrics;
    }
    return this.severityFromTools()[key];
  }

  get sonarJobFailed(): boolean {
    return this.result?.metrics?.sonarJobFailed === true;
  }

  get sonarResultsAvailable(): boolean {
    if (this.result?.metrics?.sonarJobFailed) return false;
    if (this.result?.sonarAvailability?.available) return true;
    const sq = this.result?.metrics?.sonarQube;
    if (sq && (sq.bugs != null || sq.vulnerabilities != null || sq.status != null || sq.hotspots != null)) {
      return true;
    }
    return (this.result?.softwareQuality?.length ?? 0) > 0;
  }

  get metricsFromSecurityValidation(): boolean {
    return this.result?.metricsFromSecurityValidation === true
      || this.result?.metrics?.metricsFromSecurityValidation === true;
  }

  get totalVulnCount(): number {
    return this.openVulnCount();
  }

  /** Somme crit+high+med+low — critiques ⊂ ouvertes. */
  private openVulnCount(): number {
    const sev = this.result?.metrics?.bySeverity;
    if (sev) {
      const sum = (sev['critical'] ?? 0) + (sev['high'] ?? 0) + (sev['medium'] ?? 0) + (sev['low'] ?? 0);
      if (sum > 0) {
        return sum;
      }
    }
    const fromTools = this.severityFromTools();
    const toolSum = fromTools['critical'] + fromTools['high'] + fromTools['medium'] + fromTools['low'];
    if (toolSum > 0) {
      return toolSum;
    }
    return this.result?.metrics?.totalVulnerabilities ?? 0;
  }

  get vulnMetricsAvailable(): boolean {
    if (this.securityValidationFailed) return false;
    return this.result?.defectDojoAvailable !== false || this.metricsFromSecurityValidation;
  }

  get noScoreMessage(): string {
    if (this.securityValidationFailed) {
      return 'Score de posture non calculable — le pipeline ne s\'est pas terminé avec succès (security-validation en échec).';
    }
    if (this.result?.verdict === 'INDETERMINE') {
      return 'Score de posture non calculable — source indisponible.';
    }
    const sonarQgOk = this.sonarQgStatusOk;
    const base = 'Score de posture non calculé — hard gate(s) violé(s) (secrets, critiques, blockers…).';
    if (sonarQgOk) {
      return base + ' Le Quality Gate SonarQube est OK (indépendant du score).';
    }
    return base;
  }

  get sonarQgStatusOk(): boolean {
    const s = (this.sonarMetrics?.status ?? '').toUpperCase();
    return s === 'OK' || s === 'PASSED' || s === 'PASS';
  }

  get sonarBlockerCount(): number {
    return this.result?.metrics?.sonarQube?.bySeverity?.['blocker'] ?? 0;
  }

  get sonarCriticalCount(): number {
    const fromMetrics = this.result?.metrics?.sonarCritical;
    if (fromMetrics != null) {
      return fromMetrics;
    }
    const sev = this.sonarMetrics?.bySeverity;
    if (sev?.['critical'] != null) {
      return Number(sev['critical']);
    }
    const sonarTool = this.result?.toolMetrics?.find(t => t.id === 'sonarqube');
    return sonarTool?.high ?? 0;
  }

  get ddCentralCriticalCount(): number {
    const fromMetrics = this.result?.metrics?.ddCritical;
    if (fromMetrics != null) {
      return fromMetrics;
    }
    return this.result?.metrics?.bySeverity?.['critical'] ?? this.severityFromTools()['critical'];
  }

  get pipelineCriticalCount(): number {
    const combined = this.result?.metrics?.combinedCritical;
    if (combined != null) {
      return combined;
    }
    return this.ddCentralCriticalCount + this.sonarCriticalCount;
  }

  criticalRuleLabel(): string {
    const total = this.pipelineCriticalCount;
    const dd = this.ddCentralCriticalCount;
    const sonar = this.sonarCriticalCount;
    if (this.metricsFromSecurityValidation) {
      return sonar > 0
        ? `Pipeline · Critical = ${total} (Sonar ${sonar})`
        : `Pipeline (SCA+Container) · Critical = ${total}`;
    }
    if (sonar > 0 && dd > 0) {
      return `Critical = ${total} (central. ${dd} + Sonar ${sonar})`;
    }
    if (sonar > 0) {
      return `Critical = ${total} (SonarQube ${sonar})`;
    }
    return `Centralisation vuln. · Critical = ${total}`;
  }

  get failedScanJobLabels(): string[] {
    const fromApi = this.result?.failedScanJobs ?? this.result?.metrics?.failedScanJobs;
    if (fromApi && fromApi.length > 0) {
      return fromApi;
    }
    if (this.result?.reliabilityMessage) {
      return [];
    }
    return this.fallbackUnreliableJobsFromStages();
  }

  get recommendationReliable(): boolean {
    const r = this.result;
    if (!r || this.securityValidationFailed) {
      return false;
    }
    if (this.failedScanJobLabels.length > 0) {
      return false;
    }
    if (r.recommendationReliable === false || r.metrics?.recommendationReliable === false) {
      return false;
    }
    return true;
  }

  get reliabilityMessage(): string {
    if (this.result?.reliabilityMessage) {
      return this.result.reliabilityMessage;
    }
    const labels = this.failedScanJobLabels;
    if (labels.length === 0) {
      return '';
    }
    return `Recommandation peu fiable — ${labels.join(', ')} : vérifiez le job dans le pipeline GitLab, corrigez l'erreur puis relancez le job security-validation.`;
  }

  get showReliabilityBanner(): boolean {
    return !this.loading
      && !this.securityValidationFailed
      && !this.recommendationReliable
      && this.failedScanJobLabels.length > 0;
  }

  /**
   * Jobs GitLab en échec ou non exécutés — exclut les FAIL « seuil dépassé » (secrets, vulns…).
   */
  get unsuccessfulStages(): QualityGateStage[] {
    return this.deduplicatedStages.filter(s => this.isGitlabJobProblem(s));
  }

  private fallbackUnreliableJobsFromStages(): string[] {
    const labels: string[] = [];
    for (const s of this.unsuccessfulStages) {
      const base = s.toolLabel || s.name;
      if (!base) {
        continue;
      }
      const st = (s.status || '').toUpperCase();
      const entry = st === 'SKIPPED' || st === 'RUNNING'
        ? `${base} (non exécuté)`
        : base;
      if (!labels.includes(entry)) {
        labels.push(entry);
      }
    }
    return labels;
  }

  /** true seulement si le job GitLab a échoué ou n'a pas tourné — pas un dépassement de seuil. */
  private isGitlabJobProblem(stage: QualityGateStage): boolean {
    if (this.isSecurityValidationStageName(stage.name) && !this.securityValidationFailed) {
      return false;
    }
    const tool = this.findToolMetricForStage(stage);
    if (tool?.evaluable !== false && tool?.stageStatus === 'PASS') {
      return false;
    }
    const st = (stage.status || '').toUpperCase();
    const msg = (stage.message || '').toLowerCase();

    if (msg.includes('job échoué dans gitlab') || msg.includes('échoué sur gitlab')) {
      return true;
    }
    if (msg.includes('secret(s) détecté') || msg.includes('0 secret détecté')) {
      return false;
    }
    if (st === 'FAIL' && (
      msg.includes('critique(s)') || msg.includes('élevée(s)') || msg.includes('moyenne(s)')
      || msg.includes('blocker') || msg.includes('qg sonar') || msg.includes('seuil')
    )) {
      return false;
    }
    if (st === 'SKIPPED' || st === 'RUNNING') {
      return true;
    }
    if (st === 'FAIL' && tool?.evaluable === false) {
      return true;
    }
    const name = (stage.name || '').toLowerCase().replace(/_/g, '-');
    if (name.includes('secret') || name.includes('gitleaks')) {
      return tool?.evaluable === false;
    }
    return false;
  }

  private findToolMetricForStage(stage: QualityGateStage): QualityGateToolMetric | undefined {
    const tools = this.result?.toolMetrics ?? [];
    const stageName = (stage.name || '').toLowerCase();
    return tools.find(t =>
      (t.stageName && t.stageName.toLowerCase() === stageName)
      || (t.stageLabel && t.stageLabel === stage.toolLabel)
    );
  }

  private isSecurityValidationStageName(name?: string | null): boolean {
    if (!name) return false;
    return name.toLowerCase().replace(/_/g, '-').includes('security-validation');
  }

  /** Conditions indéterminées parce que le pipeline est incomplet (pas une panne DefectDojo/Sonar seule). */
  get showUnsuccessfulStagesWarning(): boolean {
    return this.showReliabilityBanner;
  }

  get unsuccessfulStagesWarningText(): string {
    const labels = this.failedScanJobLabels.join(', ');
    const hasRecommendation = ['RECOMMENDED', 'WITH_WARNINGS', 'NOT_RECOMMENDED']
      .includes((this.result?.verdict || '').toUpperCase());
    const verdictNote = hasRecommendation
      ? ' Le pipeline GitLab comporte des jobs en échec ou non exécutés — corrigez-les avant de vous fier à la recommandation.'
      : ' Cette recommandation ne peut pas être considérée comme fiable.';
    if (this.result?.reliabilityMessage) {
      return `Important : ${this.result.reliabilityMessage}${verdictNote}`;
    }
    return `Important : le ou les jobs GitLab suivants ne se sont pas terminés avec succès : ${labels}.${verdictNote} `
      + 'Corrigez les jobs en échec dans GitLab puis relancez le pipeline.';
  }

  /** Conditions indéterminées parce que le pipeline est incomplet (pas une panne DefectDojo/Sonar seule). */
  get pipelineRelatedIndeterminateConditions(): DeploymentCondition[] {
    return this.deploymentConditions.filter(
      c => c.status === 'indeterminate' && this.isPipelineRelatedIndeterminate(c)
    );
  }

  get showPipelineIndeterminateConditionsWarning(): boolean {
    if (this.securityValidationFailed) return true;
    return this.pipelineRelatedIndeterminateConditions.length > 0;
  }

  get pipelineIndeterminateConditionsMessage(): string {
    if (this.securityValidationFailed) {
      return 'Toutes les conditions sont indéterminées car le stage security-validation a échoué. '
        + 'Ne considérez pas cette recommandation comme valide — vérifiez les erreurs dans le pipeline GitLab.';
    }
    const labels = this.pipelineRelatedIndeterminateConditions
      .map(c => c.label)
      .join(', ');
    return `Conditions indéterminées à cause du pipeline (${labels}) : jobs non terminés, en échec ou scans non exécutés. `
      + 'Vous ne pouvez pas retenir cette recommandation comme un succès tant que ces vérifications ne sont pas complètes.';
  }

  private isPipelineRelatedIndeterminate(c: DeploymentCondition): boolean {
    if (c.status !== 'indeterminate') return false;
    if (this.securityValidationFailed || this.pipelineInProgress) return true;
    const d = (c.detail || '').toLowerCase();
    if (!d) return false;
    if (d.includes('indisponible') && d.includes('état inconnu')) {
      return false;
    }
    const pipelineHints = [
      'pipeline', 'non encore vérifiée', 'non évaluée', 'security-validation',
      'scan non exécuté', 'pas exécuté', 'en cours', 'condition non'
    ];
    return pipelineHints.some(h => d.includes(h));
  }

  get deploymentConditions(): DeploymentCondition[] {
    const pendingMsg = 'Pipeline en cours — condition non encore vérifiée';
    const failedMsg = 'Security-validation en échec — condition non évaluée';
    if (this.securityValidationFailed) {
      return [
        { id: 'secrets', label: 'Aucun secret exposé', rule: 'Gitleaks = —', status: 'indeterminate', detail: failedMsg },
        { id: 'dd_critical', label: 'Aucune vulnérabilité critique', rule: 'Centralisation vuln. · Critical = —', status: 'indeterminate', detail: failedMsg },
        { id: 'sonar_blocker', label: 'Aucune issue Blocker', rule: 'SonarQube · Blocker = —', status: 'indeterminate', detail: failedMsg },
        { id: 'sonar_qg', label: 'Quality Gate SonarQube validé', rule: 'QG ≠ ERROR', status: 'indeterminate', detail: failedMsg }
      ];
    }
    if (this.pipelineInProgress && this.result?.fromSnapshot !== false) {
      return [
        { id: 'secrets', label: 'Aucun secret exposé', rule: 'Gitleaks = 0', status: 'indeterminate', detail: pendingMsg },
        { id: 'dd_critical', label: 'Aucune vulnérabilité critique', rule: 'Centralisation vuln. · Critical = 0', status: 'indeterminate', detail: pendingMsg },
        { id: 'sonar_blocker', label: 'Aucune issue Blocker', rule: 'SonarQube · Blocker = 0', status: 'indeterminate', detail: pendingMsg },
        { id: 'sonar_qg', label: 'Quality Gate SonarQube validé', rule: 'QG ≠ ERROR', status: 'indeterminate', detail: pendingMsg }
      ];
    }

    const violations = this.result?.hardGateViolations ?? [];
    const indeterminate = this.result?.hardGateIndeterminate ?? [];

    const statusOf = (id: string): DeploymentCondition['status'] => {
      if (id === 'dd_critical') {
        if (this.pipelineCriticalCount > 0) {
          return 'violated';
        }
        if (this.usesPipelineVulnFallback()) {
          return violations.some(v => v.id === id) ? 'violated' : 'ok';
        }
      }
      if (violations.some(v => v.id === id)) return 'violated';
      if (indeterminate.some(v => v.id === id)) return 'indeterminate';
      return 'ok';
    };
    const detailOf = (id: string): string | undefined =>
      (violations.find(v => v.id === id) ?? indeterminate.find(v => v.id === id))?.message;

    const secretsCount = this.result?.metrics?.secrets ?? 0;
    const criticalCount = this.pipelineCriticalCount;
    const blockerCount = this.sonarBlockerCount;

    return [
      {
        id: 'secrets',
        label: 'Aucun secret exposé',
        rule: `Gitleaks = ${secretsCount}`,
        status: statusOf('secrets'),
        detail: detailOf('secrets')
      },
      {
        id: 'dd_critical',
        label: 'Aucune vulnérabilité critique',
        rule: this.criticalRuleLabel(),
        status: statusOf('dd_critical'),
        detail: detailOf('dd_critical')
      },
      {
        id: 'sonar_blocker',
        label: 'Aucune issue Blocker',
        rule: `SonarQube · Blocker = ${blockerCount}`,
        status: statusOf('sonar_blocker'),
        detail: detailOf('sonar_blocker')
      },
      {
        id: 'sonar_qg',
        label: 'Quality Gate SonarQube validé',
        rule: this.sonarQgStatusOk ? `QG OK (${this.sonarQgLabel})` : 'QG ≠ ERROR',
        status: statusOf('sonar_qg'),
        detail: detailOf('sonar_qg')
      }
    ];
  }

  get conditionsOkCount(): number {
    return this.deploymentConditions.filter(c => c.status === 'ok').length;
  }

  get conditionsSummaryLabel(): string {
    if (this.securityValidationFailed) {
      return 'Non évaluées — pipeline incomplet';
    }
    if (this.pipelineInProgress && this.result?.fromSnapshot !== false) {
      return 'Vérification en cours — 0/4 confirmées';
    }
    return `${this.conditionsOkCount}/4 respectées`;
  }

  conditionStateLabel(status: DeploymentCondition['status']): string {
    if (this.securityValidationFailed) {
      return 'Non évaluée';
    }
    if (this.pipelineInProgress && this.result?.fromSnapshot !== false) {
      return 'Non vérifiée';
    }
    switch (status) {
      case 'ok': return 'Respectée';
      case 'violated': return 'Violée';
      case 'indeterminate': return 'Indéterminée';
    }
  }

  get hasConfirmedViolations(): boolean {
    return (this.result?.hardGateViolations?.length ?? 0) > 0;
  }

  conditionIcon(status: DeploymentCondition['status']): string {
    switch (status) {
      case 'ok': return '✓';
      case 'violated': return '✕';
      case 'indeterminate': return '⊘';
    }
  }

  conditionClass(status: DeploymentCondition['status']): string {
    return `qg-cond--${status}`;
  }

  toggleNclocInfo(): void {
    this.nclocInfoOpen = !this.nclocInfoOpen;
  }

  nclocSourceLabel(): string {
    switch (this.result?.nclocSource) {
      case 'SONAR_LIVE': return 'SonarQube (mesure live)';
      case 'SUMMARY': return 'summary.json du pipeline';
      case 'PIPELINE_GATE': return 'rapport CI (sonar_ncloc)';
      case 'SNAPSHOT': return 'snapshot enregistré';
      default: return 'inconnue';
    }
  }

  get usesDensity(): boolean {
    return this.displayNcloc >= 100;
  }

  isCurrentGrade(grade: string): boolean {
    return (this.result?.securityScore?.grade ?? '') === grade;
  }

  get scaleMarkerLeft(): number {
    return Math.max(0, Math.min(100, this.animatedScore));
  }

  stripLeadingNumber(text: string): string {
    return (text ?? '').replace(/^\s*\d+\.\s*/, '');
  }

  private stageDedupKey(stage: QualityGateStage): string {
    const details = stage.details as Record<string, unknown> | undefined;
    const jobId = details?.['jobId'] ?? details?.['id'];
    if (jobId != null && String(jobId).trim()) {
      return String(jobId);
    }
    const name = (stage.name || '').toLowerCase();
    if (name === 'sca' || name === 'sca-trivy') return 'group:sca';
    if (name === 'secrets' || name === 'secrets-iac') return 'group:secrets';
    return name || 'unknown';
  }

  verdictClass(verdict?: string): string {
    switch (verdict) {
      case 'RECOMMENDED': return 'qg-verdict--ok';
      case 'WITH_WARNINGS': return 'qg-verdict--warn';
      case 'NOT_RECOMMENDED': return 'qg-verdict--fail';
      case 'INDETERMINE': return 'qg-verdict--indeterminate';
      default: return 'qg-verdict--unknown';
    }
  }

  verdictLabel(verdict?: string): string {
    switch (verdict) {
      case 'RECOMMENDED': return 'Déployable';
      case 'WITH_WARNINGS': return 'Déployable avec surveillance';
      case 'NOT_RECOMMENDED': return 'Déploiement non recommandé';
      case 'INDETERMINE': return 'Vérification incomplète';
      default: return 'Inconnu';
    }
  }

  verdictEmoji(verdict?: string): string {
    switch (verdict) {
      case 'RECOMMENDED': return '✓';
      case 'WITH_WARNINGS': return '⚠';
      case 'NOT_RECOMMENDED': return '✕';
      case 'INDETERMINE': return '⊘';
      default: return '○';
    }
  }

  indeterminateInfraMessage(): string {
    if (this.usesPipelineVulnFallback()) {
      return '';
    }
    const sources = (this.result?.indeterminateSources ?? [])
      .filter(s => !this.isCentralizationOnlyIndeterminate(s));
    if (this.result?.incompleteRecommendationMessage) {
      return this.result.incompleteRecommendationMessage;
    }
    if (!sources.length) {
      return 'Impossible de garantir l\'absence de vulnérabilité critique. Vérifiez les erreurs dans le pipeline GitLab, corrigez les jobs en échec puis actualisez.';
    }
    return `Recommandation incomplète — ${sources.join(', ')} indisponible(s), métriques non prises en compte. `
      + 'Vérifiez les erreurs dans le pipeline GitLab puis relancez les stages concernés.';
  }

  /** DefectDojo inaccessible mais métriques pipeline / snapshot disponibles. */
  private usesPipelineVulnFallback(): boolean {
    const r = this.result;
    if (!r || this.securityValidationFailed) {
      return false;
    }
    if (this.metricsFromSecurityValidation && r.defectDojoAvailable === false) {
      return true;
    }
    return r.defectDojoAvailable === false
      && (this.isViewingFrozenSnapshot || this.hasDisplayablePipelineDetail())
      && (r.verdict !== 'INDETERMINE'
          || this.metricsFromSecurityValidation
          || (r.hardGateViolations?.length ?? 0) > 0);
  }

  private isCentralizationOnlyIndeterminate(source: string): boolean {
    return !!source && source.toLowerCase().includes('centralisation') && this.usesPipelineVulnFallback();
  }



  stageIcon(status?: string): string {

    switch (status) {

      case 'PASS': return '✅';

      case 'WARN': return '⚠️';

      case 'FAIL': return '❌';

      case 'RUNNING': return '🔄';

      case 'SKIPPED': return '⏭️';

      default: return '○';

    }

  }

  stageDisplayLabel(stage: QualityGateStage): string {
    if (stage.status === 'WARN') return 'Warning';
    return stage.statusLabel || stage.status;
  }



  stageClass(status?: string): string {

    return `qg-stage--${(status || 'unknown').toLowerCase()}`;

  }



  sonarToolSeverityLines(tool: QualityGateToolMetric): { count: number; label: string; cssClass: string }[] {
    const sev = this.sonarMetrics?.bySeverity ?? {};
    const blocker = Number(sev['blocker'] ?? tool.critical ?? 0);
    const critical = Number(sev['critical'] ?? tool.high ?? 0);
    const major = Number(sev['major'] ?? tool.medium ?? 0);
    const minor = Number(sev['minor'] ?? tool.low ?? 0);
    const lines: { count: number; label: string; cssClass: string }[] = [];
    if (blocker > 0) {
      lines.push({ count: blocker, label: 'blocker', cssClass: 'qg-tool-sev--crit' });
    }
    if (critical > 0) {
      lines.push({ count: critical, label: 'crit.', cssClass: 'qg-tool-sev--crit' });
    }
    if (major > 0) {
      lines.push({ count: major, label: 'high', cssClass: 'qg-tool-sev--high' });
    }
    if (minor > 0) {
      lines.push({ count: minor, label: 'moy.', cssClass: 'qg-tool-sev--med' });
    }
    return lines;
  }

  hasSonarToolSeverityLines(tool: QualityGateToolMetric): boolean {
    return this.sonarToolSeverityLines(tool).length > 0;
  }

  toolStatusClass(tool: QualityGateToolMetric): string {
    const status = tool.stageStatus || this.stageForTool(tool)?.status;
    if (status) {
      if (status === 'FAIL') return 'qg-tool-card--fail';
      if (status === 'WARN') return 'qg-tool-card--warn';
      if (status === 'SKIPPED' || status === 'RUNNING') return 'qg-tool-card--skipped';
      if (status === 'PASS') return 'qg-tool-card--pass';
    }
    return 'qg-tool-card--pass';
  }

  toolStatusLabel(tool: QualityGateToolMetric): string {
    const raw = tool.stageStatus || this.stageForTool(tool)?.status;
    if (raw === 'WARN') return 'Warning';
    if (tool.stageStatus) return tool.stageStatus;
    const stage = this.stageForTool(tool);
    if (stage?.status === 'WARN') return 'Warning';
    if (stage?.statusLabel) return stage.statusLabel;
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
    return this.sonarResultsAvailable;
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
    if (stage.status === 'FAIL') return 'Seuil dépassé';
    if (stage.status === 'WARN') return 'Alerte seuil';
    return 'Seuil';
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

  /** ncloc : racine DTO → metrics → sonarQube (snapshot BDD). */
  get displayNcloc(): number {
    return this.result?.ncloc
      ?? this.result?.metrics?.ncloc
      ?? this.sonarMetrics?.ncloc
      ?? 0;
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
    return this.pipelineCriticalCount;
  }

  get highCount(): number {
    const fromSev = this.result?.metrics?.bySeverity?.['high'];
    if (fromSev != null) {
      return fromSev;
    }
    return this.severityFromTools()['high'];
  }

  get mediumCount(): number {
    const fromSev = this.result?.metrics?.bySeverity?.['medium'];
    if (fromSev != null) {
      return fromSev;
    }
    return this.severityFromTools()['medium'];
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

  breakdownImpactLabel(item: { impact: number }): string {
    if (item.impact < 0) return String(item.impact);
    return '';
  }



  private normalizeEvaluatedAt(raw: unknown): string | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'string') return raw;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      const ms = raw > 1e12 ? raw : raw * 1000;
      return new Date(ms).toISOString();
    }
    return null;
  }

  private normalizeResult(res: QualityGateResult): QualityGateResult {

    return {

      ...res,

      evaluatedAt: this.normalizeEvaluatedAt(res.evaluatedAt) ?? res.evaluatedAt ?? null,

      hardGateViolations: res.hardGateViolations ?? [],

      hardGateIndeterminate: res.hardGateIndeterminate ?? [],

      indeterminateSources: res.indeterminateSources ?? [],

      stages: res.stages ?? [],

      toolMetrics: res.toolMetrics ?? [],

      softwareQuality: res.softwareQuality ?? [],

      detailedRecommendations: res.detailedRecommendations ?? [],

      practicalAdvice: res.practicalAdvice ?? res.detailedRecommendations ?? [],

      verdictExplanation: res.verdictExplanation ?? [],

      recommendationReliable: res.recommendationReliable ?? res.metrics?.recommendationReliable,

      reliabilityMessage: res.reliabilityMessage ?? null,

      failedScanJobs: res.failedScanJobs ?? res.metrics?.failedScanJobs ?? [],

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

        return this.qualityGateService.getQualityGate(
          this.appId, this.selectedBranch, this.selectedEnvironmentId, false
        ).pipe(

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


