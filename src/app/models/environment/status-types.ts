// status-types.ts v2 — pipeline CI et état K8s sont indépendants

export const ENVIRONMENT_STATUS = {
  ALIVE: ['PENDING', 'BUILDING', 'RUNNING', 'DEGRADED'] as const,
  ACTIVE: ['RUNNING', 'DEGRADED'] as const,
  IN_PROGRESS: ['PENDING', 'BUILDING'] as const,
  NEVER_STARTED: ['FAILED'] as const,
  ENDED: ['EXPIRED', 'DESTROYED'] as const,
  TERMINATED: ['FAILED', 'DESTROYED', 'EXPIRED'] as const,
} as const;

export const PIPELINE_STATUS = {
  ACTIVE: ['RUNNING', 'PENDING'] as const,
  FINISHED: ['SUCCESS', 'FAILED', 'CANCELED'] as const,
  SUCCESS: ['SUCCESS'] as const,
  FAILED: ['FAILED', 'CANCELED'] as const,
} as const;

export type EnvironmentStatusType = keyof typeof ENVIRONMENT_STATUS;
export type PipelineStatusType = keyof typeof PIPELINE_STATUS;

export interface EnvironmentStatusView {
  label: string;
  icon: string;
  cssClass: string;
  canShowUrl: boolean;
  showCountdown: boolean;
  isPipelineIndependent: boolean;
}

export function environmentStatusView(status: string | undefined | null): EnvironmentStatusView {
  const s = (status || '').toUpperCase();
  switch (s) {
    case 'RUNNING':
      return {
        label: 'En ligne',
        icon: '✅',
        cssClass: 'env-status-active',
        canShowUrl: true,
        showCountdown: true,
        isPipelineIndependent: true,
      };
    case 'DEGRADED':
      return {
        label: 'Dégradé',
        icon: '⚠️',
        cssClass: 'env-status-degraded',
        canShowUrl: false,
        showCountdown: true,
        isPipelineIndependent: true,
      };
    case 'BUILDING':
      return {
        label: 'Construction',
        icon: '🔨',
        cssClass: 'env-status-building',
        canShowUrl: false,
        showCountdown: true,
        isPipelineIndependent: true,
      };
    case 'PENDING':
      return {
        label: 'En attente',
        icon: '⏳',
        cssClass: 'env-status-building',
        canShowUrl: false,
        showCountdown: true,
        isPipelineIndependent: true,
      };
    case 'FAILED':
      return {
        label: 'Échec',
        icon: '❌',
        cssClass: 'env-status-failed',
        canShowUrl: false,
        showCountdown: false,
        isPipelineIndependent: true,
      };
    case 'EXPIRED':
      return {
        label: 'Expiré',
        icon: '⏰',
        cssClass: 'env-status-expired',
        canShowUrl: false,
        showCountdown: false,
        isPipelineIndependent: true,
      };
    case 'DESTROYED':
      return {
        label: 'Détruit',
        icon: '🗑️',
        cssClass: 'env-status-destroyed',
        canShowUrl: false,
        showCountdown: false,
        isPipelineIndependent: true,
      };
    default:
      return {
        label: 'Inconnu',
        icon: '•',
        cssClass: 'env-status-default',
        canShowUrl: false,
        showCountdown: false,
        isPipelineIndependent: true,
      };
  }
}

export function getEnvironmentStatusIcon(status: string): string {
  return environmentStatusView(status).icon;
}

export function getEnvironmentStatusDescription(status: string): string {
  return environmentStatusView(status).label;
}

export function getPipelineStatusIcon(status: string): string {
  const s = status?.toUpperCase() || '';
  switch (s) {
    case 'SUCCESS': return '✅';
    case 'FAILED': return '❌';
    case 'CANCELED': return '⛔';
    case 'RUNNING': return '🔄';
    case 'PENDING': return '⏳';
    default: return '•';
  }
}

export function getPipelineStatusLabel(status: string): string {
  const s = status?.toUpperCase() || '';
  switch (s) {
    case 'SUCCESS': return 'Réussi';
    case 'FAILED': return 'Échoué';
    case 'CANCELED': return 'Annulé';
    case 'RUNNING': return 'En cours';
    case 'PENDING': return 'En attente';
    default: return s || 'Inconnu';
  }
}

/** Groupes de filtre UI (overview + page déploiements). */
export type EnvironmentFilterGroup =
  | 'ACTIVE'
  | 'IN_PROGRESS'
  | 'DEGRADED'
  | 'NEVER_STARTED'
  | 'ENDED'
  | 'TERMINATED';

export const ENVIRONMENT_FILTER_OPTIONS: Array<{
  id: EnvironmentFilterGroup | null;
  label: string;
  icon: string;
  title: string;
}> = [
  { id: null, label: 'Tous', icon: '', title: 'Tous les environnements' },
  { id: 'ACTIVE', label: 'En ligne', icon: '✅', title: 'RUNNING et DEGRADED' },
  { id: 'IN_PROGRESS', label: 'En cours', icon: '🔄', title: 'PENDING et BUILDING' },
  { id: 'DEGRADED', label: 'Dégradé', icon: '⚠️', title: 'Pods non prêts' },
  { id: 'NEVER_STARTED', label: 'Échec', icon: '❌', title: 'N\'a jamais démarré (FAILED)' },
  { id: 'ENDED', label: 'Terminés', icon: '⏰', title: 'EXPIRED et DESTROYED' },
];

export function matchesEnvironmentFilter(
  envStatus: string | undefined | null,
  filter: string | null | undefined
): boolean {
  if (!filter) return true;
  const s = (envStatus || '').toUpperCase();
  return filter.split(',').some(raw => {
    const key = raw.trim().toUpperCase();
    if (!key) return true;
    if (key === 'TERMINATED') {
      return (ENVIRONMENT_STATUS.TERMINATED as readonly string[]).includes(s);
    }
    const group = ENVIRONMENT_STATUS[key as keyof typeof ENVIRONMENT_STATUS];
    if (group) {
      return (group as readonly string[]).includes(s);
    }
    return s === key;
  });
}

export function environmentStatusFilterLabel(filter: string | null | undefined): string {
  if (!filter) return 'Tous';
  const opt = ENVIRONMENT_FILTER_OPTIONS.find(o => o.id === filter);
  return opt?.label ?? filter;
}
