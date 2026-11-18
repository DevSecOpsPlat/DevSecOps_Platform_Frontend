import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';

import {
  QualityGateEnvironmentOption,
  QualityGateResult,
  QualityGateService,
  QualityGateToolMetric
} from '../../services/quality-gate/quality-gate.service';
import {
  ApplicationManagementService,
  PostDeploySummary
} from '../../services/application-management/application-management.service';
import { AppDeployment } from '../../models/application-management/application-management.models';
import {
  DefectDojoFindingItem,
  DefectDojoFindingsPage,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';
import { PageHeroComponent } from '../shared/page-hero/page-hero.component';

interface SmokeTestState {
  allOk: boolean;
  checkedAt?: string;
  results: Record<string, { ok: boolean; statusCode?: number | null; message?: string; probedUrl?: string }>;
}

/** États visuels des deux cartes (ZAP, smoke test). « Obsolète » est un indicateur à part. */
type ToolStatus = 'never' | 'running' | 'ok' | 'findings' | 'failed';

interface ToolCardState {
  status: ToolStatus;
  stale: boolean;
  staleSince?: string | null;
}

type SeverityKey = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';

interface DastCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
  /** true = comptés sur les findings ZAP réels (Info compris) ; false = résumé du pipeline. */
  fromFindings: boolean;
}

/** Au-delà, la liste est tronquée (5 pages de 100). */
const MAX_FINDING_PAGES = 5;

/**
 * Page « Post-déploiement » : signaux qui n'existent qu'après un déploiement réel (DAST/ZAP,
 * smoke test). Utilisée à deux niveaux :
 *  - SERVICE (/project/:id/post-deploy) : résultats du déploiement de l'application dont le
 *    service fait partie (ZAP analyse l'adresse publique de toute l'application), son propre
 *    smoke test en premier ;
 *  - APPLICATION (onglet Post-déploiement de l'application, via [appScopeId]) : même vue, tous
 *    les services au même niveau.
 * Un service autonome (hors application gérée) garde l'ancien flux par environnement.
 *
 * Les compteurs du DAST viennent des findings ZAP réels (Critique → Info), pour correspondre à la
 * table affichée en dessous ; le résumé du pipeline ne sert qu'en l'absence de findings lisibles.
 */
@Component({
  selector: 'app-post-deploy',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeroComponent],
  templateUrl: './post-deploy.component.html',
  styleUrls: [
    '../../application-management/shared/app-management.shared.css',
    '../shared/security-list.styles.css',
    './post-deploy.component.css'
  ]
})
export class PostDeployComponent implements OnInit, OnDestroy {
  /** Page « application » : id de l'application gérée (aucun service sélectionné). */
  @Input() appScopeId: string | null = null;
  @Input() appScopeName: string | null = null;

  private readonly destroy$ = new Subject<void>();

  serviceId: string | null = null;
  managedAppId: string | null = null;

  /** true = service ou application gérée : données par déploiement de l'application. */
  managedMode = false;
  summary: PostDeploySummary | null = null;
  selectedDeploymentId: string | null = null;
  currentServiceName: string | null = null;

  // Service autonome (ancien flux)
  branches: string[] = [];
  selectedBranch = 'main';
  environments: QualityGateEnvironmentOption[] = [];
  selectedEnvironmentId: string | null = null;
  result: QualityGateResult | null = null;
  deployment: AppDeployment | null = null;

  loading = false;
  error: string | null = null;

  rebuilding = false;
  rebuildMessage: string | null = null;
  rebuildError: string | null = null;

  smokeTestRerunning = false;
  smokeTestRerunError: string | null = null;

