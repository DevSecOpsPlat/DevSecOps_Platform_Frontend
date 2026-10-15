import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { AdminActivityEvent } from '../../../services/admin/admin.service';

/** Libellés lisibles par type d'événement — cf. docs/audit-dashboard-admin.md et le plan de refonte
 * du dashboard admin (Phase 1). Étend ALERT_TYPE_LABELS (admin-alerts.component.ts, sécurité
 * uniquement) avec les types DEPLOYMENT_* et les événements de compte/pipeline, absents là-bas. */
const EVENT_TYPE_LABELS: Record<string, string> = {
  // Pipeline (PipelineStatus)
  PENDING: 'Pipeline en attente',
  RUNNING: 'Pipeline en cours',
  SUCCESS: 'Pipeline réussi',
  FAILED: 'Pipeline en échec',
  CANCELED: 'Pipeline annulé',
  SKIPPED: 'Pipeline ignoré',
  // Alertes sécurité
  LOGIN_FAILED: 'Connexion échouée',
  FAILED_LOGIN_REPEATED: 'Échecs répétés',
  ACCOUNT_LOCKED: 'Compte verrouillé',
  BRUTE_FORCE_DETECTED: 'Force brute IP',
  RATE_LIMIT_EXCEEDED: 'Rate limit dépassé',
  HONEYPOT_TRIGGERED: 'Honeypot déclenché',
  SUSPICIOUS_REQUEST: 'Requête suspecte',
  MALICIOUS_PAYLOAD: 'Payload malveillant',
  SUSPICIOUS_USER_AGENT: 'User-Agent suspect',
  IP_BLOCKED: 'IP bloquée',
  UNAUTHORIZED_ACCESS: 'Accès refusé',
  // Alertes déploiement
  DEPLOYMENT_CRASH_LOOP: 'Boucle de redémarrage',
  DEPLOYMENT_OOM: 'Mémoire insuffisante',
  DEPLOYMENT_POD_FAILED: 'Pod en échec',
  DEPLOYMENT_HEALTH_FAILED: 'Sonde de santé en échec',
  DEPLOYMENT_K8S_WARNING: 'Avertissement cluster',
  DEPLOYMENT_SYNC_RUNTIME: 'Modification à chaud',
  // Activité de compte
  ACCOUNT_CREATED: 'Compte créé',
  EMAIL_CHANGED: 'E-mail modifié',
  PASSWORD_CHANGED: 'Mot de passe modifié',
  ADMIN_EMAIL_CHANGED: 'E-mail modifié par l\'admin',
  ADMIN_PASSWORD_RESET: 'Mot de passe réinitialisé par l\'admin',
  ACCOUNT_DISABLED: 'Compte désactivé',
  ACCOUNT_ENABLED: 'Compte réactivé'
};

const KIND_ICON: Record<string, string> = {
  PIPELINE: '⚙️',
  ALERT: '⚠️',
  ACCOUNT: '👤'
};

@Component({
  selector: 'app-admin-activity-timeline',
  templateUrl: './admin-activity-timeline.component.html',
  styleUrls: ['./admin-activity-timeline.component.css']
})
export class AdminActivityTimelineComponent {
  @Input() events: AdminActivityEvent[] = [];
  @Input() emptyText = 'Aucune activité pour l\'instant.';

  constructor(private router: Router) {}

  label(e: AdminActivityEvent): string {
    return EVENT_TYPE_LABELS[e.eventType] ?? e.eventType;
  }

  icon(e: AdminActivityEvent): string {
    return KIND_ICON[e.kind] ?? '•';
  }

  severityClass(e: AdminActivityEvent): string {
    return 'sev-' + (e.severity || 'info').toLowerCase();
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
