import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Modal de confirmation réutilisable, alignée sur le thème orange/navy.
 * Usage :
 * <app-confirm-modal
 *   *ngIf="showConfirm"
 *   title="Supprimer le service"
 *   message="Cette action est irréversible."
 *   confirmLabel="Supprimer"
 *   danger="true"
 *   (confirm)="onDelete()"
 *   (cancel)="showConfirm = false">
 * </app-confirm-modal>
 */
@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="am-modal-backdrop" (click)="onBackdropClick($event)">
      <div class="am-modal" role="dialog" aria-modal="true">
        <h3 class="am-modal-title">{{ title }}</h3>
        <p style="color: var(--am-muted); margin: 0 0 1.5rem 0; line-height: 1.5;">
          {{ message }}
        </p>
        <div class="am-form-actions">
          <button type="button" class="am-btn am-btn-secondary" (click)="cancel.emit()">
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="am-btn"
            [class.am-btn-danger]="danger"
            [class.am-btn-primary]="!danger"
            (click)="confirm.emit()">
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfirmModalComponent {
  @Input() title = 'Confirmer';
  @Input() message = 'Êtes-vous sûr ?';
  @Input() confirmLabel = 'Confirmer';
  @Input() cancelLabel = 'Annuler';
  @Input() danger = false;
  @Input() closeOnBackdrop = true;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onBackdropClick(event: MouseEvent): void {
    if (this.closeOnBackdrop && event.target === event.currentTarget) {
      this.cancel.emit();
    }
  }
}