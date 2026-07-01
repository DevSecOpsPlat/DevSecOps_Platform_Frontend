import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { ManagedApp } from '../../models/application-management/application-management.models';

@Component({
  selector: 'app-managed-applications-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './applications-list.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class ApplicationsListComponent implements OnInit {
  apps: ManagedApp[] = [];
  loading = true;
  error: string | null = null;

  constructor(private api: ApplicationManagementService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.list().subscribe({
      next: (apps) => {
        this.apps = apps ?? [];
        this.loading = false;
      },
      error: () => {
        this.error = 'Impossible de charger les applications.';
        this.loading = false;
      }
    });
  }

  open(app: ManagedApp): void {
    this.router.navigate(['/app-management', app.id]);
  }

  create(): void {
    this.router.navigate(['/app-management/create']);
  }

  statusClass(app: ManagedApp): string {
    const s = app.lastDeployment?.status;
    if (!s) return 'status-none';
    return 'status-' + s.toLowerCase();
  }
}
