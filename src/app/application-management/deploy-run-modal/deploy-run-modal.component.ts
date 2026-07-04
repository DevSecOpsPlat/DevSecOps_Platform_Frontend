import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface DeployRunParams {
  branch: string;
  sessionDurationHours: number;
}

/**
 * Petite modale pour confirmer / paramétrer une action (scan ou déploiement d'un service).
 * Reste volontairement simple : l'écrasante majorité des champs (repo, token, dockerfile,
 * ports, dépendances) est déjà persistée sur le service — l'utilisateur n'a plus qu'à
 * (éventuellement) surcharger branche + TTL.
 */
@Component({
  selector: 'app-deploy-run-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './deploy-run-modal.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class DeployRunModalComponent {
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

  branch = '';
  ttl = 4;

  ngOnInit(): void {
    this.branch = this.defaultBranch;
    this.ttl = this.defaultTtlHours;
  }

  onConfirm(): void {
    const branch = (this.branch || '').trim() || this.defaultBranch;
    const ttl = Math.max(1, Math.min(this.ttl || this.defaultTtlHours, 72));
    this.confirm.emit({ branch, sessionDurationHours: ttl });
  }
}
