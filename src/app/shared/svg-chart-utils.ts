/**
 * Petits utilitaires pour dessiner des graphiques en SVG pur (sans librairie,
 * sans canvas) avec un rendu proche de Chart.js : courbes lissées, aires en
 * dégradé. Aucune de ces fonctions ne doit être appelée depuis un template
 * Angular (*ngFor/*ngIf) — toujours pré-calculer le résultat dans le
 * composant et le stocker dans un champ, sinon Angular recalcule à chaque
 * cycle de détection de changements et détruit/recrée le DOM (voir l'incident
 * documenté dans sonarqube.component.ts / security-dashboard.component.ts).
 */

export interface SvgPoint {
  x: number;
  y: number;
}

/**
 * Construit un chemin SVG lissé (courbes de Bézier façon Catmull-Rom) à partir
 * d'une série de points. Équivalent visuel du `tension: 0.15` de Chart.js.
 * Avec 0 ou 1 point, retourne un point/chemin dégénéré exploitable quand même.
 */
export function smoothPath(points: SvgPoint[], tension = 0.2): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${fmt(points[0].x)},${fmt(points[0].y)}`;
  if (points.length === 2) {
    return `M ${fmt(points[0].x)},${fmt(points[0].y)} L ${fmt(points[1].x)},${fmt(points[1].y)}`;
  }

  let d = `M ${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  }
  return d;
}

/** Referme un chemin de ligne en aire (jusqu'à une ligne de base `baseY`), pour un remplissage en dégradé. */
export function areaPath(linePath: string, points: SvgPoint[], baseY: number): string {
  if (!points.length) return '';
  const last = points[points.length - 1];
  const first = points[0];
  return `${linePath} L ${fmt(last.x)},${fmt(baseY)} L ${fmt(first.x)},${fmt(baseY)} Z`;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : '0';
}

/** Arrondit une valeur max de graphique à un palier "propre" (1, 2, 5, 10, 20, 50...) pour un axe Y lisible. */
export function niceAxisMax(value: number): number {
  if (value <= 5) return Math.max(1, Math.ceil(value));
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

/**
 * Génère des graduations régulières et "propres" pour un axe Y de compteurs entiers
 * (façon Chart.js), ex: niceAxisTicks(37) -> [40, 30, 20, 10, 0]. Retourne un tableau
 * décroissant, toujours terminé par 0. `targetCount` est indicatif (le nombre réel de
 * graduations peut varier légèrement pour rester "propre").
 */
export function niceAxisTicks(rawMax: number, targetCount = 5): number[] {
  const safeMax = Math.max(1, rawMax);
  const roughStep = safeMax / Math.max(1, targetCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 2.5) niceNormalized = 2.5;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  const step = Math.max(1, niceNormalized * magnitude); // valeurs entières (nombre de findings)
  const niceMax = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let v = niceMax; v > 0; v -= step) {
    ticks.push(Math.round(v));
  }
  ticks.push(0);
  return ticks;
}
