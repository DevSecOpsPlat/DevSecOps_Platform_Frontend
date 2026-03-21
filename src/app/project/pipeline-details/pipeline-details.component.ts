import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
export class PipelineDetailsComponent implements OnInit {

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

  loadPipeline(): void {
    this.loading = true;
    this.error = null;
    this.pipelineService.getPipelineAndScan(this.envId).subscribe({
      next: res => {
        this.data = res;
        this.loading = false;
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
        this.jobLogsError = this.data?.dataSource === 'database'
          ? 'Logs non disponibles : les données sont affichées depuis la base de données (GitLab indisponible). Les logs ne sont pas stockés en BDD.'
          : 'Logs non disponibles. GitLab est peut-être indisponible ou les logs ont été purgés.';
      }
    });

    this.pipelineService.getScanResults(job.id).subscribe({
      next: json => {
        this.selectedJobScanJson = json;
        this.scanError = null;
      },
      error: () => {
        this.scanError = this.data?.dataSource === 'database'
          ? 'Rapport de scan non disponible (données depuis la BDD, GitLab indisponible).'
          : 'Rapport de scan non disponible (GitLab indisponible ou job sans artifact).';
      }
    });
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

  isRunning(): boolean {
    return this.data?.status === 'running' || this.data?.status === 'PENDING';
  }

  statusClass(status: string | undefined): string {
    switch ((status || '').toUpperCase()) {
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
    const stageMap = new Map<string, PipelineJobInfo[]>();
    this.data.jobs.forEach(job => {
      const stage = job.stage || 'unknown';
      if (!stageMap.has(stage)) {
        stageMap.set(stage, []);
      }
      stageMap.get(stage)!.push(job);
    });
    return Array.from(stageMap.entries()).map(([name, jobs]) => {
      const statuses = jobs.map(j => j.status?.toLowerCase() || 'unknown');
      let overallStatus = 'success';
      if (statuses.some(s => s === 'failed' || s === 'canceled')) {
        overallStatus = 'failed';
      } else if (statuses.some(s => s === 'running' || s === 'pending')) {
        overallStatus = 'running';
      }
      return { name, jobs, status: overallStatus };
    });
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
    if (n.includes('trivy') || n.includes('dependency')) return 'trivy';
    if (n.includes('sast') || n.includes('owasp')) return 'sast';
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

