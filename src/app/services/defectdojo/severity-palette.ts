/**
 * Palette de sévérité UNIQUE pour tout ce qui encode la sévérité par la couleur
 * sans étiquette texte adjacente (segments de barres empilées, mini-barres,
 * lignes de graphique, légendes). Avant ce fichier, deux palettes coexistaient
 * dans security-dashboard.component.ts :
 *  - SEV_COLORS (5 nuances d'un même orange — quasi indiscernables entre
 *    Critical/High/Medium à la taille d'une barre de graphique),
 *  - OPEN_SEV_BAR_COLORS (rouge/orange/ambre/bleu/gris — bien distinct),
 * ce qui obligeait à réapprendre le code couleur d'un panneau à l'autre sur
 * le même écran. On garde uniquement la seconde, ici comme source unique.
 *
 * La barre KPI en tête de dashboard (.sev-critical / .sev-high / ... en CSS,
 * dégradé orange → navy) n'est PAS concernée : c'est un bandeau de marque où
 * le nom de la sévérité est écrit en toutes lettres sous chaque nombre, la
 * couleur n'y est pas le seul vecteur d'information.
 */
export const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#EF4444',
  High: '#F97316',
  Medium: '#EAB308',
  Low: '#3B82F6',
  Info: '#94A3B8'
};

export function severityColor(sev: string): string {
  return SEVERITY_COLORS[sev] ?? '#64748b';
}
