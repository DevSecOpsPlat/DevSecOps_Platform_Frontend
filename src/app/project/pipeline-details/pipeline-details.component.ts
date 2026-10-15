import { ChangeDetectorRef, Component, ElementRef, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject, combineLatest } from 'rxjs';
import { catchError, distinctUntilChanged, map, takeUntil } from 'rxjs/operators';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { PipelineScanResponse, PipelineJobInfo } from '../../models/pipeline/pipeline-scan-response';
import { ToastService } from '../../services/ui/toast.service';
import { AiAnalysisService } from '../../services/ai/ai-analysis.service';
import { AnalyzeArtifactResponse } from '../../models/ai/analyze-artifact.model';
import { ChatTurn } from '../../models/ai/explain-pipeline-logs.model';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { AppDeployment } from '../../models/application-management/application-management.models';
import { sortStageNames } from '../../shared/ci-stage-order';

/** Un message du fil de discussion avec l'assistant pipeline. */
interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** true = analyse approfondie (modèle plus lent, plus fiable) — connu après le 1er événement du flux. */
  deep?: boolean;
}

@Component({
  selector: 'app-pipeline-details',
  templateUrl: './pipeline-details.component.html',
  styleUrls: ['./pipeline-details.component.css']
})
export class PipelineDetailsComponent implements OnInit, OnDestroy {

  envId = '';
  pipelineIdOnly: number | null = null;
  /** Service (/project/:appId) ou app managée (/projects/:id). */
  contextAppId: string | null = null;
  /** true si URL sous /projects/:id/... */
  managedAppContext = false;
  /** Affiché dans le layout EnviroTest (sidebar app/service) — pas de double shell. */
  inAppShell = false;
  data?: PipelineScanResponse;
  loading = false;
  error: string | null = null;
  /** SCAN | DEPLOY — depuis query param ou déduit des jobs. */
  pipelineKind: 'SCAN' | 'DEPLOY' | null = null;

  /** Déploiement correspondant (namespace/URL/services) — bannière « Résultat du déploiement ». */
  deployResult: AppDeployment | null = null;
  deployResultLoading = false;
  private deployResultPipelineId: number | null = null;
  private deployPhasePoll?: ReturnType<typeof setInterval>;

  selectedJob?: PipelineJobInfo;
  selectedJobLogs?: string;
  selectedJobScanJson?: any;
  /** Message affiché quand les logs ne sont pas disponibles (ex. GitLab indisponible) */
  jobLogsError: string | null = null;
  /** Message affiché quand le rapport de scan n'est pas disponible */
  scanError: string | null = null;
  loadingJob = false;

  /** Analyse IA de l'artifact courant */
  aiAnalysisResult: AnalyzeArtifactResponse | null = null;
  aiAnalysisLoading = false;
  aiAnalysisError: string | null = null;

  /**
   * Agent IA — vraie conversation, une par job. Conservée tant qu'on reste sur cette page (change
   * de job et revient = retrouve la discussion), remise à zéro seulement si on la vide explicitement
   * ou qu'on charge un autre pipeline (retour utilisateur du 17 août 2026).
   */
  private chatHistoryByJob = new Map<string, ChatMessage[]>();
  logAiLoading = false;
  logAiError: string | null = null;
  logAiQuestion = '';

  private get currentChatKey(): string {
    return this.selectedJob?.id != null ? String(this.selectedJob.id) : '__overview__';
  }

  /** Fil de discussion du job actuellement affiché (ou vue d'ensemble si aucun job sélectionné). */
  get chatMessages(): ChatMessage[] {
    const key = this.currentChatKey;
    if (!this.chatHistoryByJob.has(key)) {
      this.chatHistoryByJob.set(key, []);
    }
    return this.chatHistoryByJob.get(key)!;
  }

  /** Vide la conversation du job actuellement affiché pour repartir de zéro. */
  clearChat(): void {
    this.chatHistoryByJob.set(this.currentChatKey, []);
    this.logAiError = null;
    this.cdr.detectChanges();
  }

  private pollId?: any;
  private lastAutoScrollJobId?: number;
  /** true = l'utilisateur a cliqué manuellement sur un job (pas de suivi auto). */
  private jobSelectionPinned = false;
  private readonly destroy$ = new Subject<void>();

  /** Stages explicitement dépliés/repliés par l'utilisateur (override du repli auto des stages verts). */
  private stageOverrides = new Map<string, boolean>();

