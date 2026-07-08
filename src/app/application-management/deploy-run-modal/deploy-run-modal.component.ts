import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface DeployRunParams {
  branch: string;
  sessionDurationHours: number;
}

/**
 * Petite modale pour confirmer / paramétrer une action (scan ou déploiement d'un service).
 */
@Component({
  selector: 'app-deploy-run-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './deploy-run-modal.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class DeployRunModalComponent implements OnInit {
  @Input() title = 'Confirmer le lancement';
  @Input() subtitle: string | null = null;
  @Input() actionLabel = 'Lancer';
  @Input() defaultBranch = 'main';
  @Input() defaultTtlHours = 4;
  @Input() showTtl = true;
  @Input() running = false;
  @Input() error: string | null = null;

  @Output() cancel = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<DeployRunParams>();

  branch = 'main';
  sessionDurationHours = 4;

  ngOnInit(): void {
    this.resetForm();
  }

  onConfirm(): void {
    const branch = (this.branch || '').trim() || this.defaultBranch || 'main';
    const sessionDurationHours = this.resolveSessionDurationHours();
    this.confirm.emit({ branch, sessionDurationHours });
  }

  private resetForm(): void {
    this.branch = (this.defaultBranch || 'main').trim() || 'main';
    this.sessionDurationHours = this.normalizeTtl(this.defaultTtlHours);
  }

  private resolveSessionDurationHours(): number {
    return this.normalizeTtl(this.sessionDurationHours);
  }

  private normalizeTtl(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return this.normalizeTtl(this.defaultTtlHours);
    }
    return Math.max(1, Math.min(Math.floor(parsed), 72));
  }
}