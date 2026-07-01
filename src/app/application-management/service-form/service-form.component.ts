import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  AppDatabaseModel,
  AppServiceModel,
  AppServiceRole,
  EnvVar,
  SECRET_MASK
} from '../../models/application-management/application-management.models';

@Component({
  selector: 'app-managed-service-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './service-form.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class ServiceFormComponent implements OnInit {
  @Input() service: AppServiceModel | null = null;
  @Input() databases: AppDatabaseModel[] = [];
  @Input() services: AppServiceModel[] = [];
  @Input() saving = false;
  @Input() error: string | null = null;
  @Output() save = new EventEmitter<AppServiceModel>();
  @Output() cancel = new EventEmitter<void>();

  roles: AppServiceRole[] = ['FRONTEND', 'BACKEND', 'WORKER'];
  form!: FormGroup;

  ngOnInit(): void {
    const s = this.service;
    this.form = new FormGroup({
      name: new FormControl(s?.name || '', [Validators.required]),
      role: new FormControl<AppServiceRole>(s?.role || 'FRONTEND', [Validators.required]),
      gitRepositoryUrl: new FormControl(s?.gitRepositoryUrl || '', [Validators.required]),
      gitToken: new FormControl(s?.hasGitToken ? SECRET_MASK : ''),
      gitBranch: new FormControl(s?.gitBranch || 'main'),
      dockerfilePath: new FormControl(s?.dockerfilePath || 'Dockerfile'),
      buildContext: new FormControl(s?.buildContext || '.'),
      exposedPort: new FormControl(s?.exposedPort || 8080, [Validators.required, Validators.min(1)]),
      dependsOnDatabaseId: new FormControl(s?.dependsOnDatabaseId || ''),
      dbUrlEnvVar: new FormControl(s?.dbUrlEnvVar || 'DATABASE_URL'),
      dependsOnServiceId: new FormControl(s?.dependsOnServiceId || ''),
      replicas: new FormControl(s?.replicas || 1, [Validators.min(1)]),
      healthCheckPath: new FormControl(s?.healthCheckPath || ''),
      cpuRequest: new FormControl(s?.cpuRequest || '100m'),
      cpuLimit: new FormControl(s?.cpuLimit || '500m'),
      memoryRequest: new FormControl(s?.memoryRequest || '128Mi'),
      memoryLimit: new FormControl(s?.memoryLimit || '512Mi'),
      envVars: new FormArray<FormGroup>([])
    });

    (s?.envVars || []).forEach((v) => this.envVars.push(this.buildEnvRow(v)));
  }

  get envVars(): FormArray<FormGroup> {
    return this.form.get('envVars') as FormArray<FormGroup>;
  }

  get selectableServices(): AppServiceModel[] {
    return this.services.filter((x) => !this.service || x.id !== this.service.id);
  }

  get hasLinkedDatabase(): boolean {
    return !!this.form?.get('dependsOnDatabaseId')?.value;
  }

  get showBackendWarning(): boolean {
    return this.form?.get('role')?.value === 'BACKEND' && !this.hasLinkedDatabase;
  }

  get isEdit(): boolean {
    return !!this.service?.id;
  }

  private buildEnvRow(v?: EnvVar): FormGroup {
    return new FormGroup({
      id: new FormControl(v?.id || null),
      varKey: new FormControl(v?.varKey || '', [Validators.required]),
      varValue: new FormControl(v?.isSecret ? SECRET_MASK : (v?.varValue || '')),
      isSecret: new FormControl(v?.isSecret || false)
    });
  }

  addEnvVar(): void {
    this.envVars.push(this.buildEnvRow());
  }

  removeEnvVar(i: number): void {
    this.envVars.removeAt(i);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.value;
    const envVars: EnvVar[] = (v.envVars || []).map((e: any) => {
      const row: EnvVar = { id: e.id || undefined, varKey: e.varKey, isSecret: !!e.isSecret };
      if (e.varValue !== undefined && e.varValue !== SECRET_MASK) {
        row.varValue = e.varValue;
      }
      return row;
    });

    const payload: AppServiceModel = {
      name: v.name,
      role: v.role,
      gitRepositoryUrl: v.gitRepositoryUrl,
      gitBranch: v.gitBranch || 'main',
      dockerfilePath: v.dockerfilePath || 'Dockerfile',
      buildContext: v.buildContext || '.',
      exposedPort: v.exposedPort,
      dependsOnDatabaseId: v.dependsOnDatabaseId || null,
      dbUrlEnvVar: v.dbUrlEnvVar || 'DATABASE_URL',
      dependsOnServiceId: v.dependsOnServiceId || null,
      replicas: v.replicas || 1,
      healthCheckPath: v.healthCheckPath || undefined,
      cpuRequest: v.cpuRequest || undefined,
      cpuLimit: v.cpuLimit || undefined,
      memoryRequest: v.memoryRequest || undefined,
      memoryLimit: v.memoryLimit || undefined,
      envVars
    };
    if (v.gitToken && v.gitToken !== SECRET_MASK) {
      payload.gitToken = v.gitToken;
    }
    this.save.emit(payload);
  }
}
