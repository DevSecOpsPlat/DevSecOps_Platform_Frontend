import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { ProjectFormComponent, ProjectFormPayload } from '../project-form/project-form.component';

@Component({
  selector: 'app-managed-application-create',
  standalone: true,
  imports: [CommonModule, ProjectFormComponent],
  templateUrl: './application-create.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class ApplicationCreateComponent {
  submitting = false;
  error: string | null = null;

  constructor(private api: ApplicationManagementService, private router: Router) {}

  back(): void {
    this.router.navigate(['/projects']);
  }

  submit(payload: ProjectFormPayload): void {
    this.submitting = true;
    this.error = null;
    this.api.create(payload).subscribe({
      next: (app) => this.router.navigate(['/projects', app.id]),
      error: (e) => {
        this.error = e?.error?.message || 'Création impossible.';
        this.submitting = false;
      }
    });
  }
}
