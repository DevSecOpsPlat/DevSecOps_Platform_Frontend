import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';

import { Router } from '@angular/router';
import {
  QualityGateEnvironmentOption,
  QualityGateResult,
  QualityGateService,
  QualityGateToolMetric
} from '../../services/quality-gate/quality-gate.service';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { AppDeployment } from '../../models/application-management/application-management.models';
import { DefectDojoFindingItem, DefectDojoService } from '../../services/defectdojo/defectdojo.service';
import { PageHeroComponent } from '../shared/page-hero/page-hero.component';

interface SmokeTestState {
  allOk: boolean;
  checkedAt?: string;
  results: Record<string, { ok: boolean; statusCode?: number | null; message?: string; probedUrl?: string }>;
}

/** Les 5 états visuels partagés par les deux cartes outil (ZAP, smoke test) — voir §5 du chantier
 *  "Post-déploiement v2". "obsolete" est volontairement absent d'ici : ce n'est pas un état
 *  exclusif, c'est un indicateur orthogonal (voir `stale` séparé) qui peut se combiner avec
 *  'ok' / 'findings' / 'running'. */
type ToolStatus = 'never' | 'running' | 'ok' | 'findings' | 'failed';

interface ToolCardState {
  status: ToolStatus;
  stale: boolean;
  staleSince?: string | null;
}

/**
 * Page "Post-déploiement" (par service) — regroupe les signaux qui n'existent QU'APRÈS un
 * déploiement réel (DAST/ZAP, smoke test), scopés à un environnement précis. Le scan container
 * (Grype) a été retiré de cette page (chantier "Post-déploiement v2", Objectif 1) : Grype tourne
 * structurellement aussi bien en scan-only qu'en déploiement (grype-image-scan, .gitlab-ci.yml,
 * extends: .scan-rules) — ce n'est donc pas un signal post-déploiement par nature, contrairement
 * à ZAP (attaque une URL live) et au smoke test (ping des pods vivants). Les résultats Grype
 * restent consultables via la page Quality Gate "par service" existante, pas dupliqués ici.
 *
 * La relance DAST à la demande (ACTION=dast-only) a été retirée après coup : une relance sans
 * redéploiement n'a pas de valeur réelle -- un résultat ZAP ne change que si le code change, ce
 * qui exige de toute façon un redéploiement complet (qui relance deploy:zap-dast normalement).
 * Seul le smoke test garde un bouton de relance (coût quasi nul, pas de rebuild nécessaire).
 *
 * Volontairement séparée de la Quality Gate service : DAST ne peut jamais être un vrai gate
 * pré-déploiement (son résultat n'existe qu'après coup), donc pas de score/verdict ici,
 * uniquement de l'information.
 */
