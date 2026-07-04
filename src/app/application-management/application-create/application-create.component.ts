import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';

@Component({
  selector: 'app-managed-application-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './application-create.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class ApplicationCreateComponent {
  submitting = false;
  error: string | null = null;

  form = new FormGroup({
    name: new FormControl('', [Validators.required, Validators.maxLength(200)]),
    description: new FormControl('')
  });

  constructor(private api: ApplicationManagementService, private router: Router) {}

  back(): void {
    this.router.navigate(['/projects']);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.error = null;
    this.api.create({
      name: this.form.value.name!,
      description: this.form.value.description || undefined
    }).subscribe({
      next: (app) => this.router.navigate(['/projects', app.id]),
      error: (e) => {
        this.error = e?.error?.message || 'Création impossible.';
        this.submitting = false;
      }
    });
  }
}
