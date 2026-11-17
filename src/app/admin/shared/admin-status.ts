/**
 * Libellés français des statuts affichés dans la console admin. La couleur, elle, vient de la
 * classe `adm-badge--<statut en minuscules>` (admin-theme.css) : les deux restent indépendants.
 */
const ENVIRONMENT_STATUS: Record<string, string> = {
  PENDING: 'En attente',
  BUILDING: 'Construction',
  RUNNING: 'Actif',
  FAILED: 'Échec',
  DESTROYED: 'Détruit',
  EXPIRED: 'Expiré',
  STOPPED: 'Arrêté',
  UNKNOWN: 'Inconnu'
};

const PIPELINE_STATUS: Record<string, string> = {
  SUCCESS: 'Réussi',
  FAILED: 'Échec',
  RUNNING: 'En cours',
  PENDING: 'En attente',
  CANCELED: 'Annulé',
  SKIPPED: 'Ignoré'
};

const ACCOUNT_STATUS: Record<string, string> = {
  ACTIVE: 'Actif',
  DISABLED: 'Désactivé',
  PENDING: 'En attente d’activation'
};

function label(map: Record<string, string>, status: string | null | undefined): string {
  if (!status) return '—';
  return map[status.toUpperCase()] ?? status;
}

export function environmentStatusLabel(status: string | null | undefined): string {
  return label(ENVIRONMENT_STATUS, status);
}

export function pipelineStatusLabel(status: string | null | undefined): string {
  return label(PIPELINE_STATUS, status);
}

export function accountStatusLabel(status: string | null | undefined): string {
  return label(ACCOUNT_STATUS, status);
}

/** Suffixe de classe pour `adm-badge--…`. */
export function statusTone(status: string | null | undefined): string {
  return (status || 'unknown').toLowerCase();
}
