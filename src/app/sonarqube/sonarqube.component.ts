import { Component, OnInit } from '@angular/core';
import { SonarQubeService } from '../services/sonarqube/sonarqube.service';

@Component({
  selector: 'app-sonarqube',
  templateUrl: './sonarqube.component.html',
  styleUrls: ['./sonarqube.component.css']
})
export class SonarqubeComponent implements OnInit {
  loading = true;
  error: string | null = null;

  metrics: any = null;
  totalIssues = 0;
  totalHotspots = 0;
  issues: any[] = [];
  hotspots: any[] = [];
  qualityGate: any = null;

  constructor(private sonarService: SonarQubeService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;

    this.sonarService.getSonarQubeResults().subscribe({
      next: (res) => {
        this.metrics = res.metrics || {};
        this.totalIssues = res.total_issues || 0;
        this.totalHotspots = res.total_hotspots || 0;
        this.issues = res.issues || [];
        this.hotspots = res.hotspots || [];
        this.qualityGate = res.quality_gate || null;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Impossible de charger les résultats SonarQube';
      }
    });
  }

  getQualityGateStatus(): string {
    return this.qualityGate?.status || 'UNKNOWN';
  }

  qualityGateClass(): string {
    const status = this.getQualityGateStatus().toUpperCase();
    if (status === 'OK') return 'qg-ok';
    if (status === 'ERROR') return 'qg-error';
    if (status === 'WARN') return 'qg-warn';
    return 'qg-unknown';
  }
}

