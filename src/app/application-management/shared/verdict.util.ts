/** Libellés / classes verdict — dashboard app & hub service (annexe C5). */

export type VerdictTone = 'ok' | 'warn' | 'bad' | 'unknown';

export function verdictTone(verdict: string | null | undefined): VerdictTone {
  const v = (verdict || '').toUpperCase();
  if (v.includes('NOT_RECOMMENDED') || v.includes('NON_RECOMMAND')) return 'bad';
  if (v.includes('INDETERMINE') || v.includes('INCOMPLET') || v.includes('PARTIAL')) return 'unknown';
  if (v.includes('WARN')) return 'warn';
  if (v.includes('RECOMMENDED') || v.includes('RECOMMAND')) return 'ok';
  return 'unknown';
}

/** Pastille en toutes lettres (FR). */
export function verdictLabelFr(verdict: string | null | undefined): string {
  switch (verdictTone(verdict)) {
    case 'bad':
      return 'Déploiement non recommandé';
    case 'warn':
      return 'Déployable avec réserves';
    case 'ok':
      return 'Déploiement recommandé';
    default:
      return 'Verdict incomplet';
  }
}

export function isHardBlocked(verdict: string | null | undefined): boolean {
  return verdictTone(verdict) === 'bad';
}