  /** Suivi auto du bas des logs — coupé si l'utilisateur remonte manuellement. */
  logsFollowing = true;
  @ViewChild('logsConsole') private logsConsoleEl?: ElementRef<HTMLDivElement>;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private pipelineService: PipelineService,
    private toastService: ToastService,
    private aiAnalysisService: AiAnalysisService,
    private sanitizer: DomSanitizer,
    private appMgmt: ApplicationManagementService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    combineLatest([
      this.route.paramMap,
      this.route.queryParamMap
    ]).pipe(
      map(([pm, qm]) => ({
        pipelineId: pm.get('pipelineId') || '',
        envId: pm.get('envId') || '',
        kind: (qm.get('kind') || '').toUpperCase()
      })),
      distinctUntilChanged((a, b) =>
        a.pipelineId === b.pipelineId && a.envId === b.envId && a.kind === b.kind
      ),
      takeUntil(this.destroy$)
    ).subscribe(() => this.resolveAndLoad());
  }

  private resolveAndLoad(): void {
    if (this.pollId) {
      clearInterval(this.pollId);
      this.pollId = undefined;
    }
    this.data = undefined;
    this.error = null;
    this.selectedJob = undefined;
    this.jobSelectionPinned = false;
    this.stageOverrides.clear();
    this.logsFollowing = true;
    this.chatHistoryByJob.clear(); // nouveau pipeline chargé = nouveau contexte, on repart de zéro

    const kindParam = (this.route.snapshot.queryParamMap.get('kind') || '').toUpperCase();
    if (kindParam === 'SCAN' || kindParam === 'DEPLOY') {
      this.pipelineKind = kindParam;
    }

    this.contextAppId = this.resolveContextAppId();
    this.managedAppContext = this.isManagedAppRoute();
    this.inAppShell = this.isInAppShell();

    const pipelineIdParam = this.route.snapshot.paramMap.get('pipelineId');
    this.envId = this.route.snapshot.paramMap.get('envId') || '';
    this.pipelineIdOnly = null;

    if (pipelineIdParam) {
      const pid = Number(pipelineIdParam);
      if (!Number.isNaN(pid) && pid > 0) {
        this.pipelineIdOnly = pid;
        this.rememberPipeline(pid);
        this.loadPipelineById();
        return;
      }
    }
    if (this.envId) {
      this.loadPipeline();
      return;
    }
    // Sidebar « Détail pipeline » sans id → dernier pipeline (filtre kind)
    this.loadLatestForContext();
  }

  private resolveContextAppId(): string | null {
    let r: ActivatedRoute | null = this.route;
    while (r) {
      const appId = r.snapshot.paramMap.get('appId');
      if (appId) return appId;
      const id = r.snapshot.paramMap.get('id');
      if (id && this.router.url.includes('/projects/')) return id;
      r = r.parent;
    }
    return this.route.snapshot.queryParamMap.get('appId');
  }

  private isManagedAppRoute(): boolean {
    return this.router.url.split(/[?#]/)[0].startsWith('/projects/');
  }

  private isInAppShell(): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return path.startsWith('/projects/') || path.startsWith('/project/');
  }

  private rememberPipeline(pipelineId: number): void {
    try {
      localStorage.setItem('envirotest-last-pipeline-id', String(pipelineId));
      if (this.contextAppId) {
        localStorage.setItem(`envirotest-last-pipeline-id:${this.contextAppId}`, String(pipelineId));
      }
      if (this.pipelineKind) {
        localStorage.setItem('envirotest-last-pipeline-kind', this.pipelineKind);
      }
    } catch { /* ignore */ }
  }

  /** Oublie le pipeline mémorisé (ex. après échec de chargement) — évite une redirection en boucle. */
  private forgetRememberedPipeline(): void {
    try {
      localStorage.removeItem('envirotest-last-pipeline-id');
      if (this.contextAppId) {
        localStorage.removeItem(`envirotest-last-pipeline-id:${this.contextAppId}`);
      }
    } catch { /* ignore */ }
  }

  private loadLatestForContext(): void {
    this.loading = true;
    this.error = null;

    const remembered = this.readRememberedPipelineId();
    if (remembered) {
      this.pipelineIdOnly = remembered;
      this.loadPipelineById();
      return;
    }

    if (this.managedAppContext && this.contextAppId) {
      this.loadLatestManagedAppPipeline();
      return;
    }

    if (this.contextAppId) {
      this.pipelineService.listPipelines(0, 30, this.contextAppId, this.pipelineKind || null).subscribe({
        next: list => {
          const item = (list || [])[0];
          if (item?.pipelineId) {
            this.pipelineIdOnly = item.pipelineId;
            this.rememberPipeline(item.pipelineId);
            this.loadPipelineById();
          } else if (item?.environmentId) {
            this.envId = item.environmentId;
            this.loadPipeline();
          } else {
            this.loading = false;
            this.error = this.emptyPipelineMessage();
          }
        },
        error: () => {
          this.loading = false;
          this.error = this.emptyPipelineMessage();
        }
      });
      return;
    }

    this.pipelineService.getLatestPipeline().subscribe({
      next: latest => {
        if (latest?.pipelineId || latest?.id) {
          const pid = Number(latest.pipelineId ?? latest.id);
          if (!Number.isNaN(pid) && pid > 0) {
            this.pipelineIdOnly = pid;
            this.loadPipelineById();
            return;
          }
        }
        if (latest?.environmentId) {
          this.envId = latest.environmentId;
          this.loadPipeline();
          return;
        }
        this.loading = false;
        this.error = this.emptyPipelineMessage();
      },
      error: () => {
        this.loading = false;
        this.error = this.emptyPipelineMessage();
      }
    });
  }

  private loadLatestManagedAppPipeline(): void {
    if (!this.contextAppId) return;
    if (this.pipelineKind === 'DEPLOY') {
      this.appMgmt.listDeployments(this.contextAppId).pipe(
        catchError(() => of([])),
        takeUntil(this.destroy$)
      ).subscribe(deps => {
        const withPipe = (deps || []).find(d => !!d.gitlabPipelineId);
        if (withPipe?.gitlabPipelineId) {
          this.pipelineIdOnly = withPipe.gitlabPipelineId;
          this.rememberPipeline(withPipe.gitlabPipelineId);
          this.loadPipelineById();
        } else {
          this.loading = false;
          this.error = this.emptyPipelineMessage();
        }
      });
      return;
    }
    this.appMgmt.listScanBatches(this.contextAppId).pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$)
    ).subscribe(batches => {
      const withPipe = (batches || []).find(b => !!b.gitlabPipelineId);
      if (withPipe?.gitlabPipelineId) {
        this.pipelineIdOnly = withPipe.gitlabPipelineId!;
        this.rememberPipeline(withPipe.gitlabPipelineId!);
        this.loadPipelineById();
      } else {
        this.loading = false;
        this.error = this.emptyPipelineMessage();
      }
    });
  }

  private readRememberedPipelineId(): number | null {
    try {
      const storedKind = localStorage.getItem('envirotest-last-pipeline-kind');
      if (this.pipelineKind && storedKind && storedKind !== this.pipelineKind) {
        return null;
      }
      const keyed = this.contextAppId
        ? localStorage.getItem(`envirotest-last-pipeline-id:${this.contextAppId}`)
        : null;
      const raw = keyed || localStorage.getItem('envirotest-last-pipeline-id');
      const n = raw ? Number(raw) : NaN;
      return !Number.isNaN(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * Reflète pipelineKind (résolu via inferPipelineKind, quand la route n'avait pas de ?kind=
   * explicite -- ex. "dernier pipeline pour ce contexte") dans l'URL affichée. Sans ça, la sidebar
   * (envirotest-nav-sidebar.syncFromUrl) lit ?kind= directement depuis l'URL courante pour savoir
   * quelle section est active -- une page DEPLOY chargée sans ce paramètre se lit alors comme
   * "kind inconnu", et keyFromAppSection()/keyFromServiceSection() y défaut sur 'pipeline-detail-scan'.
   * Symptôme réel constaté le 29/08/2026 : app → détail pipeline DEPLOY affiché correctement, mais
   * "entrer dans le service" depuis là bascule vers le détail du pipeline SCAN (queryForActiveKey()
   * suit l'activeKey déjà faussé) -- pas le pipeline DEPLOY en cours qu'on regardait. replaceUrl:true
   * pour ne pas polluer l'historique navigateur d'une entrée par résolution.
   */
  private syncKindToUrl(): void {
    if (!this.pipelineKind) return;
    const current = (this.route.snapshot.queryParamMap.get('kind') || '').toUpperCase();
    if (current === this.pipelineKind) return;
    // router.navigate (pas Location.replaceState) : envirotest-nav-sidebar ne se resynchronise
    // QUE sur les événements NavigationEnd du routeur (jamais sur un simple changement d'URL) --
    // un replaceState "silencieux" laisserait la sidebar bloquée sur l'ancien kind déduit (donc le
    // bug d'origine) jusqu'à la prochaine vraie navigation. Coût accepté : un rechargement
    // redondant (queryParamMap change -> resolveAndLoad() se relance), mais pipelineKind est déjà
    // fixé à ce moment-là donc pas de 2e appel à syncKindToUrl -- pas de boucle.
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { kind: this.pipelineKind },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private emptyPipelineMessage(): string {
    if (this.pipelineKind === 'DEPLOY') {
      return 'Aucun pipeline de déploiement — lance un déploiement pour suivre les jobs ici.';
    }
    if (this.pipelineKind === 'SCAN') {
      return 'Aucun pipeline de scan — lance un scan pour suivre les jobs ici.';
    }
    return 'Aucun pipeline disponible. Lance un scan ou un déploiement.';
  }

  loadPipelineById(): void {
    if (this.pipelineIdOnly == null) return;
    this.loading = true;
    this.error = null;
    const appId = this.contextAppId
      || this.route.snapshot.queryParamMap.get('appId')
      || undefined;
    // Le backend accepte maintenant un UUID d'appli managée en plus d'un service isolé
    // (voir PipelineController#getByPipelineId) — plus besoin de l'omettre ici.
    this.pipelineService.getPipelineAndScanLiveById(this.pipelineIdOnly, appId).subscribe({
      next: res => {
        this.applyPipelineUpdate(res);
        this.loading = false;
        this.autoFollowRunningJob();
        this.ensurePolling();
        if (this.pipelineIdOnly) this.rememberPipeline(this.pipelineIdOnly);
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement du pipeline';
        // Évite de rester bloqué indéfiniment sur un ID mémorisé (localStorage) devenu invalide.
        this.forgetRememberedPipeline();
      }
    });
  }

  /**
   * Bannière « Résultat du déploiement » : ne concerne que les pipelines de déploiement,
   * dans le contexte d'une app managée. Un seul appel par pipeline (pas à chaque poll).
   */
  private maybeLoadDeployResult(pipelineId: number | null): void {
    if (this.pipelineKind !== 'DEPLOY' || !this.contextAppId || !this.managedAppContext) return;
    if (!pipelineId || pipelineId === this.deployResultPipelineId) return;
    this.deployResultPipelineId = pipelineId;
    this.deployResultLoading = true;
    this.appMgmt.listDeployments(this.contextAppId).subscribe({
      next: (list) => {
        this.deployResult = (list || []).find(d => d.gitlabPipelineId === pipelineId) || null;
        this.deployResultLoading = false;
        this.trackDeployPhase();
      },
      error: () => {
        this.deployResultLoading = false;
      }
    });
  }

  /** Progression fine (namespace → BD → vague N → ingress) tant que status = DEPLOYING. */
  private trackDeployPhase(): void {
    this.stopDeployPhasePoll();
    if (this.deployResult?.status !== 'DEPLOYING' || !this.contextAppId || !this.deployResult.id) return;
    const appId = this.contextAppId;
    const deploymentId = this.deployResult.id;
    this.deployPhasePoll = setInterval(() => {
      this.appMgmt.getDeployment(appId, deploymentId).subscribe({
        next: (dep) => {
          this.deployResult = dep;
          if (dep.status !== 'DEPLOYING') this.stopDeployPhasePoll();
        },
        error: () => this.stopDeployPhasePoll()
      });
    }, 4000);
  }

  private stopDeployPhasePoll(): void {
    if (this.deployPhasePoll) {
      clearInterval(this.deployPhasePoll);
      this.deployPhasePoll = undefined;
    }
  }

  /** Phase courante de l'apply K8s (servicesState.deployPhase, posée côté backend). */
  get deployPhase(): string | null {
    return this.deployResult?.servicesState?.['deployPhase'] || null;
  }

  /** Checklist ordonnée « namespace → BD → vague N → ingress » (servicesState.deploySteps). */
  get deploySteps(): Array<{ key: string; label: string; status: string; services?: string[] }> {
    const raw = this.deployResult?.servicesState?.['deploySteps'];
    return Array.isArray(raw) ? raw : [];
  }

  openDeployResultRuntime(): void {
    if (!this.contextAppId) return;
    this.router.navigate(['/projects', this.contextAppId, 'deployments']);
  }

  /** Smoke test post-déploiement (servicesState.smokeTest, posé côté backend une fois Ready). */
  get smokeTest(): { allOk: boolean; results: Record<string, { ok: boolean; message?: string }> } | null {
    return this.deployResult?.servicesState?.['smokeTest'] || null;
  }

  /** Résumé Grype (scan de l'image construite) — servicesState.containerScan. */
  get containerScan(): { critical: number; high: number; medium: number; low: number; imageName?: string } | null {
    return this.deployResult?.servicesState?.['containerScan'] || null;
  }

  get containerScanSummary(): string | null {
    const cs = this.containerScan;
    if (!cs) return null;
    return `Image scannée (Grype) : ${cs.critical || 0} critique, ${cs.high || 0} élevée`;
  }

  get smokeTestSummary(): string | null {
    const st = this.smokeTest;
    if (!st?.results) return null;
    const names = Object.keys(st.results);
    if (!names.length) return null;
    const okCount = names.filter(n => st.results[n]?.ok).length;
    return `Smoke test : ${okCount}/${names.length} service${names.length > 1 ? 's' : ''} OK`;
  }

  /** Services prêts / attendus, calculé depuis servicesState (même structure que Runtime). */
  get deployResultServiceSummary(): string | null {
    const state = this.deployResult?.servicesState as { services?: Record<string, { status?: string }> } | undefined;
    const services = state?.services;
    if (!services) return null;
    const names = Object.keys(services);
    if (!names.length) return null;
    const ready = names.filter(n => (services[n]?.status || '').toLowerCase() === 'ready').length;
    return `${ready}/${names.length} services prêts`;
  }

  /** Première URL externe trouvée dans servicesState — même logique que Runtime/Historique. */
  get deployResultUrl(): string | null {
    const state = this.deployResult?.servicesState as { services?: Record<string, { externalUrl?: string }> } | undefined;
    const services = state?.services;
    if (!services) return null;
    for (const svc of Object.values(services)) {
      const url = (svc?.externalUrl || '').trim();
      if (url) return url;
    }
    return null;
  }

  ngOnDestroy(): void {
    if (this.pollId) {
      clearInterval(this.pollId);
      this.pollId = undefined;
    }
    this.stopDeployPhasePoll();
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Progression globale (jobs terminés/total) — pour la barre sous le header. */
  get progressStats(): { done: number; total: number; pct: number } {
    const jobs = this.jobsList;
    const total = jobs.length;
    if (!total) return { done: 0, total: 0, pct: 0 };
    const done = jobs.filter(j => {
      const s = this.normStatus(j.status);
      return s === 'SUCCESS' || s === 'FAILED' || s === 'CANCELED' || s === 'SKIPPED';
    }).length;
    return { done, total, pct: Math.round((done / total) * 100) };
  }

  /** Liste jobs normalisée pour le template. */
  get jobsList(): PipelineJobInfo[] {
    return this.normalizeJobs(this.data?.jobs);
  }

  loadPipeline(): void {
    this.loading = true;
    this.error = null;
    // refresh=true au premier chargement pour peupler stages_json avant affichage
    this.pipelineService.getPipelineAndScanLive(this.envId).subscribe({
      next: res => {
        this.applyPipelineUpdate(res);
        this.loading = false;
        this.autoFollowRunningJob();
        this.ensurePolling();
      },
      error: err => {
        this.loading = false;
        if (err.status === 404) {
          this.handleNotFound();
        } else {
          this.error = err.error?.message || 'Erreur lors du chargement du pipeline';
        }
      }
    });
  }

  /** Met à jour le pipeline sans effacer les jobs si le refresh renvoie une liste vide. */
  private applyPipelineUpdate(incoming: PipelineScanResponse): void {
    const nextJobs = this.normalizeJobs(incoming?.jobs);
    const normalized: PipelineScanResponse = {
      ...incoming,
      jobs: nextJobs,
      durationSeconds: incoming.durationSeconds != null
        ? Math.floor(incoming.durationSeconds)
        : this.coerceDuration(incoming),
    };

    if (!this.pipelineKind) {
      this.pipelineKind = this.inferPipelineKind(nextJobs.length ? nextJobs : this.normalizeJobs(this.data?.jobs));
      this.syncKindToUrl();
    }
    this.maybeLoadDeployResult(normalized.pipelineId ?? this.pipelineIdOnly ?? null);

    if (!this.data) {
      this.data = normalized;
      return;
    }

    const prevJobs = this.normalizeJobs(this.data.jobs);

    if (nextJobs.length === 0 && prevJobs.length > 0) {
      this.data = {
        ...this.data,
        status: normalized.status || this.data.status,
        webUrl: normalized.webUrl ?? this.data.webUrl,
        jobStatusCount: normalized.jobStatusCount ?? this.data.jobStatusCount,
        dataSource: normalized.dataSource ?? this.data.dataSource,
        pipelineId: normalized.pipelineId ?? this.data.pipelineId,
        ref: normalized.ref ?? this.data.ref,
        triggeredBy: normalized.triggeredBy ?? this.data.triggeredBy,
        durationSeconds: normalized.durationSeconds ?? this.data.durationSeconds,
      };
      this.syncSelectedJobFromData();
      return;
    }

    const mergedJobs = nextJobs.length > 0
      ? this.mergeJobsById(prevJobs, nextJobs)
      : nextJobs;

    this.data = {
      ...normalized,
      jobs: mergedJobs,
    };
    this.syncSelectedJobFromData();
  }

  /** Garantit que jobs est toujours un tableau (évite object / null après JSON). */
  private normalizeJobs(raw: unknown): PipelineJobInfo[] {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>);
    return list
      .map(item => this.normalizeJob(item))
      .filter(j => j.id != null && !Number.isNaN(j.id));
  }

  private normalizeJob(raw: unknown): PipelineJobInfo {
    const j = (raw || {}) as Record<string, unknown>;
    return {
      id: Number(j['id']),
      name: String(j['name'] ?? ''),
      status: String(j['status'] ?? ''),
      stage: String(j['stage'] ?? ''),
      duration: j['duration'] != null ? Math.floor(Number(j['duration'])) : undefined,
      webUrl: j['webUrl'] != null ? String(j['webUrl']) : undefined,
    };
  }

  private coerceDuration(res: PipelineScanResponse): number | undefined {
    if (res.durationSeconds != null) {
      return Math.floor(res.durationSeconds);
    }
    const d = res.duration;
    if (d == null) return undefined;
    const n = Math.floor(Number(d));
    return Number.isNaN(n) ? undefined : n;
  }

  /** Fusionne par id : conserve l'ordre existant, met à jour statut/durée. */
  private mergeJobsById(prev: PipelineJobInfo[], next: PipelineJobInfo[]): PipelineJobInfo[] {
    const nextById = new Map(next.map(j => [j.id, j]));
    const merged: PipelineJobInfo[] = [];

    for (const p of prev) {
      const n = nextById.get(p.id);
      merged.push(n ? { ...p, ...n } : p);
      nextById.delete(p.id);
    }
    for (const n of nextById.values()) {
      merged.push(n);
    }
    return merged.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }

  /** Garde le job sélectionné aligné sur la liste après refresh. */
  private syncSelectedJobFromData(): void {
    if (!this.selectedJob?.id || !this.data?.jobs?.length) {
      return;
    }
    const updated = this.data.jobs.find(j => j.id === this.selectedJob!.id);
    if (updated) {
      this.selectedJob = updated;
    }
  }

  private refreshPipelineLive(onDone?: () => void): void {
    const done = () => {
      this.autoFollowRunningJob();
      onDone?.();
    };
    if (this.pipelineIdOnly != null) {
      // contextAppId d'abord : pour une appli managée (/projects/:id/...), l'id est un
      // paramètre de route, pas un query param — queryParamMap seul renvoyait toujours vide.
      const appId = this.contextAppId
        || this.route.snapshot.queryParamMap.get('appId')
        || undefined;
      this.pipelineService.getPipelineAndScanLiveById(this.pipelineIdOnly, appId).subscribe({
        next: res => {
          this.applyPipelineUpdate(res);
          done();
        },
        error: () => done()
      });
      return;
    }
    if (this.envId) {
      this.pipelineService.getPipelineAndScanLive(this.envId).subscribe({
        next: res => {
          this.applyPipelineUpdate(res);
          done();
        },
        error: () => done()
      });
    }
  }

  private ensurePolling(): void {
    if (!this.shouldPoll()) {
      if (this.pollId) {
        clearInterval(this.pollId);
        this.pollId = undefined;
      }
      return;
    }
    if (this.pollId) return;
    // Poll léger pour suivre statuts + récupérer jobs si la 1ère réponse était vide
    this.pollId = setInterval(() => {
      if (!this.envId && this.pipelineIdOnly == null) return;
      this.refreshPipelineLive(() => {
        if (!this.shouldPoll()) {
          clearInterval(this.pollId);
          this.pollId = undefined;
        }
      });
    }, 2500);
  }

  /** Polling tant que le pipeline tourne OU que les jobs ne sont pas encore chargés. */
  private shouldPoll(): boolean {
    if (this.isRunning()) return true;
    const jobs = this.normalizeJobs(this.data?.jobs);
    const pipelineId = this.data?.pipelineId ?? 0;
    return pipelineId > 0 && jobs.length === 0;
  }

  private handleNotFound(): void {
    this.error = 'Ce pipeline ou son environnement associé n\'existe plus';

    // Tenter de récupérer le dernier pipeline existant pour l'utilisateur
    this.pipelineService.getLatestPipeline().subscribe({
      next: latest => {
        if (latest && latest.environmentId) {
          if (this.toastService) {
            this.toastService.push(
              'info',
              'Pipeline introuvable',
              'Redirection vers le dernier pipeline disponible...',
              3000
            );
          }

          this.router.navigate(['/pipeline', latest.environmentId]);
        } else {
          this.redirectToPipelinesList();
        }
      },
      error: () => {
        this.redirectToPipelinesList();
      }
    });
  }

  private redirectToPipelinesList(): void {
    if (this.toastService) {
      this.toastService.push(
        'info',
        'Pipeline introuvable',
        'Redirection vers la liste des pipelines...',
        3000
      );
    }
    if (this.managedAppContext && this.contextAppId) {
      this.router.navigate(['/projects', this.contextAppId, 'pipelines']);
      return;
    }
    if (this.contextAppId) {
      this.router.navigate(['/project', this.contextAppId, 'pipelines']);
      return;
    }
    this.router.navigate(['/pipelines']);
  }

  selectJob(job: PipelineJobInfo, fromUserClick = true): void {
    if (fromUserClick) {
      this.jobSelectionPinned = true;
    }
    if (job.stage) {
      this.stageOverrides.set(job.stage, true); // le stage du job sélectionné reste toujours déplié
    }
    this.logsFollowing = true; // nouveau job = on suit son log depuis le début

    const latest = this.normalizeJobs(this.data?.jobs).find(j => j.id === job.id) ?? job;

    if (this.selectedJob?.id === latest.id) {
      this.selectedJob = latest;
      const st = this.normStatus(latest.status);
      if (st === 'PENDING' || st === 'RUNNING') {
        this.refreshSelectedJobLogsIfRunning();
      }
      return;
    }

    this.selectedJob = latest;
    this.selectedJobLogs = undefined;
    this.selectedJobScanJson = undefined;
    this.jobLogsError = null;
    this.scanError = null;
    this.aiAnalysisResult = null;
    this.aiAnalysisError = null;
    // Pas de reset ici : la conversation de ce job est conservée (chatHistoryByJob), on la
    // retrouve telle quelle si on revient dessus plus tard (retour utilisateur du 17 août 2026).
    this.logAiError = null;
    this.logAiQuestion = '';
    this.loadingJob = true;

    this.pipelineService.getJobLogs(latest.id).subscribe({
      next: logs => {
        this.selectedJobLogs = this.cleanJobLogs(logs);
        this.jobLogsError = null;
        this.loadingJob = false;
        this.scrollLogsToBottom();
      },
      error: () => {
        this.loadingJob = false;
        const st = this.normStatus(latest.status);
        this.jobLogsError = (st === 'PENDING' || st === 'RUNNING')
          ? 'Logs pas encore disponibles : le job est en cours.'
          : 'Logs indisponibles pour ce job.';
      }
    });

    const st = this.normStatus(latest.status);
    if (st === 'PENDING' || st === 'RUNNING') {
      this.selectedJobScanJson = undefined;
      this.scanError = 'Rapport de scan pas encore disponible : le job est en cours.';
    } else if (this.isSonarJob(latest)) {
      this.selectedJobScanJson = undefined;
      this.scanError = 'Les résultats SonarQube sont disponibles dans le tableau de bord SonarQube.';
    } else if (!this.isScanArtifactJob(latest)) {
      this.selectedJobScanJson = undefined;
      this.scanError = null;
    } else {
      this.pipelineService
        .getScanResults(latest.id)
        .pipe(catchError(() => of(null)))
        .subscribe(json => {
          if (json != null) {
            this.selectedJobScanJson = json;
            this.scanError = null;
          } else {
            this.selectedJobScanJson = undefined;
            this.scanError = 'Aucun rapport JSON publié pour ce job.';
          }
        });
    }
  }

  /** Jobs qui publient un artefact JSON de scan (Trivy, Semgrep, etc.). */
  isScanArtifactJob(job?: PipelineJobInfo): boolean {
    const name = (job?.name || '').toLowerCase();
    const stage = (job?.stage || '').toLowerCase();
    const keywords = [
      'trivy', 'semgrep', 'hadolint', 'gitleaks', 'grype', 'checkov', 'syft',
      'aggregate', 'sast', 'sca', 'secrets', 'iac', 'container-scan', 'dependency'
    ];
    if (keywords.some(k => name.includes(k) || stage.includes(k))) {
      return true;
    }
    return stage.includes('scan') || stage.includes('reporting');
  }

  isSonarJob(job?: PipelineJobInfo): boolean {
    const name = (job?.name || '').toLowerCase();
    const stage = (job?.stage || '').toLowerCase();
    return name.includes('sonar') || stage.includes('sonar');
  }

  openSonarQubeDashboard(): void {
    const appId = this.route.snapshot.queryParamMap.get('appId');
    if (appId) {
      this.router.navigate(['/project', appId, 'sonarqube']);
    } else {
      this.router.navigate(['/project', 'sonarqube']);
    }
  }

  openSecurityDashboard(): void {
    const queryParams: Record<string, string> = {};
    if (this.data?.ref) queryParams['branch'] = this.data.ref;
    if (this.data?.pipelineId) {
      queryParams['pipelineId'] = String(this.data.pipelineId);
    }

    if (this.managedAppContext && this.contextAppId) {
      this.router.navigate(['/projects', this.contextAppId, 'defectdojo'], { queryParams });
      return;
    }

    const appId =
      this.contextAppId ||
      this.route.snapshot.queryParamMap.get('appId') ||
      localStorage.getItem('envirotest-last-project-app-id');
    if (!appId) {
      this.router.navigate(['/projects']);
      return;
    }
    this.router.navigate(['/project', appId, 'security-dashboard'], { queryParams });
  }

  retryJob(jobId: number): void {
    if (!jobId) return;
    this.pipelineService.retryJob(jobId).subscribe({
      next: () => {
        if (this.toastService) {
          this.toastService.push('success', 'Job relancé', `Le job #${jobId} a été relancé.`, 2500);
        }
        // Refresh immédiat + polling va continuer si le pipeline est encore en cours
        this.refreshPipelineLive(() => this.ensurePolling());
      },
      error: () => {
        if (this.toastService) {
          this.toastService.push('error', 'Retry impossible', `Impossible de relancer le job #${jobId}.`, 3000);
        }
      }
    });
  }

  isRunning(): boolean {
    const st = this.normStatus(this.data?.status);
    if (st === 'RUNNING' || st === 'PENDING') return true;
    // Important: le status pipeline peut être en retard en BDD-first,
    // on garde donc le polling tant qu'il y a des jobs created/pending/running.
    const jobs = this.data?.jobs || [];
    return jobs.some(j => {
      const js = this.normStatus(j.status);
      return js === 'RUNNING' || js === 'PENDING';
    });
  }

  private normStatus(status: any): string {
    const s = String(status || '').trim().toUpperCase();
    // GitLab: "created" doit être considéré comme pending pour l'UI
    if (s === 'CREATED') return 'PENDING';
    return s;
  }

  jobCssStatus(status: any): 'success' | 'failed' | 'running' | 'muted' {
    const s = this.normStatus(status);
    if (s === 'SUCCESS') return 'success';
    if (s === 'FAILED' || s === 'CANCELED') return 'failed';
    if (s === 'RUNNING' || s === 'PENDING') return 'running';
    return 'muted';
  }

  displayStatus(status: any): string {
    return this.normStatus(status) || '—';
  }

  statusClass(status: string | undefined): string {
    switch (this.normStatus(status)) {
      case 'SUCCESS':
        return 'badge badge-success';
      case 'FAILED':
      case 'CANCELED':
        return 'badge badge-danger';
      case 'RUNNING':
      case 'PENDING':
        return 'badge badge-warning';
      default:
        return 'badge badge-muted';
    }
  }

  get pipelineKindLabel(): string {
    return this.pipelineKind === 'DEPLOY' ? 'DEPLOY' : this.pipelineKind === 'SCAN' ? 'SCAN' : '';
  }

  private inferPipelineKind(jobs: PipelineJobInfo[]): 'SCAN' | 'DEPLOY' | null {
    if (!jobs?.length) return null;
    const hay = jobs.map(j => `${j.stage || ''} ${j.name || ''}`.toLowerCase()).join(' ');
    if (hay.includes('deploy-k8s') || hay.includes('deploy:') || hay.includes('push-image') || hay.includes('build-image')) {
      return 'DEPLOY';
    }
    if (hay.includes('semgrep') || hay.includes('gitleaks') || hay.includes('code-analysis') || hay.includes('sca') || hay.includes('sast')) {
      return 'SCAN';
    }
    return null;
  }

  getStages(): Array<{ name: string; jobs: PipelineJobInfo[]; status: string }> {
    const jobs = this.normalizeJobs(this.data?.jobs);
    if (!jobs.length) return [];

    const stageMap = new Map<string, PipelineJobInfo[]>();
    jobs.forEach(job => {
      const stage = (job.stage || 'unknown').trim() || 'unknown';
      if (!stageMap.has(stage)) {
        stageMap.set(stage, []);
      }
      stageMap.get(stage)!.push(job);
    });

    // Jobs d'un même stage : id croissant (ordre d'apparition GitLab)
    stageMap.forEach(list => list.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0)));

    // Ordre CI (.gitlab-ci.yml) — pas l'ordre d'insertion GitLab / retry
    const stageNames = sortStageNames(Array.from(stageMap.keys()), (stage) =>
      Math.min(...(stageMap.get(stage) || []).map(j => j.id ?? 0))
    );

    return stageNames.map((name) => {
      const stageJobs = stageMap.get(name) || [];
      const statuses = stageJobs.map(j => this.normStatus(j.status));
      let overallStatus = 'SUCCESS';
      if (statuses.some(s => s === 'FAILED' || s === 'CANCELED')) {
        overallStatus = 'FAILED';
      } else if (statuses.some(s => s === 'RUNNING' || s === 'PENDING' || s === 'CREATED')) {
        overallStatus = 'RUNNING';
      } else if (statuses.every(s => s === 'SKIPPED' || s === 'MANUAL')) {
        overallStatus = 'SKIPPED';
      } else if (statuses.some(s => s === 'SKIPPED') && !statuses.some(s => s === 'SUCCESS' || s === 'PASSED')) {
        overallStatus = 'SKIPPED';
      }
      return { name, jobs: stageJobs, status: overallStatus };
    });
  }

  /** Sélectionne un job en échec et pose directement la question « pourquoi » — raccourci 1 clic. */
  selectJobAndExplain(job: PipelineJobInfo, event: Event): void {
    event.stopPropagation();
    this.selectJob(job, true);
    const waitForLogsThenAsk = () => {
      if (!this.loadingJob) {
        this.sendChatMessage('Pourquoi ce job a échoué ?');
        return;
      }
      setTimeout(waitForLogsThenAsk, 250);
    };
    setTimeout(waitForLogsThenAsk, 250);
  }

  /** Annule tout le pipeline (GitLab) — bouton header, visible tant qu'il tourne. */
  cancelPipeline(): void {
    const pipelineId = this.data?.pipelineId;
    if (!pipelineId || !confirm('Arrêter ce pipeline ? Les jobs en cours seront annulés.')) return;
    this.pipelineService.cancelPipeline(pipelineId).subscribe({
      next: () => {
        this.toastService?.push('success', 'Pipeline arrêté', `Pipeline #${pipelineId} annulé.`, 3000);
        this.refreshPipelineLive();
      },
      error: () => {
        this.toastService?.push('error', 'Arrêt impossible', `Impossible d'annuler le pipeline #${pipelineId}.`, 3500);
      }
    });
  }

  /** Annule uniquement les jobs en cours/en attente d'un stage — sans toucher au reste du pipeline. */
  cancelStage(stage: { name: string; jobs: PipelineJobInfo[] }, event: Event): void {
    event.stopPropagation();
    const jobs = (stage?.jobs || []).filter(j => {
      const s = this.normStatus(j.status);
      return s === 'RUNNING' || s === 'PENDING';
    });
    if (!jobs.length) {
      this.toastService?.push('info', 'Rien à arrêter', 'Ce stage n’a aucun job en cours.', 2500);
      return;
    }
    if (!confirm(`Arrêter le stage « ${stage.name} » (${jobs.length} job${jobs.length > 1 ? 's' : ''} en cours) ?`)) return;
    jobs.forEach(j => {
      this.pipelineService.cancelJob(j.id).subscribe({
        next: () => this.refreshPipelineLive(),
        error: () => {
          this.toastService?.push('error', 'Arrêt impossible', `Impossible d'annuler le job #${j.id}.`, 3000);
        }
      });
    });
  }

  /** Stages verts repliés par défaut (rien à surveiller) — évite de scroller une longue page pour rien. */
  isStageCollapsed(stage: { name: string; status: string }): boolean {
    const override = this.stageOverrides.get(stage.name);
    if (override != null) return !override;
    const s = this.normStatus(stage.status);
    return s === 'SUCCESS' || s === 'SKIPPED';
  }

  toggleStage(stage: { name: string; status: string }): void {
    this.stageOverrides.set(stage.name, this.isStageCollapsed(stage));
  }

  /** Relance tous les jobs échoués/annulés d’un stage. */
  retryStage(stage: { name: string; jobs: PipelineJobInfo[] }): void {
    const jobs = (stage?.jobs || []).filter(j => ['FAILED', 'CANCELED'].includes(this.normStatus(j.status)));
    if (!jobs.length) {
      if (this.toastService) {
        this.toastService.push('info', 'Aucun job à relancer', 'Ce stage ne contient aucun job en échec/annulé.', 2500);
      }
      return;
    }
    jobs.forEach(j => this.retryJob(j.id));
  }

  /** Auto-follow : affiche le 1er job RUNNING (ou PENDING), sauf si l'utilisateur a cliqué manuellement. */
  private autoFollowRunningJob(): void {
    const jobs = this.normalizeJobs(this.data?.jobs);
    if (!jobs.length) return;

    const active = this.getActiveRunningJob();

    if (!this.jobSelectionPinned && active) {
      if (this.selectedJob?.id !== active.id) {
        this.selectJob(active, false);
        this.autoScrollToSelectedJob();
        return;
      }
    }

    if (this.selectedJob?.id) {
      const current = jobs.find(j => j.id === this.selectedJob!.id);
      if (!current) {
        if (!this.jobSelectionPinned && active) {
          this.selectJob(active, false);
          this.autoScrollToSelectedJob();
        }
        return;
      }
      this.selectedJob = current;
      const st = this.normStatus(current.status);
      if (!this.jobSelectionPinned && st !== 'RUNNING' && st !== 'PENDING' && active) {
        this.selectJob(active, false);
        this.autoScrollToSelectedJob();
        return;
      }
      this.refreshSelectedJobLogsIfRunning();
      return;
    }

    if (active) {
      this.selectJob(active, false);
      this.autoScrollToSelectedJob();
    }
  }

  /** Premier job RUNNING, sinon premier PENDING (tri par id). */
  private getActiveRunningJob(): PipelineJobInfo | undefined {
    const active = this.normalizeJobs(this.data?.jobs)
      .filter(j => {
        const s = this.normStatus(j.status);
        return s === 'RUNNING' || s === 'PENDING';
      })
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return active.find(j => this.normStatus(j.status) === 'RUNNING') ?? active[0];
  }

  /** Nettoie les codes ANSI / préfixes GitLab (filet de sécurité côté UI). */
  private cleanJobLogs(raw: string): string {
    if (!raw) return '';
    let out = raw
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u001B[@-_]/g, '')
      .replace(/\[(?:\d{1,4}(?:;\d{1,4})*)?[mGKHfABCDEFJSTsu]/g, '')
      .replace(/section_start:\d+:[^\r\n]*/g, '')
      .replace(/section_end:\d+:[^\r\n]*/g, '')
      // HH:mm:ss + offset hex (000, 010, 000+) — avec ou sans espace après le +
      .replace(/^(\d{2}:\d{2}:\d{2})(?:\.\d+)? [0-9A-Fa-f]{3}\+?\s*/gm, '$1 ')
      .replace(/^[0-9A-Fa-f]{3}\+?\s*/gm, '');
    out = this.stripLogFractionalSeconds(out);
    out = out.split('\n').map(line => {
      const idx = line.lastIndexOf('\r');
      return (idx >= 0 ? line.slice(idx + 1) : line).replace(/\s+$/, '');
    }).filter(line => line.length > 0).join('\n');
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Supprime les fractions de secondes dans les logs (20:35:10.549 → 20:35:10, 12.47s → 12s). */
  private stripLogFractionalSeconds(text: string): string {
    return text
      .replace(/\b(\d{2}:\d{2}:\d{2})\.\d+\b/g, '$1')
      .replace(/\b(\d+)\.\d+(?=s\b)/gi, '$1')
      .replace(/\b(\d+)\.\d+(?=\s+seconds?\b)/gi, '$1')
      .replace(/\b(\d+)\.\d{4,}\b/g, '$1')
      .replace(/\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})\.\d+Z?/g, '$1');
  }

  /** Recharge les logs du job sélectionné s'il est encore en cours. */
  private refreshSelectedJobLogsIfRunning(): void {
    if (!this.selectedJob?.id) return;
    const st = this.normStatus(this.selectedJob.status);
    if (st !== 'PENDING' && st !== 'RUNNING') return;

    this.pipelineService.getJobLogs(this.selectedJob.id).subscribe({
      next: logs => {
        this.selectedJobLogs = this.cleanJobLogs(logs);
        this.jobLogsError = null;
        this.loadingJob = false;
        this.scrollLogsToBottom();
      },
      error: () => {
        // silencieux pendant l'exécution
      }
    });
  }

  /** Suit le bas des logs tant que l'utilisateur n'a pas remonté manuellement (logsFollowing). */
  private scrollLogsToBottom(): void {
    if (!this.logsFollowing) return;
    const el = this.logsConsoleEl?.nativeElement;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  /** Coupe le suivi auto si l'utilisateur remonte manuellement ; le réactive s'il revient en bas. */
  onLogsScroll(): void {
    const el = this.logsConsoleEl?.nativeElement;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.logsFollowing = distanceFromBottom < 40;
  }

  resumeLogsFollow(): void {
    this.logsFollowing = true;
    this.scrollLogsToBottom();
  }

  get selectedJobRunning(): boolean {
    const st = this.normStatus(this.selectedJob?.status);
    return st === 'RUNNING' || st === 'PENDING';
  }

  private autoScrollToSelectedJob(): void {
    const id = this.selectedJob?.id;
    if (!id) return;
    if (this.lastAutoScrollJobId === id) return;
    this.lastAutoScrollJobId = id;
    setTimeout(() => {
      try {
        const el = document.querySelector('.jobs-list li.selected') as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}
    }, 0);
  }

  formatDuration(seconds: number | undefined): string {
    if (seconds == null || Number.isNaN(seconds)) return '—';
    const total = Math.floor(Number(seconds));
    if (total <= 0) return '0s';
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}m ${s}s`;
  }

  /** Logs colorés façon GitLab (accent orange sur commandes / sections / git). */
  formatLogsForDisplay(raw: string | undefined): SafeHtml {
    if (!raw) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    const html = raw
      .split('\n')
      .map(line => this.formatLogLineHtml(line))
      .join('\n');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  private formatLogLineHtml(line: string): string {
    if (!line) {
      return '<span class="log-line log-line-default">&nbsp;</span>';
    }
    let timeHtml = '';
    let message = line;
    const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2})(?:\.\d+)?\s+(.*)$/);
    if (timeMatch) {
      timeHtml = `<span class="log-time">${this.escapeHtml(timeMatch[1])}</span> `;
      message = timeMatch[2].replace(/^[0-9A-Fa-f]{3}\+?\s*/, '');
    }
    const cls = this.logLineClass(message);
    return `<span class="log-line ${cls}">${timeHtml}${this.escapeHtml(message)}</span>`;
  }

  /** Lignes accent (équivalent vert/cyan GitLab) → orange dans notre UI. */
  private logLineClass(text: string): string {
    const t = text.trim();
    if (!t) return 'log-line-default';

    if (/\bJob succeeded\b/i.test(t)) return 'log-line-success';
    if (/\b(ERROR|FAILED|FATAL)\b/.test(t)) return 'log-line-error';
    if (/\b(WARNING|WARN)\b/.test(t)) return 'log-line-warn';
    if (/^INFO[:\s]/i.test(t)) return 'log-line-info';

    // Métadonnées techniques (blanc sur GitLab) → gris neutre
    if (/^(https?:\/\/|storage\.googleapis|correlation_id=|sha256:|status=\d{3}\b|token=glcbt-)/i.test(t)) {
      return 'log-line-default';
    }

    if (this.isGitLabAccentLine(t)) {
      const bold = /^(Downloading artifacts|Executing )/i.test(t);
      return bold ? 'log-line-accent log-line-accent-bold' : 'log-line-accent';
    }

    return 'log-line-default';
  }

  private isGitLabAccentLine(t: string): boolean {
    const prefixPatterns = [
      /^\$ /,
      /^git /i,
      /^Fetching changes/i,
      /^Checking out/i,
      /^Skipping Git/i,
      /^Initialized empty/i,
      /^Created fresh/i,
      /^Reinitialized/i,
      /^From https?:/i,
      /^remote:/i,
      /^Cloning /i,
      /^Updating /i,
      /^Submodule/i,
      /^Switched to/i,
      /^Downloading artifacts/i,
      /^Executing /i,
      /^Getting source/i,
      /^Preparing /i,
      /^Running with/i,
      /^Pulling docker/i,
      /^Using Docker/i,
      /^Using 'docker/i,
      /^Using cache/i,
      /^Cleaning up/i,
      /^Uploading /i,
      /^Saving cache/i,
      /^Creating cache/i,
      /^Entering /i,
      /^cd /i,
      /^sonar-scanner/i,
      /^if \[/i,
      /^echo /i,
      /^apk /i,
      /^curl /i,
      /^trivy /i,
      /^semgrep /i,
      /^pip /i,
      /^npm /i,
      /^mvn /i,
      /^docker /i,
    ];
    if (prefixPatterns.some(p => p.test(t))) {
      return true;
    }

    const containsPatterns = [
      /detached HEAD/i,
      /Git repository/i,
      /artifacts for/i,
      /step_script/i,
      /multi-line command/i,
      /remote set-url/i,
      /clone-repository/i,
      /empty repository/i,
      /repository in \//i,
    ];
    return containsPatterns.some(p => p.test(t));
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  hasVulnerabilities(scanJson: any): boolean {
    if (!scanJson) return false;
    return scanJson.vulnerabilities?.length > 0 || 
           scanJson.Vulnerabilities?.length > 0 ||
           scanJson.results?.some((r: any) => r.Vulnerabilities?.length > 0);
  }

  countVulnerabilities(scanJson: any): number {
    if (!scanJson) return 0;
    if (scanJson.vulnerabilities) return scanJson.vulnerabilities.length;
    if (scanJson.Vulnerabilities) return scanJson.Vulnerabilities.length;
    if (scanJson.results) {
      return scanJson.results.reduce((sum: number, r: any) => 
        sum + (r.Vulnerabilities?.length || 0), 0);
    }
    return 0;
  }

  /** Envoie l'artifact du job sélectionné à l'IA pour analyse (vulnérabilités + remédiations). */
  analyzeWithAi(): void {
    if (!this.selectedJobScanJson || !this.selectedJob) return;
    this.aiAnalysisLoading = true;
    this.aiAnalysisError = null;
    this.aiAnalysisResult = null;
    const artifactContent = typeof this.selectedJobScanJson === 'string'
      ? this.selectedJobScanJson
      : JSON.stringify(this.selectedJobScanJson, null, 0);
    const artifactSource = this.guessArtifactSource(this.selectedJob.name);
    this.aiAnalysisService.analyzeArtifact({ artifactContent, artifactSource }).subscribe({
      next: res => {
        this.aiAnalysisResult = res;
        this.aiAnalysisLoading = false;
        this.toastService?.push('success', 'Analyse IA', 'Résultats disponibles.', 3000);
      },
      error: err => {
        this.aiAnalysisLoading = false;
        this.aiAnalysisError = err.error?.message || err.message || 'Erreur lors de l\'analyse IA.';
        this.toastService?.push('error', 'Analyse IA', this.aiAnalysisError ?? 'Erreur inconnue', 5000);
      }
    });
  }

  private guessArtifactSource(jobName: string): string {
    const n = (jobName || '').toLowerCase();
    if (n.includes('sonar')) return 'sonarqube';
    if (n.includes('owasp-dependency') || n.includes('dependency-check') || n.includes('maven-dependency-check')) {
      return 'dependency-check';
    }
    if (n.includes('trivy-image') || n.includes('image-scan')) return 'trivy';
    if (n.includes('trivy')) return 'trivy';
    if (n.includes('npm-audit') || n.includes('pip-audit') || n.includes('safety')) return 'trivy';
    if (n.includes('gitleaks')) return 'gitleaks';
    if (n.includes('semgrep') || n.includes('safe-analysis') || n.includes('sast')) return 'sast';
    if (n.includes('checkov')) return 'checkov';
    return '';
  }

  severityClass(severity: string): string {
    const s = (severity || '').toUpperCase();
    if (s.includes('CRITICAL')) return 'ai-sev-critical';
    if (s.includes('HIGH')) return 'ai-sev-high';
    if (s.includes('MEDIUM')) return 'ai-sev-medium';
    if (s.includes('LOW')) return 'ai-sev-low';
    return 'ai-sev-info';
  }

  /** Bouton « Demander » — envoie le texte tapé dans le champ libre et vide le champ. */
  submitTypedQuestion(): void {
    const text = (this.logAiQuestion || '').trim();
    if (!text) return;
    this.logAiQuestion = '';
    this.sendChatMessage(text);
  }

  /**
   * Vraie conversation (historique conservé, pas une question isolée à chaque fois — retour
   * utilisateur du 17 août 2026) et streamée (SSE) : le texte s'affiche au fil de l'eau au lieu
   * d'attendre la réponse complète — bien plus supportable quand le secours Ollama local (CPU)
   * prend 1-2 min à répondre.
   */
  sendChatMessage(question: string): void {
    const text = (question || '').trim();
    if (!text || this.logAiLoading) return;

    this.logAiLoading = true;
    this.logAiError = null;
    // Tours précédents AVANT d'ajouter ce nouvel échange (l'historique envoyé au backend).
    const history: ChatTurn[] = this.chatMessages
      .filter(m => m.text.trim().length > 0)
      .map(m => ({ role: m.role, content: m.text }));

    this.chatMessages.push({ role: 'user', text });
    const assistantMsg: ChatMessage = { role: 'assistant', text: '' };
    this.chatMessages.push(assistantMsg);
    const reveal = this.createSmoothReveal(assistantMsg);

    const stagesOverview = this.getStages()
      .map(s => `${s.name}=${(s.status || '').toLowerCase()}`)
      .join('; ');

    let firstChunk = true;
    this.aiAnalysisService.streamExplainPipelineLogs({
      logs: this.selectedJobLogs || undefined,
      jobName: this.selectedJob?.name,
      stageName: this.selectedJob?.stage,
      jobStatus: this.selectedJob?.status,
      pipelineKind: this.pipelineKind || undefined,
      stagesOverview,
      projectHint: 'EnviroTest — pipeline GitLab multi-services',
      projectContext: this.buildAiProjectContext(),
      userQuestion: text,
      history
    },
    (deep) => {
      assistantMsg.deep = deep;
    },
    (chunk) => {
      if (firstChunk) {
        firstChunk = false;
        setTimeout(() => {
          try {
            const thread = document.querySelector('.ai-chat-thread');
            thread?.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
          } catch { /* ignore */ }
        }, 50);
      }
      reveal.push(chunk);
    },
    () => {
      this.logAiLoading = false;
      // Le lissage continue de dérouler ce qui reste en file à son propre rythme — inutile de
      // forcer l'affichage instantané ici, ça casserait l'effet « texte qui coule ».
      this.cdr.detectChanges();
    },
    (message) => {
      reveal.cancel();
      this.logAiLoading = false;
      this.logAiError = message;
      const idx = this.chatMessages.indexOf(assistantMsg);
      if (idx >= 0) this.chatMessages.splice(idx, 1);
      this.toastService?.push('error', 'Assistant pipeline', message, 5000);
      this.cdr.detectChanges();
    });
  }

  /**
   * Affiche le texte au rythme régulier d'une machine à écrire, indépendamment de la façon dont
   * il arrive du réseau (un gros paquet d'un coup si le cache Ollama répond vite, ou plein de
   * petits — dans les deux cas ça « coule » à l'écran au lieu d'apparaître en bloc — retour
   * utilisateur du 17 août 2026 : « y a pas de streaming, des blocs d'écriture s'affichent »).
   * Volontairement rapide (~600 car/s) pour ne jamais ralentir perceptiblement une réponse déjà là.
   */
  private createSmoothReveal(msg: ChatMessage): { push: (text: string) => void; cancel: () => void } {
    let queue = '';
    let timer: ReturnType<typeof setInterval> | null = null;
    const CHARS_PER_TICK = 6;
    const TICK_MS = 10;

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const tick = () => {
      if (!queue.length) {
        stop();
        return;
      }
      msg.text += queue.slice(0, CHARS_PER_TICK);
      queue = queue.slice(CHARS_PER_TICK);
      this.cdr.detectChanges();
    };
    return {
      push: (text: string) => {
        queue += text;
        if (!timer) {
          timer = setInterval(tick, TICK_MS);
        }
      },
      cancel: () => {
        stop();
        queue = '';
      }
    };
  }

  private buildAiProjectContext(): string {
    const lines: string[] = [];
    lines.push(`contextAppId: ${this.contextAppId || '—'}`);
    lines.push(`managedApp: ${this.managedAppContext}`);
    lines.push(`envId: ${this.envId || '—'}`);
    lines.push(`pipelineId: ${this.data?.pipelineId ?? this.pipelineIdOnly ?? '—'}`);
    lines.push(`pipelineStatus: ${this.data?.status || '—'}`);
    lines.push(`pipelineKind: ${this.pipelineKind || '—'}`);
    if (this.data?.webUrl) lines.push(`gitlabPipelineUrl: ${this.data.webUrl}`);
    const jobs = this.normalizeJobs(this.data?.jobs);
    if (jobs.length) {
      lines.push('jobs:');
      for (const j of jobs.slice(0, 20)) {
        lines.push(`  - ${j.stage || '?'}/${j.name}=${j.status}`);
      }
    }
    // État réel de l'orchestration du déploiement (namespace → BD → vagues → ingress) — donnée
    // déjà en base, pas une supposition. Donne à l'IA le même niveau d'info que celui utilisé
    // manuellement pour diagnostiquer un échec (retour utilisateur du 17 août 2026 : « il a accès
    // à des ressources comme vous ? »). Pas d'exécution de commandes, juste plus de contexte.
    if (this.pipelineKind === 'DEPLOY' && this.deployResult) {
      lines.push(`deploiementStatut: ${this.deployResult.status || '—'}`);
      const steps = this.deploySteps;
      if (steps.length) {
        lines.push('deploiementEtapes (ordre réel, avec statut) :');
        for (const s of steps) {
          const services = s.services?.length ? ` [${s.services.join(', ')}]` : '';
          lines.push(`  - ${s.label}${services} = ${s.status}`);
        }
      }
      const state = this.deployResult.servicesState as { ingressApplied?: boolean; ingressError?: string } | undefined;
      if (state?.ingressApplied != null) {
        lines.push(`ingressApplique: ${state.ingressApplied}${state.ingressError ? ' (erreur: ' + state.ingressError + ')' : ''}`);
      }
    }
    return lines.join('\n');
  }
}

