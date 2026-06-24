import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApplicationService } from '../../services/application/application.service';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import { PipelineService } from '../../services/pipeline/pipeline.service';
import { SecuritySummaryResponse } from '../../models/pipeline/security-summary-response';

@Component({
  selector: 'app-project-security',
  templateUrl: './project-security.component.html',
  styleUrls: ['./project-security.component.css']
})
export class ProjectSecurityComponent implements OnInit {

  appId: string | null = null;
  deployments: DeploymentHistoryItem[] = [];
  selectedEnvId: string | null = null;
  securitySummary: SecuritySummaryResponse | null = null;
  loading = true;
  loadingSecurity = false;

  constructor(
    private route: ActivatedRoute,
    private applicationService: ApplicationService,
    private pipelineService: PipelineService
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
    this.applicationService.getDeploymentHistory(this.appId).subscribe({
      next: items => {
        this.deployments = items;
        this.loading = false;
        if (items.length > 0 && !this.selectedEnvId) {
          this.selectEnvironment(items[0].environmentId);
        }
      },
      error: () => { this.loading = false; }
    });
  }

  selectEnvironment(envId: string): void {
    this.selectedEnvId = envId;
    this.loadSecuritySummary(envId);
  }

  loadSecuritySummary(envId: string): void {
    this.loadingSecurity = true;
    this.securitySummary = null;
    this.pipelineService.getSecuritySummary(envId).subscribe({
      next: res => {
        this.securitySummary = res;
        this.loadingSecurity = false;
      },
      error: () => { this.loadingSecurity = false; }
    });
  }

  viewFullPipeline(envId: string): void {
    window.location.href = `/pipeline/${envId}`;
  }

  get totalVulnerabilities(): number {
    const s = this.securitySummary;
    if (!s) return 0;
    return (s.critical || 0) + (s.high || 0) + (s.medium || 0) + (s.low || 0) + (s.info || 0);
  }

  get donutStyle(): { [key: string]: string } {
    const total = this.totalVulnerabilities;
    if (!total) {
      return {
        background: 'conic-gradient(#1e293b 0deg 360deg)'
      };
    }
    const s = this.securitySummary!;
    const critAngle = ((s.critical || 0) / total) * 360;
    const highAngle = ((s.high || 0) / total) * 360;
    const medAngle = ((s.medium || 0) / total) * 360;
    const lowAngle = ((s.low || 0) / total) * 360;
    const infoAngle = ((s.info || 0) / total) * 360;

    const a1 = critAngle;
    const a2 = a1 + highAngle;
    const a3 = a2 + medAngle;
    const a4 = a3 + lowAngle;
    const a5 = 360;

    return {
      background: `conic-gradient(
        #b91c1c 0deg ${a1}deg,
        #c2410c ${a1}deg ${a2}deg,
        #b45309 ${a2}deg ${a3}deg,
        #1d4ed8 ${a3}deg ${a4}deg,
        #475569 ${a4}deg ${a5}deg
      )`
    };
  }
}
