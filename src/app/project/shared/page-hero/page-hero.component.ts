import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * En-tête unifié (bandeau bleu foncé) pour les pages service qui n'en avaient pas, ou qui en
 * avaient un séparé/dupliqué de leur propre bloc de titre — reprend telle quelle l'identité
 * visuelle de l'en-tête "Runtime & environnements" (application-detail.component.css,
 * .ad-hero--identity.ad-hero--runtime), demandée comme modèle unique pour Quality Gate (service),
 * Pipelines, Déploiements et Post-déploiement (retour utilisateur du 31 août 2026).
 *
 * Les actions (boutons, sélecteurs) se projettent via [hero-actions] plutôt que d'être un Input,
 * pour rester libres par page (un bouton "Actualiser" partout, mais pas seulement).
 */
@Component({
  selector: 'app-page-hero',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './page-hero.component.html',
  styleUrls: ['./page-hero.component.css']
})
export class PageHeroComponent {
  @Input() eyebrow = '';
  @Input() title = '';
  @Input() description = '';
}
