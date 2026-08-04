import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppServiceModel } from '../../models/application-management/application-management.models';

export interface AppScanParams {
  branch: string;
  serviceIds: string[];
}

/**
 * Modale scan application : branche + sélection des services (pas forcément tous).
 */
@Component({
  selector: 'app-app-scan-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app-scan-modal.component.html',
  styleUrls: ['../shared/app-management.shared.css', './app-scan-modal.component.css']
})
export class AppScanModalComponent implements OnChanges {
  @Input() services: AppServiceModel[] = [];
  @Input() defaultBranch = 'main';
  @Input() running = false;
  @Input() error: string | null = null;

  @Output() cancel = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<AppScanParams>();

  branch = 'main';
  selectedIds = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['services'] && this.services?.length) {
      this.selectedIds = new Set(
        this.services.filter(s => !!s.id).map(s => s.id as string)
      );
      const firstBranch = this.services.find(s => s.gitBranch)?.gitBranch;
      this.branch = (this.defaultBranch || firstBranch || 'main').trim() || 'main';
    }
    if (changes['defaultBranch'] && !changes['services']) {
      this.branch = (this.defaultBranch || 'main').trim() || 'main';
    }
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  get canConfirm(): boolean {
    return !this.running && this.selectedCount > 0 && !!(this.branch || '').trim();
  }

  isSelected(id: string | undefined): boolean {
    return !!id && this.selectedIds.has(id);
  }

  toggleService(id: string | undefined): void {
    if (!id || this.running) return;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.selectedIds = new Set(this.selectedIds);
  }

  selectAll(): void {
    this.selectedIds = new Set(
      this.services.filter(s => !!s.id).map(s => s.id as string)
    );
  }

  selectNone(): void {
    this.selectedIds = new Set();
  }

  roleClass(role: string): string {
    return 'role-' + (role || '').toLowerCase();
  }

  onConfirm(): void {
    if (!this.canConfirm) return;
    this.confirm.emit({
      branch: (this.branch || '').trim() || 'main',
      serviceIds: [...this.selectedIds]
    });
  }
}
