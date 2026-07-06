import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { PipelineScanResponse, PipelineJobInfo } from '../../models/pipeline/pipeline-scan-response';
import { ToastService } from 'src/app/services/ui/toast.service';
import { AiAnalysisService } from '../../services/ai/ai-analysis.service';
import { AnalyzeArtifactResponse } from '../../models/ai/analyze-artifact.model';

@Component({
  selector: 'app-pipeline-details',
  templateUrl: './pipeline-details.component.html',
  styleUrls: ['./pipeline-details.component.css']
})
export class PipelineDetailsComponent implements OnInit, OnDestroy {

  envId!: string;
  data?: PipelineScanResponse;
  loading = false;
  error: string | null = null;

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

  private pollId?: any;
  private lastAutoScrollJobId?: number;
  /** true = l'utilisateur a cliqué manuellement sur un job (pas de suivi auto). */
  private jobSelectionPinned = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private pipelineService: PipelineService,
    private toastService: ToastService,
    private aiAnalysisService: AiAnalysisService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.envId = this.route.snapshot.paramMap.get('envId') || '';
    if (this.envId) {
      this.loadPipeline();
    } else {
      this.error = 'Environnement invalide';
    }
  }

  ngOnDestroy(): void {
    if (this.pollId) {
      clearInterval(this.pollId);
      this.pollId = undefined;
    }
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
      if (!this.envId) return;
      this.pipelineService.getPipelineAndScanLive(this.envId).subscribe({
        next: (res) => {
          this.applyPipelineUpdate(res);
          this.autoFollowRunningJob();
          if (!this.shouldPoll()) {
            clearInterval(this.pollId);
            this.pollId = undefined;
          }
        },
        error: () => {
          // silencieux: on garde les dernières infos affichées
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
    this.router.navigate(['/pipelines']);
  }

  selectJob(job: PipelineJobInfo, fromUserClick = true): void {
    if (fromUserClick) {
      this.jobSelectionPinned = true;
    }

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
    this.loadingJob = true;

    this.pipelineService.getJobLogs(latest.id).subscribe({
      next: logs => {
        this.selectedJobLogs = this.cleanJobLogs(logs);
        this.jobLogsError = null;
        this.loadingJob = false;
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
    if (!this.envId) return;
    const appId =
      this.route.snapshot.queryParamMap.get('appId') ||
      localStorage.getItem('envirotest-last-project-app-id');
    if (appId) {
      this.router.navigate(['/project', appId, 'security-dashboard']);
    } else {
      this.router.navigate(['/my-applications']);
    }
  }

  retryJob(jobId: number): void {
    if (!jobId) return;
    this.pipelineService.retryJob(jobId).subscribe({
      next: () => {
        if (this.toastService) {
          this.toastService.push('success', 'Job relancé', `Le job #${jobId} a été relancé.`, 2500);
        }
        // Refresh immédiat + polling va continuer si le pipeline est encore en cours
        this.pipelineService.getPipelineAndScanLive(this.envId).subscribe({
          next: (res) => {
            this.applyPipelineUpdate(res);
            this.autoFollowRunningJob();
            this.ensurePolling();
          },
          error: () => {}
        });
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

  getStages(): Array<{ name: string; jobs: PipelineJobInfo[]; status: string }> {
    const jobsSorted = this.normalizeJobs(this.data?.jobs)
      .sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0));
    if (!jobsSorted.length) return [];
    const stageOrder: string[] = [];
    const stageMap = new Map<string, PipelineJobInfo[]>();
    jobsSorted.forEach(job => {
      const stage = job.stage || 'unknown';
      if (!stageOrder.includes(stage)) stageOrder.push(stage);
      if (!stageMap.has(stage)) {
        stageMap.set(stage, []);
      }
      stageMap.get(stage)!.push(job);
    });
    return stageOrder.map((name) => {
      const jobs = stageMap.get(name) || [];
      const statuses = jobs.map(j => this.normStatus(j.status));
      let overallStatus = 'SUCCESS';
      if (statuses.some(s => s === 'FAILED' || s === 'CANCELED')) {
        overallStatus = 'FAILED';
      } else if (statuses.some(s => s === 'RUNNING' || s === 'PENDING')) {
        overallStatus = 'RUNNING';
      } else if (statuses.some(s => s === 'SKIPPED')) {
        overallStatus = 'SKIPPED';
      }
      return { name, jobs, status: overallStatus };
    });
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
      },
      error: () => {
        // silencieux pendant l'exécution
      }
    });
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
}

