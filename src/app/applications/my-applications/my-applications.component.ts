import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ApplicationResponse } from 'src/app/models/application/application-response';
import { ApplicationService } from 'src/app/services/application/application.service';

@Component({
  selector: 'app-my-applications',
  templateUrl: './my-applications.component.html',
  styleUrls: ['./my-applications.component.css']
})
export class MyApplicationsComponent implements OnInit {

  applications: ApplicationResponse[] = [];
  loading = false;
  error: string | null = null;

  constructor(private applicationService: ApplicationService, private router: Router) {}

  ngOnInit(): void {
    this.loadApplications();
  }

  loadApplications(): void {
    this.loading = true;
    this.error = null;
    this.applicationService.getMyApplications().subscribe({
      next: apps => {
        this.applications = apps;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement des applications';
      }
    });
  }

  openEnvironments(): void {
    this.router.navigate(['/environment-create']);
  }

  openProject(app: ApplicationResponse): void {
    this.router.navigate(['/project', app.id, 'security-center']);
  }
}