@Component({
  selector: 'app-post-deploy',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeroComponent],
  templateUrl: './post-deploy.component.html',
  // app-management.shared.css / security-list.styles.css : classes utilitaires (am-btn/am-alert,
  // vuln-detail-btn, severity-*) à encapsulation Angular scopée par composant -- il faut les
  // réimporter explicitement ici pour qu'elles s'appliquent, même si elles semblent "globales" en
  // les voyant déjà réutilisées ailleurs (ex. security-dashboard.component).
  styleUrls: [
    '../../application-management/shared/app-management.shared.css',
    '../shared/security-list.styles.css',
    './post-deploy.component.css'
  ]
})
export class PostDeployComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  serviceId: string | null = null;
  managedAppId: string | null = null;

  branches: string[] = [];
  selectedBranch = 'main';

  environments: QualityGateEnvironmentOption[] = [];
  selectedEnvironmentId: string | null = null;

  result: QualityGateResult | null = null;
  deployment: AppDeployment | null = null;

  loading = false;
  error: string | null = null;

  /** Déclenchement initial de scan sur un environnement totalement vide (page-level, pas une carte outil). */
  rebuilding = false;
  rebuildMessage: string | null = null;
  rebuildError: string | null = null;

  /** Relance manuelle smoke test (§Objectif 3) — pas de restriction, pas de cooldown. */
  smokeTestRerunning = false;
  smokeTestRerunError: string | null = null;

  /** Findings détaillés ZAP, scopés au pipeline de l'environnement sélectionné. */
  readonly severities = ['Critical', 'High', 'Medium', 'Low', 'Info'];
  findingsSeverity = '';
  zapFindings: DefectDojoFindingItem[] = [];
  zapFindingsTotal = 0;
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
    // Même convention que quality-gate.component.ts : le segment de route ':appId' porte en
    // réalité l'AppService id dans le contexte service (/project/:appId/...).
    this.route.parent?.paramMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      this.serviceId = params.get('appId');
      if (!this.serviceId) return;
      this.loadDeployContext();
      this.loadBranches();
      this.loadEnvironments(true);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadDeployContext(): void {
    if (!this.serviceId) return;
    this.appMgmt.getDeployContext(this.serviceId).pipe(
      takeUntil(this.destroy$),
      catchError(() => of(null))
    ).subscribe(ctx => {
      this.managedAppId = ctx?.managedApplicationId || null;
    });
  }

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
    // scanOnly=false (défaut) -- on veut les environnements DEPLOY, pas les pipelines scan.
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
    });
    this.loadDeploymentForSelectedEnvironment();
    this.loadFindings();
  }

  /**
   * Findings détaillés (titres, pas seulement des compteurs) pour l'environnement sélectionné.
   * Résout d'abord le testId exact de ZAP pour ce pipeline, puis interroge
   * GET /api/defectdojo/findings scopé à ce testId.
   */
  loadFindings(): void {
    this.zapFindings = [];
    this.zapFindingsTotal = 0;
    const pipelineId = this.selectedEnvironment?.pipelineId;
    if (!this.serviceId || !pipelineId) {
      return;
    }
    this.findingsLoading = true;
    this.findingsError = null;
    this.defectDojoService.getTestsForPipeline(this.serviceId, this.selectedBranch, pipelineId).pipe(
      takeUntil(this.destroy$),
      catchError(err => {
        this.findingsError = err?.error?.message || 'Impossible de résoudre le scan DefectDojo.';
        return of([] as Array<{ testId: number; scanType: string }>);
      })
    ).subscribe(tests => {
      const zapTest = tests.find(t => PostDeployComponent.isZapScanType(t.scanType));
      if (!zapTest) {
        this.findingsLoading = false;
        return;
      }
      this.defectDojoService.getFindings(
        this.serviceId!, this.selectedBranch, 'open', 0, 100,
        this.findingsSeverity || undefined, undefined, undefined, undefined, zapTest.testId
      ).pipe(
        takeUntil(this.destroy$),
        catchError(() => of(null))
      ).subscribe(page => {
        this.zapFindings = page?.content || [];
        this.zapFindingsTotal = page?.totalElements ?? this.zapFindings.length;
        this.findingsLoading = false;
      });
    });
  }

  onFindingsSeverityChange(): void {
    this.loadFindings();
  }

  private static isZapScanType(scanType: string | undefined): boolean {
    const s = (scanType || '').toLowerCase();
    return s.includes('zap') || s.includes('dast');
  }

  /** Échelle de sévérité partagée avec security-dashboard/managed-security-dashboard
   *  (security-list.styles.css, .severity-critical/high/medium/low/info) -- pas de nouvelle
   *  teinte propre à cette page (deux échelles différentes sur deux pages serait incohérent). */
  severityBadgeClass(severity: string | undefined): string {
    return 'severity-' + (severity || 'info').toLowerCase();
  }

  openFinding(findingId: number): void {
    if (!this.serviceId || findingId == null) return;
    this.router.navigate(['/project', this.serviceId, 'security-dashboard', 'finding', String(findingId)]);
  }

  /** Smoke test vit sur AppDeployment.servicesState, pas sur la Quality Gate -- même lecture que
   *  pipeline-details.component.ts (deployResult, trouvé par gitlabPipelineId). */
  private loadDeploymentForSelectedEnvironment(): void {
    const pipelineId = this.selectedEnvironment?.pipelineId;
    if (!this.managedAppId || !pipelineId) {
      this.deployment = null;
      return;
    }
    const pid = Number(pipelineId);
    this.appMgmt.listDeployments(this.managedAppId).pipe(
      takeUntil(this.destroy$),
      catchError(() => of([] as AppDeployment[]))
    ).subscribe(list => {
      this.deployment = (list || []).find(d => d.gitlabPipelineId === pid) || null;
    });
  }

  refresh(): void {
    this.load();
  }

  get zapTool(): QualityGateToolMetric | null {
    return this.result?.toolMetrics?.find(t => t.id === 'zap') || null;
  }

  get dastApplicable(): boolean {
    return !!this.result?.metrics?.dastApplicable;
  }

  get dastEvaluable(): boolean {
    return !!this.result?.metrics?.dastEvaluable;
  }

  get smokeTest(): SmokeTestState | null {
    return (this.deployment?.servicesState?.smokeTest as SmokeTestState) || null;
  }

  get smokeTestEntries(): Array<{ name: string; ok: boolean; statusCode?: number | null; message?: string; probedUrl?: string }> {
    const results = this.smokeTest?.results || {};
    return Object.entries(results).map(([name, r]) => ({ name, ...r }));
  }

  /** Aucun des 2 signaux n'a de donnée pour cet environnement -- environnement jamais scanné. */
  get isEmpty(): boolean {
    return !this.loading && !this.zapTool && !this.dastApplicable && !this.smokeTest;
  }

  canRebuild(): boolean {
    return !!this.managedAppId && !!this.serviceId && !this.rebuilding;
  }

  /** Déclenchement initial (page vide) : seul un build+déploiement complet peut produire un premier résultat. */
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

  /** État 2 (carte smoke test) : coût quasi nul, sans restriction -- corrige le bug historique
   *  qui n'enregistrait que le tout premier résultat (hasSmokeTestResult() côté backend, pensé
   *  pour le poll CI automatique, jamais pour un déclenchement manuel explicite). */
  rerunSmokeTest(): void {
    if (!this.managedAppId || !this.serviceId || this.smokeTestRerunning) return;
    this.smokeTestRerunning = true;
    this.smokeTestRerunError = null;
    this.appMgmt.rerunSmokeTest(this.managedAppId, this.serviceId).pipe(
      takeUntil(this.destroy$),
      catchError(err => {
        this.smokeTestRerunError = err?.error?.message || 'Échec du smoke test.';
        return of(null);
      })
    ).subscribe(smoke => {
      this.smokeTestRerunning = false;
      if (smoke && this.deployment) {
        // Rafraîchit l'état local immédiatement (pas besoin d'un rechargement complet de la
        // page pour voir le nouveau résultat -- la relance ELLE-MÊME vient de le produire).
        this.deployment = {
          ...this.deployment,
          servicesState: { ...(this.deployment.servicesState || {}), smokeTest: smoke }
        };
      }
    });
  }

  // ── Objectif 5 : matrice d'états ────────────────────────────────────────────────────────────

  /** Un résultat existe mais date d'avant le déploiement actuellement actif (état 6, "obsolète"). */
  private isStale(resultTimestamp: string | null | undefined): boolean {
    const deployedAt = this.deployment?.deployedAt;
    if (!resultTimestamp || !deployedAt) return false;
    const resultMs = Date.parse(resultTimestamp);
    const deployedMs = Date.parse(deployedAt);
    if (Number.isNaN(resultMs) || Number.isNaN(deployedMs)) return false;
    return resultMs < deployedMs;
  }

  get zapCardState(): ToolCardState {
    if (!this.dastEvaluable) {
      return { status: 'running', stale: false };
    }
    const tool = this.zapTool;
    if (!tool) {
      // Évaluable côté pipeline mais aucun détail outil -- import DefectDojo probablement en
      // échec (état 5, jamais confondu silencieusement avec "0 finding", §Objectif 5 point 3).
      return { status: 'failed', stale: false };
    }
    const total = (tool.critical || 0) + (tool.high || 0) + (tool.medium || 0) + (tool.low || 0);
    return {
      status: total === 0 ? 'ok' : 'findings',
      stale: this.isStale(this.result?.evaluatedAt),
      staleSince: this.result?.evaluatedAt
    };
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
}
