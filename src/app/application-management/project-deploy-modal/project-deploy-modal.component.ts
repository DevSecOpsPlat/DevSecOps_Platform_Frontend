import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AppDatabaseModel,
  AppServiceModel,
  DeployPreview
} from '../../models/application-management/application-management.models';

export interface ProjectDeployParams {
  branch: string;
  sessionDurationHours: number;
  serviceIds: string[];
  /** Optionnel — hostname Ingress (ex. demo.example.com). Vide = nip.io par défaut. */
  customHostname?: string | null;
}

/**
 * Modale de déploiement projet : TTL, branche, domaine optionnel, services, infos / warnings.
 */
@Component({
  selector: 'app-project-deploy-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-deploy-modal.component.html',
  styleUrls: ['../shared/app-management.shared.css', './project-deploy-modal.component.css']
})
export class ProjectDeployModalComponent implements OnChanges {
  @Input() services: AppServiceModel[] = [];
  @Input() databases: AppDatabaseModel[] = [];
  @Input() defaultBranch = 'main';
  @Input() defaultTtlHours = 4;
  @Input() defaultCustomHostname = '';
  @Input() preview: DeployPreview | null = null;
  @Input() previewLoading = false;
  @Input() running = false;
  @Input() error: string | null = null;

  @Output() cancel = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<ProjectDeployParams>();
  @Output() selectionChange = new EventEmitter<{
    branch: string;
    sessionDurationHours: number;
    serviceIds: string[];
  }>();

  branch = 'main';
  sessionDurationHours = 4;
  customHostname = '';
  selectedIds = new Set<string>();
  persistenceConfirmed = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['services'] && this.services?.length) {
      this.selectedIds = new Set(
        this.services.filter(s => !!s.id).map(s => s.id as string)
      );
      const firstBranch = this.services.find(s => s.gitBranch)?.gitBranch;
      this.branch = (this.defaultBranch || firstBranch || 'main').trim() || 'main';
      this.sessionDurationHours = this.normalizeTtl(this.defaultTtlHours);
      this.customHostname = (this.defaultCustomHostname || '').trim();
      this.persistenceConfirmed = false;
      this.emitSelection();
    }
    if (changes['defaultBranch'] && !changes['services']) {
      this.branch = (this.defaultBranch || 'main').trim() || 'main';
    }
    if (changes['defaultTtlHours'] && !changes['services']) {
      this.sessionDurationHours = this.normalizeTtl(this.defaultTtlHours);
    }
    if (changes['defaultCustomHostname'] && !changes['services']) {
      this.customHostname = (this.defaultCustomHostname || '').trim();
    }
  }

  /** BDs liées aux services cochés — incluses automatiquement (pas de sélection séparée). */
  get includedDatabases(): AppDatabaseModel[] {
    const dbIds = new Set(
      this.services
        .filter(s => !!s.id && this.selectedIds.has(s.id) && !!s.dependsOnDatabaseId)
        .map(s => s.dependsOnDatabaseId as string)
    );
    return (this.databases || []).filter(d => !!d.id && dbIds.has(d.id));
  }

  isSelected(id: string | undefined): boolean {
    return !!id && this.selectedIds.has(id);
  }

  toggleService(id: string | undefined): void {
    if (!id) return;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.persistenceConfirmed = false;
    this.emitSelection();
  }

  selectAll(): void {
    this.selectedIds = new Set(this.services.filter(s => !!s.id).map(s => s.id as string));
    this.persistenceConfirmed = false;
    this.emitSelection();
  }

  selectNone(): void {
    this.selectedIds = new Set();
    this.persistenceConfirmed = false;
    this.emitSelection();
  }

  onTtlOrBranchChange(): void {
    this.emitSelection();
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  get canConfirm(): boolean {
    if (this.running || this.previewLoading) return false;
    if (this.selectedCount === 0) return false;
    if (this.preview?.blockingErrors?.length) return false;
    if (this.preview?.requiresConfirmation && !this.persistenceConfirmed) return false;
    return true;
  }

  onConfirm(): void {
    if (!this.canConfirm) return;
    const host = (this.customHostname || '').trim();
    this.confirm.emit({
      branch: (this.branch || '').trim() || this.defaultBranch || 'main',
      sessionDurationHours: this.normalizeTtl(this.sessionDurationHours),
      serviceIds: Array.from(this.selectedIds),
      customHostname: host || null
    });
  }

  roleClass(role: string): string {
    return 'role-' + (role || '').toLowerCase();
  }

  private emitSelection(): void {
    this.selectionChange.emit({
      branch: (this.branch || '').trim() || this.defaultBranch || 'main',
      sessionDurationHours: this.normalizeTtl(this.sessionDurationHours),
      serviceIds: Array.from(this.selectedIds)
    });
  }

  private normalizeTtl(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 4;
    }
    return Math.max(1, Math.min(Math.floor(parsed), 72));
  }
}
