/** Domaine des applications publiées par la plateforme. */
export const PLATFORM_APP_DOMAIN = 'envirotest.cloud';

/**
 * Adresse d'aperçu d'une application publiée en envirotest.cloud : apercu-<hôte>
 * (même règle que AppK8sManifestService.previewHostFor côté backend). Cette adresse sert la même
 * application mais n'autorise l'affichage dans un cadre QUE depuis envirotest.cloud ; l'adresse
 * publique garde sa protection anti-clickjacking. Retourne null pour toute autre adresse.
 */
export function platformPreviewUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!host.endsWith('.' + PLATFORM_APP_DOMAIN)) return null;
    const firstLabel = host.split('.')[0];
    if (firstLabel.startsWith('apercu-')) return u.toString();
    if (firstLabel.length + 'apercu-'.length > 63) return null;
    u.hostname = 'apercu-' + host;
    return u.toString();
  } catch {
    return null;
  }
}
