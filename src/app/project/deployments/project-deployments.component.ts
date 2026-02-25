import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApplicationService } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/application/deployment-history-item';

@Component({
  selector: 'app-project-deployments',
  templateUrl: './project-deployments.component.html',
  styleUrls: ['./project-deployments.component.css']
})
export class ProjectDeploymentsComponent implements OnInit {

  appId: string | null = null;
  deployments: DeploymentHistoryItem[] = [];
  loading = true;
  branchFilter = '';

  constructor(
    private route: ActivatedRoute,
    private applicationService: ApplicationService
  ) {}

  ngOnInit(): void {
    this.appId = this.route.parent?.snapshot.paramMap.get('appId') || null;
    if (this.appId) {
      this.loadDeployments();
    }
  }

  loadDeployments(): void {
    if (!this.appId) return;
    this.loading = true;
    this.applicationService.getDeploymentHistory(this.appId, this.branchFilter || undefined).subscribe({
      next: items => {
        this.deployments = items;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  onBranchFilterChange(): void {
    this.loadDeployments();
  }

  statusClass(status: string): string {
    const s = (status || '').toUpperCase();
    if (s === 'SUCCESS') return 'status-success';
    if (s === 'FAILED' || s === 'CANCELED') return 'status-danger';
    if (s === 'RUNNING' || s === 'PENDING') return 'status-warning';
    return 'status-muted';
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  viewPipeline(envId: string): void {
    window.location.href = `/pipeline/${envId}`;
  }
}
