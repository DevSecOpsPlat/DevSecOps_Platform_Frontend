import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, Subject, of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, take, takeUntil } from 'rxjs/operators';
import { EnvironmentService } from '../../services/environment/environment.service';
import {
  FindingsService,
  FindingItem,
  FindingsStatsResponse,
  FindingsTrendsResponse,
  FindingsTrendsByApplicationResponse,
  PageResponse
} from '../../services/findings/findings.service';
import { UserService } from 'src/app/services/user/user.service';
import { PipelineService } from 'src/app/services/pipeline/pipeline.service';
import { PipelineScanResponse } from 'src/app/models/pipeline/pipeline-scan-response';

@Component({
  selector: 'app-vulnerabilities-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vulnerabilities-dashboard.component.html',
  styleUrls: ['./vulnerabilities-dashboard.component.css']
})
export class VulnerabilitiesDashboardComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  appId: string | null = null;
  envId: string | null = null;
  ingesting = false;
  ingestResult: any = null;

  loading = false;
  error: string | null = null;

  stats: FindingsStatsResponse | null = null;
  trends: FindingsTrendsByApplicationResponse | FindingsTrendsResponse | null = null;
  findings: FindingItem[] = [];

  page = 0;
  size = 20;
  totalElements = 0;

  /** Filtres appliqués sur la page courante (données déjà chargées). */
  filterSeverity = '';
  filterTool = '';
  filterScanType = '';
  /**
   * Filtre “état” basé sur la comparaison entre 2 pipelines importés (pas le status DB).
   * - '' : Tous (sans fixed)
   * - 'NEW' : seulement les nouvelles (vs pipeline précédent)
   */
  filterStatus: '' | 'NEW' = '';
  searchQuery = '';

  /**
   * Vue par défaut : uniquement les findings rapportés pour le pipeline GitLab de cet environnement
   * (évite les anciennes lignes / anciens imports). « Projet » = agrégat historique.
   */
  viewScope: 'latest_pipeline' | 'project' = 'latest_pipeline';

  /** Pipeline GitLab utilisé pour la vue « dernier pipeline ». */
  activeGitlabPipelineId: number | null = null;

  /** Empreintes marquées corrigées vs le run précédent (détails chargés à part). */
  fixedFromPreviousRun: FindingItem[] = [];
  /** Empreintes nouvelles vs le run précédent (détails chargés à part). */
  newFromPreviousRun: FindingItem[] = [];
  /** Affichage du panneau “Corrigées…” uniquement sur demande. */
  showFixedPanel = false;

  /** Pipeline GitLab de l’environnement sélectionné (import = après aggregate-report OK). */
  pipelineStatusLabel: string | null = null;
  pipelineInProgress = false;
  /** Pipeline terminé mais job aggregate-report pas encore en succès. */
  aggregateReportPending = false;
  /** Bandeau « attendre la fin du scan ». */
  showPipelineWaitBanner = false;
  /** Désactive « Importer les données » tant que l’import n’est pas possible. */
  ingestBlocked = false;
  ingestBlockedReason: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private environmentService: EnvironmentService,
    private findingsService: FindingsService,
    private userService: UserService,
    private pipelineService: PipelineService
  ) {}

  ngOnInit(): void {
    if (!this.userService.getToken()) {
      this.error = "Vous devez être authentifié pour voir les vulnérabilités.";
      this.loading = false;
      return;
    }

    this.route.queryParamMap
      .pipe(
        map(p => p.get('envId') ?? ''),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(qpEnvId => {
        if (qpEnvId) {
          if (this.envId !== qpEnvId) {
            this.envId = qpEnvId;
            this.page = 0;
            this.reload();
          }
          return;
        }
        this.loading = true;
        this.error = null;
        this.environmentService
          .getLatestEnvironment()
          .pipe(finalize(() => (this.loading = false)))
          .subscribe({
            next: (env: any) => {
              const id = env?.id ?? null;
              if (this.envId !== id) {
                this.envId = id;
                this.page = 0;
                this.reload();
              }
            },
            error: () => {
              this.error = "Impossible de récupérer le dernier environnement.";
            }
          });
      });

    // appId vient de la route parent : /project/:appId/...
    this.route.parent?.paramMap.pipe(
      map(p => p.get('appId')),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(id => {
      this.appId = id;
      this.page = 0;
      // reload déclenché aussi par envId. Ici on peut recharger si envId est déjà connu.
      if (this.envId) this.reload();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(): void {
    if (!this.envId) {
      this.error = "Aucun environnement sélectionné.";
      return;
    }
    const appId = this.appId;
    if (!appId) {
      this.error = "Aucune application sélectionnée.";
      return;
    }

    this.error = null;
    this.loading = true;
    this.ingestResult = null;

    const tool = this.filterTool?.trim();
    const severity = this.filterSeverity?.trim();
    const scanType = this.filterScanType?.trim();
    const listFilters = {
      ...(tool ? { tool } : {}),
      ...(severity ? { severity } : {}),
      ...(scanType ? { scanType } : {})
    };

    forkJoin({
      pipe: this.pipelineService.getPipelineAndScan(this.envId).pipe(take(1), catchError(() => of(null))),
      trends: this.findingsService.getTrendsByApplication(appId).pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ pipe, trends }) => {
        this.applyPipelineContext(pipe as PipelineScanResponse | null);
        this.trends = trends;
        // En comparant par application, le dernier pipeline "projet" peut être sur un autre environnement.
        // On préfère donc le lastPipelineId de l'app, puis fallback vers l'env courant.
        const pid =
          (trends as FindingsTrendsByApplicationResponse | null)?.lastPipelineId
          ?? (pipe as PipelineScanResponse | null)?.pipelineId
          ?? null;
        this.activeGitlabPipelineId = pid != null ? Number(pid) : null;

        this.loadFixedFromTrends((trends as any)?.fixedFingerprints);
        this.loadNewFromTrends((trends as any)?.newFingerprints);

        const useLatest = this.viewScope === 'latest_pipeline';
        if (useLatest && !this.activeGitlabPipelineId) {
          this.stats = null;
          this.findings = [];
          this.totalElements = 0;
          this.loading = false;
          return;
        }

        const stats$ = useLatest && this.activeGitlabPipelineId
          ? this.findingsService.getStatsByPipeline(this.activeGitlabPipelineId)
          : this.findingsService.getStatsByApplication(
              appId,
              undefined
            );

        const list$ =
          useLatest && this.activeGitlabPipelineId
            ? this.findingsService.listByPipeline(this.activeGitlabPipelineId, this.page, this.size, listFilters)
            : this.findingsService.listByApplication(appId, this.page, this.size, listFilters);

        const emptyPage: PageResponse<FindingItem> = {
          content: [],
          totalElements: 0,
          totalPages: 0,
          number: this.page,
          size: this.size
        };

        forkJoin({
          stats: stats$.pipe(catchError(() => of(null))),
          list: list$.pipe(catchError(() => of(emptyPage)))
        })
          .pipe(finalize(() => (this.loading = false)))
          .subscribe({
            next: out => {
              this.stats = out.stats;
              this.findings = out.list.content ?? [];
              this.totalElements = out.list.totalElements ?? 0;
            },
            error: () => {
              this.error = 'Impossible de charger les vulnérabilités.';
              this.findings = [];
              this.totalElements = 0;
            }
          });
      },
      error: () => {
        this.loading = false;
        this.error = 'Impossible de charger le contexte pipeline / tendances.';
      }
    });
  }

  onViewScopeChanged(): void {
    this.page = 0;
    this.fixedFromPreviousRun = [];
    this.newFromPreviousRun = [];
    this.showFixedPanel = false;
    this.reload();
  }

  private loadFixedFromTrends(fps: string[] | undefined): void {
    this.fixedFromPreviousRun = [];
    if (
      this.viewScope !== 'latest_pipeline' ||
      !this.appId ||
      !fps ||
      !Array.isArray(fps) ||
      fps.length === 0
    ) {
      return;
    }
    const uniq = [...new Set(fps.map(f => f?.trim()).filter(Boolean))] as string[];
    if (!uniq.length) return;
    this.findingsService.resolveFingerprintsForApplication(this.appId, uniq.slice(0, 200)).subscribe({
      next: rows => (this.fixedFromPreviousRun = rows ?? []),
      error: () => (this.fixedFromPreviousRun = [])
    });
  }

  private loadNewFromTrends(fps: string[] | undefined): void {
    this.newFromPreviousRun = [];
    if (
      this.viewScope !== 'latest_pipeline' ||
      !this.appId ||
      !fps ||
      !Array.isArray(fps) ||
      fps.length === 0
    ) {
      return;
    }
    const uniq = [...new Set(fps.map(f => f?.trim()).filter(Boolean))] as string[];
    if (!uniq.length) return;
    this.findingsService.resolveFingerprintsForApplication(this.appId, uniq.slice(0, 200)).subscribe({
      next: rows => (this.newFromPreviousRun = rows ?? []),
      error: () => (this.newFromPreviousRun = [])
    });
  }

  ingestNow(): void {
    if (!this.envId || this.ingesting || this.ingestBlocked) return;
    this.error = null;
    this.ingestResult = null;
    this.ingesting = true;

    this.pipelineService.getPipelineAndScan(this.envId).subscribe({
      next: (res: any) => {
        const pipelineId = res?.pipelineId;
        if (!pipelineId) {
          this.ingesting = false;
          this.error = "PipelineId introuvable pour cet environnement.";
          return;
        }

        this.findingsService.ingestPipeline(Number(pipelineId)).pipe(finalize(() => (this.ingesting = false))).subscribe({
          next: (r) => {
            this.ingestResult = r;
            this.reload();
          },
          error: (err) => {
            const msg = err?.error?.error || err?.error?.message || err?.message;
            this.error = msg
              ? `Ingestion échouée: ${msg}`
              : "Ingestion échouée (job aggregate-report manquant ou pipeline non terminé).";
          }
        });
      },
      error: () => {
        this.ingesting = false;
        this.error = "Impossible de récupérer le pipeline pour cet environnement.";
      }
    });
  }

  nextPage(): void {
    if ((this.page + 1) * this.size >= this.totalElements) return;
    this.page++;
    this.reload();
  }

  prevPage(): void {
    if (this.page <= 0) return;
    this.page--;
    this.reload();
  }

  /** Page dédiée : code, IA, chat (voir `VulnerabilityDetailsComponent`). */
  openDetail(f: FindingItem): void {
    if (!this.envId || !this.appId || !f?.id) return;
    this.router.navigate(['vulnerabilities', f.id], {
      relativeTo: this.route.parent,
      queryParams: { envId: this.envId, appId: this.appId }
    });
  }

  /** Filtre outil / sévérité côté API ; ici seule la recherche texte reste locale sur la page chargée. */
  get displayedFindings(): FindingItem[] {
    let list: FindingItem[] = this.filterStatus === 'NEW' ? (this.newFromPreviousRun ?? []) : (this.findings ?? []);

    // En mode “Nouvelles”, la liste n'est pas paginée via l'API.
    // On applique donc ici les filtres “facettes” (outil/sévérité/type) pour être cohérent avec la table.
    if (this.filterStatus === 'NEW') {
      const tool = this.filterTool?.trim();
      const severity = this.filterSeverity?.trim();
      const scanType = this.filterScanType?.trim();
      if (tool) list = list.filter(f => (f.toolName || '').trim() === tool);
      if (severity) list = list.filter(f => (f.severity || '').trim().toUpperCase() === severity.toUpperCase());
      if (scanType) list = list.filter(f => (f.scanType || '').trim() === scanType);
    }

    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(f => {
        const blob = [
          f.title,
          f.ruleId,
          f.fingerprint,
          f.filePath,
          f.packageName,
          f.cve,
          f.scanType,
          f.toolName
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return blob.includes(q);
      });
    }
    return list;
  }

  get disablePagination(): boolean {
    // En vue “Nouvelles”, la liste vient de la résolution fingerprints (pas paginée).
    return this.filterStatus === 'NEW';
  }

  get displayedTotalElements(): number {
    return this.filterStatus === 'NEW' ? (this.displayedFindings.length ?? 0) : (this.totalElements ?? 0);
  }

  onTrendClick(kind: 'NEW' | 'FIXED'): void {
    if (kind === 'NEW') {
      this.filterStatus = 'NEW';
      this.showFixedPanel = false;
      this.page = 0;
      this.reload();
      setTimeout(() => {
        try {
          document.getElementById('vuln-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {}
      }, 0);
      return;
    }

    // FIXED: on ne filtre pas la table (le “fixed” est visible dans le panneau dédié).
    this.showFixedPanel = !this.showFixedPanel;
    // Ne pas “jumper” en bas : on scroll seulement si le panneau n'est pas déjà visible.
    if (this.showFixedPanel) {
      setTimeout(() => {
        try {
          const el = document.getElementById('fixed-panel');
          if (!el) return;
          const r = el.getBoundingClientRect();
          const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
          const alreadyVisible = r.top >= 0 && r.bottom <= viewportH;
          if (alreadyVisible) return;
          // Scroll doux vers le panneau, avec un offset pour garder le contexte.
          const y = window.scrollY + r.top - 90;
          window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
        } catch {}
      }, 50);
    }
  }

  closeFixedPanel(): void {
    this.showFixedPanel = false;
  }

  /** Tous les outils connus pour l’env (stats globales), pas seulement la page courante du tableau. */
  get toolFilterOptions(): string[] {
    const set = new Set<string>();
    const byTool = this.stats?.byTool;
    if (byTool && typeof byTool === 'object') {
      for (const k of Object.keys(byTool)) {
        if (k?.trim()) set.add(k);
      }
    }
    for (const f of this.findings) {
      if (f.toolName?.trim()) set.add(f.toolName);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  onListFiltersChanged(): void {
    if (!this.envId) return;
    this.page = 0;
    this.reload();
  }

  clearFilters(): void {
    this.filterSeverity = '';
    this.filterTool = '';
    this.filterScanType = '';
    this.filterStatus = '';
    this.searchQuery = '';
    this.showFixedPanel = false;
    this.page = 0;
    if (this.envId) this.reload();
  }

  hasActiveFilters(): boolean {
    return !!(this.filterSeverity || this.filterTool || this.filterScanType || this.filterStatus || this.searchQuery.trim());
  }

  // (helpers removed — NEW list is resolved by fingerprints)

  /** Total distinct pour les barres de sévérité (stats au périmètre projet, alignées sur le tableau sans filtres outil/type). */
  get chartTotalCount(): number {
    const m = this.stats?.bySeverity;
    if (m && typeof m === 'object') {
      const s = Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
      if (s > 0) return s;
    }
    return this.totalElements || 0;
  }

  get statsScopeFootnote(): string {
    return this.viewScope === 'latest_pipeline' && this.activeGitlabPipelineId
      ? `pipeline #${this.activeGitlabPipelineId}`
      : 'périmètre projet';
  }

  /** Dernier pipeline demandé mais aucun id GitLab résolu pour cet environnement. */
  get showLatestPipelineMissingState(): boolean {
    return (
      this.viewScope === 'latest_pipeline' &&
      !this.loading &&
      !!this.envId &&
      !!this.appId &&
      this.activeGitlabPipelineId == null
    );
  }

  get showEmptyFindingsTable(): boolean {
    return !this.loading && this.findings.length === 0 && !this.showLatestPipelineMissingState;
  }

  private applyPipelineContext(res: PipelineScanResponse | null): void {
    if (!res || res.pipelineId == null) {
      this.pipelineStatusLabel = null;
      this.pipelineInProgress = false;
      this.aggregateReportPending = false;
      this.showPipelineWaitBanner = false;
      this.ingestBlocked = false;
      this.ingestBlockedReason = null;
      return;
    }

    this.pipelineStatusLabel = res.status ?? null;
    const st = (res.status || '').toUpperCase();
    const terminal = ['SUCCESS', 'FAILED', 'CANCELED'].includes(st);
    this.pipelineInProgress = !terminal;

    const jobs = res.jobs || [];
    const agg = jobs.find(
      j => (j.name || '').toLowerCase().trim() === 'aggregate-report'
    );
    const aggSt = agg ? (agg.status || '').toUpperCase() : '';
    const hasAgg = !!agg;
    const aggSuccess = hasAgg && aggSt === 'SUCCESS';
    const aggStillRunning =
      hasAgg && !['SUCCESS', 'FAILED', 'CANCELED', 'SKIPPED'].includes(aggSt);

    this.aggregateReportPending = st === 'SUCCESS' && aggStillRunning;

    this.showPipelineWaitBanner = this.pipelineInProgress || (st === 'SUCCESS' && hasAgg && !aggSuccess);

    this.ingestBlocked = this.pipelineInProgress || (st === 'SUCCESS' && hasAgg && !aggSuccess);

    if (this.pipelineInProgress) {
      this.ingestBlockedReason =
        'Le pipeline est encore en cours. Attendez la fin du stage aggregate-report (succès), puis utilisez « Importer les données ».';
    } else if (st === 'SUCCESS' && hasAgg && aggStillRunning) {
      this.ingestBlockedReason =
        'Le job aggregate-report est encore en cours. La liste affichée correspond aux imports déjà enregistrés pour ce projet.';
    } else if (st === 'SUCCESS' && hasAgg && ['FAILED', 'CANCELED'].includes(aggSt)) {
      this.ingestBlockedReason =
        'Le job aggregate-report n’a pas réussi ; corrigez le pipeline ou lancez-le de nouveau avant d’importer.';
    } else {
      this.ingestBlockedReason = null;
    }
  }

  /** Tous les scanTypes connus pour l’env (stats globales), pas seulement la page courante. */
  get scanTypeFilterOptions(): string[] {
    const set = new Set<string>();
    const byType = this.stats?.byScanType;
    if (byType && typeof byType === 'object') {
      for (const k of Object.keys(byType)) {
        if (k?.trim()) set.add(k);
      }
    }
    for (const f of this.findings) {
      if (f.scanType?.trim()) set.add(f.scanType);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
}
