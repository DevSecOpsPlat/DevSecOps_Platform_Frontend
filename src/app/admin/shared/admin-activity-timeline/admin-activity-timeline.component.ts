import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { AdminActivityEvent } from '../../../services/admin/admin.service';
import { adminEventLabel } from '../admin-event-labels';

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: 'danger',
  WARNING: 'warning',
  INFO: 'info'
};

@Component({
  selector: 'app-admin-activity-timeline',
  templateUrl: './admin-activity-timeline.component.html'
})
export class AdminActivityTimelineComponent {
  @Input() events: AdminActivityEvent[] = [];
  @Input() emptyText = 'Aucune activité pour l\'instant.';

  constructor(private router: Router) {}

  label(e: AdminActivityEvent): string {
    return adminEventLabel(e.eventType);
  }

  /** Couleur du repère : sévérité de l'événement, orange pour les pipelines sans sévérité. */
  tone(e: AdminActivityEvent): string {
    const sev = SEVERITY_TONE[(e.severity || '').toUpperCase()];
    if (sev) return sev;
    return e.kind === 'PIPELINE' ? 'accent' : 'info';
  }

  isClickable(e: AdminActivityEvent): boolean {
    return !!(e.applicationId || e.environmentId);
  }

  open(e: AdminActivityEvent): void {
    if (e.environmentId) {
      this.router.navigate(['/admin/environments', e.environmentId]);
    } else if (e.applicationId) {
      this.router.navigate(['/admin/applications', e.applicationId]);
    }
  }

  /** LocalDateTime backend sans @JsonFormat sérialise en tuple [an, mois, jour, h, min, s] plutôt
   * qu'en chaîne ISO — TimeAgoPipe n'accepte que string|Date, d'où cette conversion locale. */
  toDate(value: string | number[] | null | undefined): Date | null {
    if (!value) return null;
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (Array.isArray(value) && value.length >= 3) {
      const [y, m, d, h = 0, min = 0, s = 0] = value;
      return new Date(y, m - 1, d, h, min, s);
    }
    return null;
  }
}