  readonly severityRows: Array<{ key: SeverityKey; label: string; cls: string }> = [
    { key: 'Critical', label: 'Critique', cls: 'critical' },
    { key: 'High', label: 'Élevée', cls: 'high' },
    { key: 'Medium', label: 'Moyenne', cls: 'medium' },
    { key: 'Low', label: 'Faible', cls: 'low' },
    { key: 'Info', label: 'Info', cls: 'info' }
  ];
  severityFilter: SeverityKey | '' = '';
  zapFindings: DefectDojoFindingItem[] = [];
  zapFindingsTotal = 0;
  findingsLoaded = false;
  findingsLoading = false;
  findingsError: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private qualityGateService: QualityGateService,
    private appMgmt: ApplicationManagementService,
    private defectDojoService: DefectDojoService
  ) {}

  ngOnInit(): void {
    if (this.appScopeId) {
      this.managedAppId = this.appScopeId;
      this.managedMode = true;
      this.loadSummary();
      return;
    }
    // ':appId' porte l'AppService id dans le contexte service (/project/:appId/...).
    this.route.parent?.paramMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.serviceId = params.get('appId');
      if (!this.serviceId) return;
      this.loading = true;
      this.loadDeployContext();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get appScope(): boolean {
    return !!this.appScopeId;
  }

  private loadDeployContext(): void {
    if (!this.serviceId) return;
    this.appMgmt.getDeployContext(this.serviceId).pipe(
      takeUntil(this.destroy$),
      catchError(() => of(null))
    ).subscribe(ctx => {
      this.managedAppId = ctx?.managedApplicationId || null;
      this.managedMode = !!this.managedAppId;
      if (this.managedMode) {
        this.loadSummary();
      } else {
        this.loadBranches();
        this.loadEnvironments(true);
      }
    });
  }

  // ── Application gérée ───────────────────────────────────────────────────────────────────────

  loadSummary(): void {
    if (!this.managedAppId) return;
    this.loading = true;
    this.error = null;
    this.rebuildMessage = null;
    this.appMgmt.getPostDeploySummary(this.managedAppId, this.selectedDeploymentId).pipe(
      takeUntil(this.destroy$),
      catchError(err => {
        this.error = err?.error?.message || 'Impossible de charger le résultat post-déploiement.';
        return of(null);
      })
    ).subscribe(summary => {
      this.summary = summary;
      this.selectedDeploymentId = summary?.deploymentId ?? null;
      this.currentServiceName = this.serviceId
        ? (summary?.services?.find(s => s.id === this.serviceId)?.name ?? null)
        : null;
      this.loading = false;
      this.loadFindings();
    });
  }

  onDeploymentChange(): void {
    this.loadSummary();
  }

  deploymentStatusLabel(status: string | undefined | null): string {
    switch ((status || '').toUpperCase()) {
      case 'RUNNING': return 'En ligne';
      case 'DEPLOYING': return 'En déploiement';
      case 'PENDING': return 'En attente';
      case 'FAILED': return 'Échec';
      case 'STOPPED': return 'Arrêté';
      default: return status || '—';
    }
  }

  get deploymentTone(): 'ok' | 'warn' | 'bad' | 'off' {
    switch ((this.summary?.status || '').toUpperCase()) {
      case 'RUNNING': return 'ok';
      case 'DEPLOYING':
      case 'PENDING': return 'warn';
      case 'FAILED': return 'bad';
      default: return 'off';
    }
  }

  // ── Service autonome (ancien flux) ──────────────────────────────────────────────────────────

  loadBranches(): void {
    if (!this.serviceId) return;
    this.qualityGateService.listBranches(this.serviceId).pipe(
      takeUntil(this.destroy$),
      catchError(() => of([] as string[]))
    ).subscribe(branches => {
      this.branches = branches.length ? branches : ['main', 'master'];
      if (!this.branches.includes(this.selectedBranch)) {
        this.selectedBranch = this.branches[0];
      }
    });
  }

  loadEnvironments(andThenLoad = false): void {
    if (!this.serviceId) return;
    this.qualityGateService.listEnvironments(this.serviceId, this.selectedBranch, false).pipe(
      takeUntil(this.destroy$),
      catchError(() => of([] as QualityGateEnvironmentOption[]))
    ).subscribe(envs => {
      this.environments = envs;
      if (this.selectedEnvironmentId && !envs.some(e => e.environmentId === this.selectedEnvironmentId)) {
        this.selectedEnvironmentId = null;
      }
      if (!this.selectedEnvironmentId && envs.length) {
        this.selectedEnvironmentId = envs[0].environmentId ?? null;
      }
      if (andThenLoad) {
        if (this.selectedEnvironmentId) {
          this.load();
        } else {
          this.loading = false;
          this.result = null;
          this.deployment = null;
        }
      }
    });
  }

  onBranchChange(): void {
    this.selectedEnvironmentId = null;
    this.result = null;
    this.deployment = null;
    this.loadEnvironments(true);
  }

  onEnvironmentChange(): void {
    this.load();
  }

  private get selectedEnvironment(): QualityGateEnvironmentOption | null {
    return this.environments.find(e => e.environmentId === this.selectedEnvironmentId) || null;
  }

  load(): void {
    if (!this.serviceId || !this.selectedEnvironmentId) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.error = null;
    this.rebuildMessage = null;
    this.qualityGateService.getQualityGate(
      this.serviceId, this.selectedBranch, this.selectedEnvironmentId, false, null
    ).pipe(
      takeUntil(this.destroy$),
      catchError(err => {
        this.error = err?.error?.message || err?.error?.detail || 'Impossible de charger le résultat post-déploiement.';
        return of(null);
      })
    ).subscribe(res => {
      this.result = res;
      this.loading = false;
      this.loadFindings();
    });
  }

  // ── Commun ──────────────────────────────────────────────────────────────────────────────────

  refresh(): void {
    if (this.managedMode) {
      this.loadSummary();
    } else {
      this.load();
    }
  }

  get hasData(): boolean {
    return this.managedMode ? !!this.summary : !!this.result;
  }

  get hasDeployment(): boolean {
    return this.managedMode ? !!this.summary?.deploymentId : this.environments.length > 0;
  }

  /** État DAST brut du mode application (inclut 'unavailable'). */
  get dastState(): string | null {
    return this.managedMode ? (this.summary?.dast?.state ?? 'never') : null;
  }

  get dastPipelineId(): number | string | null {
    return this.managedMode
      ? (this.summary?.dast?.pipelineId ?? null)
      : (this.selectedEnvironment?.pipelineId ?? null);
  }

  get dastEvaluatedAt(): string | null {
    return this.managedMode ? (this.summary?.dast?.evaluatedAt ?? null) : (this.result?.evaluatedAt ?? null);
  }

  private get zapTool(): QualityGateToolMetric | null {
    return this.result?.toolMetrics?.find(t => t.id === 'zap') || null;
  }

  /** Compteurs DAST : findings ZAP réels quand ils sont chargés (Info compris), sinon résumé du pipeline. */
  get dastCounts(): DastCounts {
    if (this.findingsLoaded && this.zapFindings.length) {
      const by = (k: SeverityKey) => this.zapFindings.filter(f => this.normSeverity(f.severity) === k).length;
      const c = { critical: by('Critical'), high: by('High'), medium: by('Medium'), low: by('Low'), info: by('Info') };
      return { ...c, total: c.critical + c.high + c.medium + c.low + c.info, fromFindings: true };
    }
    const d = this.managedMode ? this.summary?.dast : null;
    const t = this.zapTool;
    const c = {
      critical: (d ? d.critical : t?.critical) || 0,
      high: (d ? d.high : t?.high) || 0,
      medium: (d ? d.medium : t?.medium) || 0,
      low: (d ? d.low : t?.low) || 0,
      info: 0
    };
    return { ...c, total: c.critical + c.high + c.medium + c.low, fromFindings: false };
  }

  countOf(key: SeverityKey): number {
    const c = this.dastCounts;
    switch (key) {
      case 'Critical': return c.critical;
      case 'High': return c.high;
      case 'Medium': return c.medium;
      case 'Low': return c.low;
      default: return c.info;
    }
  }

  get vulnerabilityCount(): number {
    const c = this.dastCounts;
    return c.critical + c.high + c.medium + c.low;
  }

  private normSeverity(s: string | undefined): SeverityKey {
    const v = (s || '').toLowerCase();
    if (v.startsWith('crit')) return 'Critical';
    if (v.startsWith('high')) return 'High';
    if (v.startsWith('med')) return 'Medium';
    if (v.startsWith('low')) return 'Low';
    return 'Info';
  }

  get dastApplicable(): boolean {
    return !!this.result?.metrics?.dastApplicable;
  }

  get dastEvaluable(): boolean {
    return !!this.result?.metrics?.dastEvaluable;
  }

  get smokeTest(): SmokeTestState | null {
    if (this.managedMode) {
      return (this.summary?.smokeTest as SmokeTestState) || null;
    }
    return (this.deployment?.servicesState?.['smokeTest'] as SmokeTestState) || null;
  }

  /** Ce service en premier. */
  get smokeTestEntries(): Array<{ name: string; ok: boolean; statusCode?: number | null; message?: string; probedUrl?: string }> {
    const results = this.smokeTest?.results || {};
    const rows = Object.entries(results).map(([name, r]) => ({ name, ...r }));
    return rows.sort((a, b) => (a.name === this.currentServiceName ? -1 : b.name === this.currentServiceName ? 1 : 0));
  }

  serviceIdByName(name: string): string | null {
    return this.summary?.services?.find(s => s.name === name)?.id ?? null;
  }

  /** Aucun résultat (DAST ni smoke test) pour le déploiement sélectionné. */
  get isEmpty(): boolean {
    if (this.loading) return false;
    if (this.managedMode) {
      return this.dastState === 'never' && !this.smokeTest;
    }
    return !this.zapTool && !this.dastApplicable && !this.smokeTest;
  }

  get showFindings(): boolean {
    return this.zapCardState.status === 'ok' || this.zapCardState.status === 'findings';
  }

  canRebuild(): boolean {
    return !this.appScope && !!this.managedAppId && !!this.serviceId && !this.rebuilding;
  }

  triggerScan(): void {
    if (!this.managedAppId || !this.serviceId) return;
    if (!confirm('Relancer un build + déploiement de ce service (même namespace) ? Ça relance aussi le scan ZAP sur l\'URL live. Les autres services ne seront pas reconstruits.')) {
      return;
    }
    this.rebuilding = true;
    this.rebuildError = null;
    this.rebuildMessage = null;
    this.appMgmt.rebuildService(this.managedAppId, this.serviceId).pipe(
      takeUntil(this.destroy$),
      catchError(err => {
        this.rebuildError = err?.error?.message || 'Échec du déclenchement.';
        return of(null);
      })
    ).subscribe(() => {
      this.rebuilding = false;
      if (!this.rebuildError) {
        this.rebuildMessage = 'Scan lancé — le résultat apparaîtra ici une fois le pipeline terminé (bouton Actualiser).';
      }
    });
  }

  /** Le smoke test sonde tous les services du déploiement ; en vue application, via le premier service. */
  private get smokeServiceId(): string | null {
    return this.serviceId ?? this.summary?.services?.[0]?.id ?? null;
  }

  rerunSmokeTest(): void {
    const serviceId = this.smokeServiceId;
    if (!this.managedAppId || !serviceId || this.smokeTestRerunning) return;
    this.smokeTestRerunning = true;
    this.smokeTestRerunError = null;
    this.appMgmt.rerunSmokeTest(this.managedAppId, serviceId).pipe(
      takeUntil(this.destroy$),
      catchError(err => {
        this.smokeTestRerunError = err?.error?.message || 'Échec du smoke test.';
        return of(null);
      })
    ).subscribe(smoke => {
      this.smokeTestRerunning = false;
      if (!smoke) return;
      if (this.managedMode && this.summary) {
        this.summary = { ...this.summary, smokeTest: smoke as PostDeploySummary['smokeTest'] };
      } else if (this.deployment) {
        this.deployment = {
          ...this.deployment,
          servicesState: { ...(this.deployment.servicesState || {}), smokeTest: smoke }
        };
      }
    });
  }

  openPipelineDetail(): void {
    const pid = this.dastPipelineId;
    if (!pid) return;
    if (this.managedMode && this.managedAppId) {
      this.router.navigate(['/projects', this.managedAppId, 'pipeline-detail', String(pid)], { queryParams: { kind: 'DEPLOY' } });
    } else if (this.serviceId) {
      this.router.navigate(['/project', this.serviceId, 'pipeline-detail', String(pid)], { queryParams: { kind: 'DEPLOY' } });
    }
  }

  openServicePostDeploy(serviceName: string): void {
    const id = this.serviceIdByName(serviceName);
    if (!id) return;
    // Le hub service retrouve l'application d'origine (barre latérale, retour).
    try {
      if (this.managedAppId) localStorage.setItem('envirotest-last-managed-app-id', this.managedAppId);
      if (this.appScopeName) localStorage.setItem('envirotest-last-managed-app-name', this.appScopeName);
    } catch { /* stockage indisponible */ }
    this.router.navigate(['/project', id, 'post-deploy']);
  }

  // ── Findings ZAP ────────────────────────────────────────────────────────────────────────────

  /** Service sous lequel les findings ZAP ont été importés dans DefectDojo. */
  private get findingsServiceId(): string | null {
    return this.managedMode ? (this.summary?.dast?.findingsServiceId ?? null) : this.serviceId;
  }

  private get findingsBranch(): string {
    return this.managedMode ? (this.summary?.dast?.branch || 'main') : this.selectedBranch;
  }

  get visibleFindings(): DefectDojoFindingItem[] {
    if (!this.severityFilter) return this.zapFindings;
    return this.zapFindings.filter(f => this.normSeverity(f.severity) === this.severityFilter);
  }

  setSeverityFilter(key: SeverityKey | ''): void {
    this.severityFilter = this.severityFilter === key ? '' : key;
  }

  loadFindings(): void {
    this.zapFindings = [];
    this.zapFindingsTotal = 0;
    this.findingsLoaded = false;
    this.findingsError = null;
    this.severityFilter = '';
    const serviceId = this.findingsServiceId;
    const pipelineId = this.dastPipelineId;
    const hasResult = this.managedMode
      ? (this.dastState === 'ok' || this.dastState === 'findings')
      : this.dastEvaluable;
    if (!serviceId || !pipelineId || !hasResult) {
      return;
    }
    this.findingsLoading = true;
    this.defectDojoService.getTestsForPipeline(serviceId, this.findingsBranch, String(pipelineId)).pipe(
      takeUntil(this.destroy$),
      catchError(err => {
        this.findingsError = err?.error?.message || 'Impossible de retrouver le scan ZAP dans DefectDojo.';
        return of([] as Array<{ testId: number; scanType: string }>);
      })
    ).subscribe(tests => {
      const zapTest = tests.find(t => PostDeployComponent.isZapScanType(t.scanType));
      if (!zapTest) {
        this.findingsLoading = false;
        this.findingsLoaded = true;
        return;
      }
      this.loadFindingPages(serviceId, zapTest.testId, 0);
    });
  }

  /** Toutes les pages (100 par page, plafond backend) pour compter et filtrer sans rechargement. */
  private loadFindingPages(serviceId: string, testId: number, page: number): void {
    const req: Observable<DefectDojoFindingsPage | null> = this.defectDojoService.getFindings(
      serviceId, this.findingsBranch, 'open', page, 100, undefined, undefined, undefined, undefined, testId
    ).pipe(takeUntil(this.destroy$), catchError(() => of(null)));
    req.subscribe(res => {
      const items = res?.content || [];
      this.zapFindings = [...this.zapFindings, ...items];
      this.zapFindingsTotal = res?.totalElements ?? this.zapFindings.length;
      const more = this.zapFindings.length < this.zapFindingsTotal && items.length > 0 && page + 1 < MAX_FINDING_PAGES;
      if (more) {
        this.loadFindingPages(serviceId, testId, page + 1);
      } else {
        this.findingsLoading = false;
        this.findingsLoaded = true;
      }
    });
  }

  private static isZapScanType(scanType: string | undefined): boolean {
    const s = (scanType || '').toLowerCase();
    return s.includes('zap') || s.includes('dast');
  }

  severityClass(severity: string | undefined): string {
    return this.severityRows.find(r => r.key === this.normSeverity(severity))?.cls || 'info';
  }

  severityLabel(severity: string | undefined): string {
    return this.severityRows.find(r => r.key === this.normSeverity(severity))?.label || 'Info';
  }

  cweLabel(cwe: string | undefined | null): string {
    const v = (cwe || '').trim();
    if (!v || v === '0') return '—';
    return /^\d+$/.test(v) ? `CWE-${v}` : v;
  }

  openFinding(findingId: number): void {
    const serviceId = this.findingsServiceId;
    if (!serviceId || findingId == null) return;
    this.router.navigate(['/project', serviceId, 'security-dashboard', 'finding', String(findingId)]);
  }

  // ── États des cartes ────────────────────────────────────────────────────────────────────────

  private get deployedAt(): string | null | undefined {
    return this.managedMode ? this.summary?.deployedAt : this.deployment?.deployedAt;
  }

  private isStale(resultTimestamp: string | null | undefined): boolean {
    const deployedAt = this.deployedAt;
    if (!resultTimestamp || !deployedAt) return false;
    const resultMs = Date.parse(resultTimestamp);
    const deployedMs = Date.parse(deployedAt);
    if (Number.isNaN(resultMs) || Number.isNaN(deployedMs)) return false;
    return resultMs < deployedMs;
  }

  get zapCardState(): ToolCardState {
    if (this.managedMode) {
      const d = this.summary?.dast;
      const state = d?.state ?? 'never';
      const withResult = state === 'ok' || state === 'findings';
      let status: ToolStatus = state === 'unavailable' ? 'failed' : (state as ToolStatus);
      if (withResult && this.dastCounts.fromFindings) {
        status = this.vulnerabilityCount ? 'findings' : 'ok';
      }
      return { status, stale: withResult && this.isStale(d?.evaluatedAt), staleSince: d?.evaluatedAt ?? null };
    }
    if (!this.dastApplicable) {
      return { status: 'never', stale: false };
    }
    if (!this.dastEvaluable) {
      return { status: this.result?.pipelineFinished === false ? 'running' : 'failed', stale: false };
    }
    if (!this.zapTool) {
      return { status: 'failed', stale: false };
    }
    return {
      status: this.vulnerabilityCount === 0 ? 'ok' : 'findings',
      stale: this.isStale(this.result?.evaluatedAt),
      staleSince: this.result?.evaluatedAt
    };
  }

  get zapStatusLabel(): string {
    switch (this.zapCardState.status) {
      case 'never': return 'Pas encore analysé';
      case 'running': return 'Analyse en cours';
      case 'ok': return this.dastCounts.info ? 'Aucune vulnérabilité' : 'Aucune alerte';
      case 'findings': return `${this.vulnerabilityCount} vulnérabilité${this.vulnerabilityCount > 1 ? 's' : ''}`;
      default: return this.dastState === 'unavailable' ? 'Résultat non reçu' : 'Échec';
    }
  }

  get smokeCardState(): ToolCardState {
    if (this.smokeTestRerunning) {
      return { status: 'running', stale: this.isStale(this.smokeTest?.checkedAt) };
    }
    if (!this.smokeTest) {
      return { status: 'never', stale: false };
    }
    return {
      status: this.smokeTest.allOk ? 'ok' : 'failed',
      stale: this.isStale(this.smokeTest.checkedAt),
      staleSince: this.smokeTest.checkedAt
    };
  }

  get smokeStatusLabel(): string {
    switch (this.smokeCardState.status) {
      case 'never': return 'Pas encore testé';
      case 'running': return 'Test en cours';
      case 'ok': return 'Tous disponibles';
      default: {
        const bad = this.smokeTestEntries.filter(e => !e.ok).length;
        return `${bad} service${bad > 1 ? 's' : ''} en échec`;
      }
    }
  }
}
