import { Component, OnInit } from '@angular/core';
import { ApplicationService } from '../services/application/application.service';
import { ApplicationResponse } from '../models/application/application-response';

@Component({
  selector: 'app-applications-active',
  templateUrl: './applications-active.component.html',
  styleUrls: ['./applications-active.component.css']
})
export class ApplicationsActiveComponent implements OnInit {
  applications: ApplicationResponse[] = [];
  loading = false;
  error: string | null = null;

  constructor(private applicationService: ApplicationService) {}

  ngOnInit(): void {
    this.loadApplications();
  }

  loadApplications(): void {
    this.loading = true;
    this.error = null;
    this.applicationService.getMyApplications().subscribe({
      next: apps => {
        // Placeholder: consider all apps as active for now
        this.applications = apps;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement des applications actives';
      }
    });
  }
}

