import { Component, OnInit } from '@angular/core';
import { ApplicationService } from '../services/application/application.service';
import { ApplicationResponse } from '../models/application/application-response';
import { Router } from '@angular/router';

@Component({
  selector: 'app-my-applications',
  templateUrl: './my-applications.component.html',
  styleUrls: ['./my-applications.component.css']
})
export class MyApplicationsComponent implements OnInit {

  applications: ApplicationResponse[] = [];
  loading = false;
  error: string | null = null;

  constructor(private appService: ApplicationService, private router: Router) {}

  ngOnInit(): void {
    this.loadApplications();
  }

  loadApplications(): void {
    this.loading = true;
    this.error = null;
    this.appService.getMyApplications().subscribe({
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
    this.router.navigate(['/environments']);
  }
}

