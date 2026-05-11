import { Component, OnInit, OnDestroy } from '@angular/core';
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
  private lastAutoSelectedJobId?: number;
  private lastAutoScrollJobId?: number;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private pipelineService: PipelineService,
    private toastService: ToastService,
    private aiAnalysisService: AiAnalysisService
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

  loadPipeline(): void {
    this.loading = true;
    this.error = null;
    this.pipelineService.getPipelineAndScan(this.envId).subscribe({
      next: res => {
        this.data = res;
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

  private ensurePolling(): void {
    const running = this.isRunning();
    if (!running) {
      if (this.pollId) {
        clearInterval(this.pollId);
        this.pollId = undefined;
      }
      return;
    }
    if (this.pollId) return;
    // Poll léger (BDD-first + refresh async) pour suivre l’avancement sans bloquer l’UI
    this.pollId = setInterval(() => {
      if (!this.envId) return;
      this.pipelineService.getPipelineAndScanLive(this.envId).subscribe({
        next: (res) => {
          this.data = res;
          this.autoFollowRunningJob();
          // stop auto si terminé
          if (!this.isRunning()) {
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

  selectJob(job: PipelineJobInfo): void {
    if (this.selectedJob?.id === job.id) {
      return;
    }
    this.selectedJob = job;
    this.selectedJobLogs = undefined;
    this.selectedJobScanJson = undefined;
    this.jobLogsError = null;
    this.scanError = null;
    this.aiAnalysisResult = null;
    this.aiAnalysisError = null;
    this.loadingJob = true;

    this.pipelineService.getJobLogs(job.id).subscribe({
      next: logs => {
        this.selectedJobLogs = logs;
        this.jobLogsError = null;
        this.loadingJob = false;
      },
      error: () => {
        this.loadingJob = false;
        const st = this.normStatus(job.status);
        this.jobLogsError = (st === 'PENDING' || st === 'RUNNING')
          ? 'Logs pas encore disponibles : le job est en cours.'
          : 'Logs indisponibles pour ce job.';
      }
    });

    const st = this.normStatus(job.status);
    if (st === 'PENDING' || st === 'RUNNING') {
      this.selectedJobScanJson = undefined;
      this.scanError = 'Rapport de scan pas encore disponible : le job est en cours.';
    } else {
      this.pipelineService
        .getScanResults(job.id)
        .pipe(catchError(() => of(null)))
        .subscribe(json => {
          if (json != null) {
            this.selectedJobScanJson = json;
            this.scanError = null;
          } else {
            this.selectedJobScanJson = undefined;
            this.scanError = null;
          }
        });
    }
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

  openVulnerabilitiesDashboard(): void {
    if (!this.envId) return;
    const appId =
      this.route.snapshot.queryParamMap.get('appId') ||
      localStorage.getItem('envirotest-last-project-app-id');
    if (appId) {
      this.router.navigate(['/project', appId, 'vulnerabilities'], {
        queryParams: { envId: this.envId }
      });
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
            this.data = res;
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
    if (!this.data?.jobs) return [];
    // Stabiliser l'ordre: GitLab renvoie parfois les jobs dans un ordre non chronologique.
    const jobsSorted = [...this.data.jobs].sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0));
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

  /** Auto-follow: sélectionne automatiquement le job en cours et charge ses logs. */
  private autoFollowRunningJob(): void {
    const jobsRaw = this.data?.jobs || [];
    if (!jobsRaw.length) return;
    // Choisir le job "actif" le plus tôt (id le plus petit) pour ne pas sauter vers le dernier stage.
    const active = jobsRaw
      .filter(j => ['RUNNING', 'PENDING'].includes(this.normStatus(j.status)) && j?.id != null)
      .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
    // Fallback: premier job (id le plus petit)
    const first = [...jobsRaw].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))[0];
    const candidate = active || first;
    if (!candidate?.id) return;
    if (this.selectedJob?.id === candidate.id) return;
    if (active && this.lastAutoSelectedJobId === candidate.id) return;
    this.lastAutoSelectedJobId = candidate.id;
    this.selectJob(candidate);
    this.autoScrollToSelectedJob();
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
    if (!seconds) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
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

