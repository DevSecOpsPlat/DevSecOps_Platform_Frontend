import { Theme } from '../../services/ui/theme.service';

/**
 * Couleurs des graphiques Chart.js de la console admin, alignées sur les variables --adm-* de
 * admin-theme.css. Chart.js dessine dans un canvas et ne lit pas le CSS : ces valeurs doublent
 * donc volontairement celles du thème. Seules les couleurs dépendent du thème — types, données
 * et options des graphiques restent ceux de chaque page.
 */
export interface AdminChartPalette {
  /** Libellés de légende et textes forts. */
  label: string;
  /** Graduations des axes. */
  tick: string;
  grid: string;
  /** Fond des cartes : bordures des anneaux, contours des points. */
  surface: string;
  /** Piste vide des jauges, part « libre » des barres empilées. */
  track: string;
  /** Série neutre (bleu nuit sur fond clair, gris clair sur fond sombre). */
  ink: string;
  inkFill: string;
  accent: string;
  accentFill: string;
  accentBar: string;
  success: string;
  danger: string;
  tooltipBg: string;
  tooltipBorder: string;
  /** Texte central des jauges. */
  text: string;
}

const LIGHT: AdminChartPalette = {
  label: '#344054',
  tick: '#5f6b7d',
  grid: 'rgba(16, 24, 40, 0.07)',
  surface: '#ffffff',
  track: '#e3e7ee',
  ink: '#1f2c47',
  inkFill: 'rgba(31, 44, 71, 0.08)',
  accent: '#ea580c',
  accentFill: 'rgba(234, 88, 12, 0.12)',
  accentBar: 'rgba(234, 88, 12, 0.85)',
  success: '#15803d',
  danger: '#dc2626',
  tooltipBg: '#0f1a2e',
  tooltipBorder: 'rgba(148, 163, 184, 0.25)',
  text: '#101828'
};

const DARK: AdminChartPalette = {
  label: '#c1cad8',
  tick: '#8a96a9',
  grid: 'rgba(148, 163, 184, 0.10)',
  surface: '#121c30',
  track: '#22304a',
  ink: '#aab6c8',
  inkFill: 'rgba(170, 182, 200, 0.10)',
  accent: '#f36c21',
  accentFill: 'rgba(243, 108, 33, 0.16)',
  accentBar: 'rgba(243, 108, 33, 0.85)',
  success: '#4cc490',
  danger: '#f0716b',
  tooltipBg: '#0a1120',
  tooltipBorder: 'rgba(148, 163, 184, 0.25)',
  text: '#e4e9f1'
};

export function adminChartPalette(theme: Theme): AdminChartPalette {
  return theme === 'dark' ? DARK : LIGHT;
}
