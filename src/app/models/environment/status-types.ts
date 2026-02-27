// status-types.ts
export const ENVIRONMENT_STATUS = {
  ACTIVE: ['RUNNING'],
  IN_PROGRESS: ['PENDING', 'BUILDING'],
  TERMINATED: ['FAILED', 'DESTROYED', 'EXPIRED']
} as const;

export const PIPELINE_STATUS = {
  ACTIVE: ['RUNNING', 'PENDING'],
  FINISHED: ['SUCCESS', 'FAILED', 'CANCELED'],
  SUCCESS: ['SUCCESS'],
  FAILED: ['FAILED', 'CANCELED']
} as const;

export type EnvironmentStatusType = keyof typeof ENVIRONMENT_STATUS;
export type PipelineStatusType = keyof typeof PIPELINE_STATUS;

export function getEnvironmentStatusIcon(status: string): string {
  const s = status?.toUpperCase() || '';
  switch(s) {
    case 'RUNNING': return '✅';
    case 'BUILDING': return '🔨';
    case 'PENDING': return '⏳';
    case 'FAILED': return '❌';
    case 'DESTROYED': return '🗑️';
    case 'EXPIRED': return '⏰';
    default: return '•';
  }
}

export function getEnvironmentStatusDescription(status: string): string {
  const s = status?.toUpperCase() || '';
  switch(s) {
    case 'RUNNING': return 'Actif';
    case 'BUILDING': return 'En construction';
    case 'PENDING': return 'En attente';
    case 'FAILED': return 'Échec';
    case 'DESTROYED': return 'Détruit';
    case 'EXPIRED': return 'Expiré';
    default: return 'Inconnu';
  }
}

export function getPipelineStatusIcon(status: string): string {
  const s = status?.toUpperCase() || '';
  switch(s) {
    case 'SUCCESS': return '✅';
    case 'FAILED': return '❌';
    case 'CANCELED': return '⛔';
    case 'RUNNING': return '🔄';
    case 'PENDING': return '⏳';
    default: return '•';
  }
}