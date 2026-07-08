/** Libellés lisibles des CWE les plus fréquents dans les scans (Semgrep, Trivy, Gitleaks, ZAP…). */
const CWE_LABELS: Record<string, string> = {
  'CWE-22': 'Path traversal',
  'CWE-78': 'Injection de commande OS',
  'CWE-79': 'XSS',
  'CWE-89': 'Injection SQL',
  'CWE-94': 'Injection de code',
  'CWE-95': 'Injection eval()',
  'CWE-116': 'Encodage de sortie incorrect',
  'CWE-200': "Divulgation d'information",
  'CWE-250': 'Privilèges excessifs',
  'CWE-259': 'Mot de passe en dur',
  'CWE-284': "Contrôle d'accès incorrect",
  'CWE-295': 'Validation certificat',
  'CWE-319': 'Transmission en clair',
  'CWE-326': 'Chiffrement faible',
  'CWE-327': 'Algorithme crypto cassé',
  'CWE-330': 'Aléa prévisible',
  'CWE-345': 'Authenticité non vérifiée (SRI)',
  'CWE-352': 'CSRF',
  'CWE-400': 'Épuisement de ressources',
  'CWE-434': 'Upload de fichier dangereux',
  'CWE-502': 'Désérialisation non sûre',
  'CWE-521': 'Politique de mot de passe faible',
  'CWE-524': 'Information en cache',
  'CWE-601': 'Redirection ouverte',
  'CWE-611': 'XXE',
  'CWE-693': 'Protection insuffisante (en-têtes)',
  'CWE-798': 'Identifiants en dur',
  'CWE-915': 'Mass assignment',
  'CWE-918': 'SSRF',
  'CWE-1021': 'Clickjacking',
  'CWE-1333': 'ReDoS (regex)'
};

/** « CWE-79 » → « CWE-79 · XSS » ; CWE inconnu → identifiant seul. */
export function cweDisplayLabel(cweId: string): string {
  const name = CWE_LABELS[cweId];
  return name ? `${cweId} · ${name}` : cweId;
}
