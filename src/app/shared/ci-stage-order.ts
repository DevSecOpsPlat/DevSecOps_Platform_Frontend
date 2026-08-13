/**
 * Ordre des stages tel que défini dans EnviroTest/.gitlab-ci.yml.
 * Ne pas trier par id de job GitLab (retry → id plus élevé → mauvais ordre).
 */
export const CI_STAGE_ORDER: readonly string[] = [
  'setup',
  'code-analysis',
  'sca',
  'sast',
  'secrets-iac',
  'build',
  'push-image',
  'deploy-k8s',
  'container-scan',
  'zap-scan',
  'reporting',
  'security-validation',
  'report'
] as const;

/** Index dans l’ordre CI ; stages inconnus → -1. */
export function ciStageIndex(stage: string | null | undefined): number {
  return CI_STAGE_ORDER.indexOf((stage || '').trim().toLowerCase());
}

/**
 * Trie des noms de stage : ordre CI connu d’abord, puis minJobId pour les inconnus.
 */
export function sortStageNames(
  names: string[],
  minJobIdByStage?: (stage: string) => number
): string[] {
  return [...names].sort((a, b) => {
    const ia = ciStageIndex(a);
    const ib = ciStageIndex(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    if (minJobIdByStage) {
      return minJobIdByStage(a) - minJobIdByStage(b);
    }
    return a.localeCompare(b);
  });
}
