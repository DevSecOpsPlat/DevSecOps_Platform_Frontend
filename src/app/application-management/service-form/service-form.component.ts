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

const GIT_HTTPS = /^https:\/\/.+/i;
const RELATIVE_PATH = /^(?!\/)(?!.*\.\.)(?!-)[A-Za-z0-9._/\-]+$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  localError: string | null = null;

  ngOnInit(): void {
    const s = this.service;
    const role: AppServiceRole = s?.role || 'FRONTEND';
    this.form = new FormGroup({
      name: new FormControl(s?.name || '', [Validators.required, Validators.maxLength(80)]),
      role: new FormControl<AppServiceRole>(role, [Validators.required]),
      gitRepositoryUrl: new FormControl(s?.gitRepositoryUrl || '', [
        Validators.required,
        Validators.pattern(GIT_HTTPS)
      ]),
      gitToken: new FormControl(s?.hasGitToken ? SECRET_MASK : ''),
      gitBranch: new FormControl(s?.gitBranch || 'main'),
      dockerfilePath: new FormControl(s?.dockerfilePath || 'Dockerfile', [
        Validators.pattern(RELATIVE_PATH)
      ]),
      buildContext: new FormControl(s?.buildContext || '.', [
        Validators.pattern(RELATIVE_PATH)
      ]),
      exposedPort: new FormControl(s?.exposedPort ?? 8080, []),
      dependsOnDatabaseId: new FormControl(s?.dependsOnDatabaseId || ''),
      dbUrlEnvVar: new FormControl(s?.dbUrlEnvVar || 'DATABASE_URL'),
      dependsOnServiceId: new FormControl(s?.dependsOnServiceId || ''),
      replicas: new FormControl(s?.replicas || 1, [Validators.min(1), Validators.max(5)]),
      healthCheckPath: new FormControl(s?.healthCheckPath || ''),
      cpuRequest: new FormControl(s?.cpuRequest || '100m'),
      cpuLimit: new FormControl(s?.cpuLimit || '500m'),
      memoryRequest: new FormControl(s?.memoryRequest || '128Mi'),
      memoryLimit: new FormControl(s?.memoryLimit || '512Mi'),
      envVars: new FormArray<FormGroup>([])
    });

    (s?.envVars || []).forEach((v) => this.envVars.push(this.buildEnvRow(v)));
    this.applyRoleConstraints(role);

    this.form.get('role')!.valueChanges.subscribe((r: AppServiceRole) => {
      this.applyRoleConstraints(r);
    });
  }

  get envVars(): FormArray<FormGroup> {
    return this.form.get('envVars') as FormArray<FormGroup>;
  }

  get role(): AppServiceRole {
    return this.form?.get('role')?.value as AppServiceRole;
  }

  get isWorker(): boolean {
    return this.role === 'WORKER';
  }

  get isFrontend(): boolean {
    return this.role === 'FRONTEND';
  }

  get canLinkDatabase(): boolean {
    return this.role === 'BACKEND' || this.role === 'WORKER';
  }

  get selectableServices(): AppServiceModel[] {
    return this.services.filter((x) => !this.service || x.id !== this.service.id);
  }

  get hasLinkedDatabase(): boolean {
    return !!this.form?.get('dependsOnDatabaseId')?.value;
  }

  get showBackendWarning(): boolean {
    return this.role === 'BACKEND' && !this.hasLinkedDatabase;
  }

  get isEdit(): boolean {
    return !!this.service?.id;
  }

  private applyRoleConstraints(role: AppServiceRole): void {
    const port = this.form.get('exposedPort')!;
    const health = this.form.get('healthCheckPath')!;
    const db = this.form.get('dependsOnDatabaseId')!;

    if (role === 'WORKER') {
      port.clearValidators();
      port.setValue(null, { emitEvent: false });
      health.setValue('', { emitEvent: false });
    } else {
      port.setValidators([
        Validators.required,
        Validators.min(1024),
        Validators.max(65535)
      ]);
      if (port.value == null) {
        port.setValue(8080, { emitEvent: false });
      }
    }

    if (role === 'FRONTEND') {
      db.setValue('', { emitEvent: false });
    }

    port.updateValueAndValidity({ emitEvent: false });
  }

  private buildEnvRow(v?: EnvVar): FormGroup {
    return new FormGroup({
      id: new FormControl(v?.id || null),
      varKey: new FormControl(v?.varKey || '', [
        Validators.required,
        Validators.pattern(ENV_KEY)
      ]),
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
    this.localError = null;
    this.applyRoleConstraints(this.role);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.localError = 'Corrigez les champs en rouge avant d’enregistrer.';
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

    // Collision dbUrlEnvVar vs variables manuelles
    if (this.canLinkDatabase && v.dependsOnDatabaseId) {
      const urlEnv = (v.dbUrlEnvVar || 'DATABASE_URL').trim();
      if (envVars.some(e => e.varKey === urlEnv)) {
        this.localError =
          `La variable « ${urlEnv} » est réservée à l’injection auto de l’URL de base. Retirez-la des variables manuelles.`;
        return;
      }
    }

    const payload: AppServiceModel = {
      name: (v.name || '').trim(),
      role: v.role,
      gitRepositoryUrl: (v.gitRepositoryUrl || '').trim(),
      gitBranch: v.gitBranch || 'main',
      dockerfilePath: v.dockerfilePath || 'Dockerfile',
      buildContext: v.buildContext || '.',
      exposedPort: this.isWorker ? undefined : Number(v.exposedPort),
      dependsOnDatabaseId: this.canLinkDatabase ? (v.dependsOnDatabaseId || null) : null,
      dbUrlEnvVar: this.canLinkDatabase ? (v.dbUrlEnvVar || 'DATABASE_URL') : undefined,
      dependsOnServiceId: v.dependsOnServiceId || null,
      replicas: v.replicas || 1,
      healthCheckPath: this.isWorker ? undefined : (v.healthCheckPath || undefined),
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
