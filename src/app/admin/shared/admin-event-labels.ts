/** Libellés lisibles par type d'événement — cf. docs/audit-dashboard-admin.md et le plan de refonte
 * du dashboard admin (Phase 1). Étend ALERT_TYPE_LABELS (admin-alerts.component.ts, sécurité
 * uniquement) avec les types DEPLOYMENT_* et les événements de compte/pipeline, absents là-bas.
 * Partagé par le fil d'activité et la section « Attention requise » de la vue d'ensemble. */
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

export function adminEventLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}
