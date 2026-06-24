import { Component } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { DeployRequest } from 'src/app/models/deployment/deploy-request';
import { EnvironmentService } from 'src/app/services/environment/environment.service';

@Component({
  selector: 'app-environment-create',
  templateUrl: './environment-create.component.html',
  styleUrls: ['./environment-create.component.css']
})
export class EnvironmentCreateComponent {

  form: FormGroup;
  errorMessage: string | null = null;
  successResult: { environmentId: string; applicationId?: string; pipelineWebUrl: string; environmentName: string } | null = null;
  loading = false;

  constructor(private environmentService: EnvironmentService) {
    this.form = new FormGroup({
      gitRepositoryUrl: new FormControl('', [Validators.required]),
      branch: new FormControl('main', [Validators.required]),
      sessionDurationHours: new FormControl(4, [Validators.required, Validators.min(1), Validators.max(72)]),
      githubToken: new FormControl('')
    });
  }

  deploy(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage = null;
    this.successResult = null;
    this.loading = true;

    const value = this.form.value;
    const request: DeployRequest = {
      gitRepositoryUrl: value.gitRepositoryUrl?.trim() ?? '',
      branch: value.branch?.trim() ?? 'main',
      sessionDurationHours: value.sessionDurationHours ?? 4,
      githubToken: value.githubToken?.trim() || undefined
    };

    this.environmentService.deploy(request).subscribe({
      next: (res) => {
        this.loading = false;
        this.successResult = {
          environmentId: res.environmentId,
          applicationId: res.applicationId,
          pipelineWebUrl: res.pipelineWebUrl,
          environmentName: res.environmentName
        };
      },
      error: (err) => {
        this.loading = false;
        this.errorMessage = err.error?.message || err.message || 'Erreur lors du déploiement';
      }
    });
  }
}
