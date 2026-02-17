import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PipelineService } from '../services/pipeline/pipeline.service';
import { PipelineScanResponse, PipelineJobInfo } from '../models/pipeline/pipeline-scan-response';

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
  loadingJob = false;

  constructor(
    private route: ActivatedRoute,
    private pipelineService: PipelineService
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
        this.error = err.error?.message || 'Erreur lors du chargement du pipeline';
      }
    });
  }

  selectJob(job: PipelineJobInfo): void {
    this.selectedJob = job;
    this.selectedJobLogs = undefined;
    this.selectedJobScanJson = undefined;
    this.loadingJob = true;

    this.pipelineService.getJobLogs(job.id).subscribe({
      next: logs => {
        this.selectedJobLogs = logs;
        this.loadingJob = false;
      },
      error: () => {
        this.loadingJob = false;
      }
    });

    this.pipelineService.getScanResults(job.id).subscribe({
      next: json => {
        this.selectedJobScanJson = json;
      },
      error: () => {
        // scan JSON optionnel
      }
    });
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
}

