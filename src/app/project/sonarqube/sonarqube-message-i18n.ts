/** Traductions FR des messages, libellés et contenus SonarCloud. */

const EXACT: Record<string, string> = {
  'Make sure that using ENV to handle a secret is safe here.':
    'Assurez-vous qu\'utiliser ENV pour gérer un secret est sûr ici.',
  'Make sure disabling Angular built-in sanitization is safe here.':
    'Assurez-vous que la désactivation de la sanitisation intégrée d\'Angular est sûre ici.',
  'PostgreSQL database passwords should not be disclosed':
    'Les mots de passe de base PostgreSQL ne doivent pas être divulgués',
  'Make sure this PostgreSQL database password gets changed and removed from the code.':
    'Assurez-vous que ce mot de passe PostgreSQL est modifié et retiré du code.',
  'Origins should be verified during cross-origin communications':
    'Les origines doivent être vérifiées lors des communications cross-origin',
  'Hard-coded passwords are security-sensitive':
    'Les mots de passe en dur sont sensibles pour la sécurité',
  'Using hardcoded IP addresses is security-sensitive':
    'L\'utilisation d\'adresses IP en dur est sensible pour la sécurité',
  'A form label must be associated with a control.':
    'Une étiquette de formulaire doit être associée à un champ.',
  'Unexpected empty source':
    'Source vide inattendue',
  'The \'nginx\' image runs with \'root\' as the default user.':
    'L\'image « nginx » s\'exécute avec l\'utilisateur « root » par défaut.',
  'The "nginx" image runs with "root" as the default user.':
    'L\'image « nginx » s\'exécute avec l\'utilisateur « root » par défaut.',
  'The "nginx" image runs with "root" as the default user. Make sure it is safe here.':
    'L\'image « nginx » s\'exécute avec l\'utilisateur « root » par défaut. Assurez-vous que c\'est sûr ici.',
  'Make sure it is safe here.':
    'Assurez-vous que c\'est sûr ici.',
  'Not assigned': 'Non assigné',
  HOTSPOT: 'Point sensible',
  "Member 'resService: AnnonceService' is never reassigned; mark it as `readonly`.":
    'Le membre « resService: AnnonceService » n\'est jamais réassigné ; marquez-le comme `readonly`.',
  "Member 'route: ActivatedRoute' is never reassigned; mark it as `readonly`.":
    'Le membre « route: ActivatedRoute » n\'est jamais réassigné ; marquez-le comme `readonly`.',
};

const SENTENCE_PATTERNS: { re: RegExp; fr: string }[] = [
  { re: /^Make sure that (.+) is safe here\.?$/i, fr: 'Assurez-vous que $1 est sûr ici.' },
  { re: /^Make sure disabling (.+) is safe here\.?$/i, fr: 'Assurez-vous que la désactivation de $1 est sûre ici.' },
  { re: /^Make sure (?:this|that) (.+) is safe\.?$/i, fr: 'Assurez-vous que $1 est sûr.' },
  { re: /^Make sure it is safe here\.?$/i, fr: 'Assurez-vous que c\'est sûr ici.' },
  { re: /^Make sure (.+)\.?$/i, fr: 'Assurez-vous que $1.' },
  {
    re: /^The ["'](.+?)["'] image runs with ["'](.+?)["'] as the default user\.?\s*Make sure it is safe here\.?$/i,
    fr: 'L\'image « $1 » s\'exécute avec l\'utilisateur « $2 » par défaut. Assurez-vous que c\'est sûr ici.'
  },
  {
    re: /^The ["'](.+?)["'] image runs with ["'](.+?)["'] as the default user\.?$/i,
    fr: 'L\'image « $1 » s\'exécute avec l\'utilisateur « $2 » par défaut.'
  },
  { re: /^A form label must be associated with a control\.?$/i, fr: 'Une étiquette de formulaire doit être associée à un champ.' },
  { re: /^Unexpected empty source\.?$/i, fr: 'Source vide inattendue.' },
  {
    re: /^Member '(.+?)' is never reassigned; mark it as (?:`readonly`|readonly)\.?$/i,
    fr: 'Le membre « $1 » n\'est jamais réassigné ; marquez-le comme `readonly`.'
  },
  { re: /^Remove this unused import of '(.+)'\.?$/i, fr: 'Supprimez cet import inutilisé de « $1 ».' },
  { re: /^Remove this unused declaration of '(.+)'\.?$/i, fr: 'Supprimez cette déclaration inutilisée de « $1 ».' },
  { re: /^Remove this unused private '(.+)' field\.?$/i, fr: 'Supprimez ce champ privé inutilisé « $1 ».' },
  { re: /^Remove this unused private (.+) field\.?$/i, fr: 'Supprimez ce champ privé inutilisé $1.' },
  { re: /^Remove this commented-out code\.?$/i, fr: 'Supprimez ce code commenté.' },
  { re: /^Refactor this function to reduce its Cognitive Complexity from (\d+) to the (\d+) allowed\.?$/i,
    fr: 'Refactorisez cette fonction pour réduire sa complexité cognitive de $1 à $2 (seuil autorisé).' },
  { re: /^(.+) is deprecated\.?$/i, fr: '« $1 » est obsolète.' },
  {
    re: /^Prefer using an optional chain expression instead, as it's more concise and easier to read\.?$/i,
    fr: 'Préférez une chaîne optionnelle (?.) : plus concise et plus lisible.'
  },
  { re: /^Use concise character class syntax '\[\]' instead of '\[ \]'\.?$/i,
    fr: 'Utilisez la syntaxe concise « [] » au lieu de « [ ] ».' },
  { re: /^Replace this character class by the character itself\.?$/i,
    fr: 'Remplacez cette classe de caractères par le caractère lui-même.' },
  { re: /^Empty block statement\.?$/i, fr: 'Bloc vide.' },
  { re: /^Add a 'onKeyPress\|onKeyDown\|onKeyUp' attribute to this element\.?$/i,
    fr: 'Ajoutez un attribut onKeyPress, onKeyDown ou onKeyUp à cet élément.' },
  { re: /^Add an "alt" attribute to this image\.?$/i, fr: 'Ajoutez un attribut « alt » à cette image.' },
  { re: /^Add a "lang" attribute to this "<html>" element\.?$/i,
    fr: 'Ajoutez un attribut « lang » à l\'élément <html>.' },
];

const WORD_PATTERNS: { re: RegExp; fr: string }[] = [
  { re: /should not be disclosed/gi, fr: 'ne doit pas être divulgué' },
  { re: /should not be exposed/gi, fr: 'ne doit pas être exposé' },
  { re: /should not be used/gi, fr: 'ne doit pas être utilisé' },
  { re: /should not be/gi, fr: 'ne doit pas être' },
  { re: /must not be/gi, fr: 'ne doit pas être' },
  { re: /must be associated with/gi, fr: 'doit être associé à' },
  { re: /is security-sensitive/gi, fr: 'est sensible pour la sécurité' },
  { re: /is vulnerable to/gi, fr: 'est vulnérable à' },
  { re: /never reassigned/gi, fr: 'jamais réassigné' },
  { re: /mark it as/gi, fr: 'marquez-le comme' },
  { re: /unused import/gi, fr: 'import inutilisé' },
  { re: /unused declaration/gi, fr: 'déclaration inutilisée' },
  { re: /commented-out code/gi, fr: 'code commenté' },
  { re: /\bpasswords\b/gi, fr: 'mots de passe' },
  { re: /\bpassword\b/gi, fr: 'mot de passe' },
  { re: /\bdatabase\b/gi, fr: 'base de données' },
  { re: /\bhardcoded\b/gi, fr: 'en dur' },
  { re: /\bhard-coded\b/gi, fr: 'en dur' },
  { re: /\bform label\b/gi, fr: 'étiquette de formulaire' },
  { re: /\bcontrol\b/gi, fr: 'champ' },
  { re: /\breadonly\b/gi, fr: 'readonly' },
  { re: /\bruns with\b/gi, fr: 's\'exécute avec' },
  { re: /\bdefault user\b/gi, fr: 'utilisateur par défaut' },
  { re: /\bcontainer\b/gi, fr: 'conteneur' },
  { re: /\bcontainers\b/gi, fr: 'conteneurs' },
  { re: /\bimage\b/gi, fr: 'image' },
  { re: /\battack surface\b/gi, fr: 'surface d\'attaque' },
  { re: /\broot privileges\b/gi, fr: 'privilèges root' },
  { re: /\bprivileged\b/gi, fr: 'privilégié' },
  { re: /\bvulnerability\b/gi, fr: 'vulnérabilité' },
  { re: /\bvulnerabilities\b/gi, fr: 'vulnérabilités' },
  { re: /\battacker\b/gi, fr: 'attaquant' },
  { re: /\bhost\b/gi, fr: 'hôte' },
  { re: /\bnon-root user\b/gi, fr: 'utilisateur non-root' },
  { re: /\bDockerfile\b/gi, fr: 'Dockerfile' },
];

const HTML_PHRASES: { re: RegExp; fr: string }[] = [
  {
    re: /Angular prevents XSS vulnerabilities by treating all values as untrusted by default\. Untrusted values are systematically sanitized by the framework before they are inserted into the DOM\./g,
    fr: 'Angular prévient les vulnérabilités XSS en traitant par défaut toutes les valeurs comme non fiables. Les valeurs non fiables sont systématiquement assainies par le framework avant d\'être insérées dans le DOM.'
  },
  {
    re: /Still, developers have the ability to manually mark a value as trusted if they are sure that the value is already sanitized\. Accidentally trusting malicious data will introduce an XSS vulnerability in the application and expose the users of this application to severe risk\./g,
    fr: 'Les développeurs peuvent toutefois marquer manuellement une valeur comme fiable s\'ils sont certains qu\'elle est déjà assainie. Faire confiance par erreur à des données malveillantes introduira une vulnérabilité XSS et exposera les utilisateurs à un risque élevé.'
  },
  {
    re: /readonly fields can only be assigned in a class constructor\. If a class has a field that's not marked readonly but is only set in the constructor, it could cause confusion about the field's intended use\. To avoid confusion, such fields should be marked readonly to make their intended use explicit, and to prevent future maintainers from inadvertently changing their use\./g,
    fr: 'Les champs `readonly` ne peuvent être assignés que dans le constructeur d\'une classe. Si un champ n\'est pas marqué `readonly` mais n\'est défini que dans le constructeur, cela peut prêter à confusion sur son usage prévu. Pour éviter cela, ces champs doivent être marqués `readonly` afin de rendre leur usage explicite et d\'empêcher les futurs mainteneurs de le modifier par inadvertance.'
  },
  { re: /\bNoncompliant code example\b/gi, fr: 'Exemple de code non conforme' },
  { re: /\bCompliant solution\b/gi, fr: 'Solution conforme' },
  { re: /\bSee also\b/gi, fr: 'Voir aussi' },
  { re: /\bDocumentation\b/gi, fr: 'Documentation' },
  { re: /\bResources\b/gi, fr: 'Ressources' },
  { re: /\bWhy is this an issue\??\b/gi, fr: 'Pourquoi est-ce un problème ?' },
  { re: /\bHow can I fix it\??\b/gi, fr: 'Comment corriger ?' },
  { re: /\bWhat is the risk\??\b/gi, fr: 'Quel est le risque ?' },
  { re: /\bTypeScript Documentation\b/gi, fr: 'Documentation TypeScript' },
  { re: /\bAsk [Yy]ourself [Ww]hether\b/g, fr: 'Demandez-vous si' },
  { re: /\bRecommended Secure Coding Practices\b/gi, fr: 'Bonnes pratiques de codage sécurisé recommandées' },
  { re: /\bSensitive Code Example\b/gi, fr: 'Exemple de code sensible' },
  { re: /\bHow to fix it\b/gi, fr: 'Comment corriger' },
  { re: /\bRoot Cause\b/gi, fr: 'Cause racine' },
  { re: /\bIntroduction\b/gi, fr: 'Introduction' },
  { re: /\bAssess the (?:problem|issue)\b/gi, fr: 'Évaluer le problème' },
  {
    re: /Running containers (?:as|with) (?:a )?root(?: user)? increases the attack surface[^<.]*/gi,
    fr: 'Exécuter des conteneurs en tant qu\'utilisateur root augmente la surface d\'attaque. Un attaquant qui exploite une vulnérabilité pourrait obtenir un accès root au conteneur et potentiellement à l\'hôte.'
  },
  {
    re: /The default user for (?:many |the )?["']?(\w+)["']? image[s]? is root[^<.]*/gi,
    fr: 'L\'utilisateur par défaut de l\'image $1 est root, ce qui accorde des privilèges élevés au conteneur.'
  },
  {
    re: /Running containers with (?:a )?high privilege increases the attack surface[^<.]*/gi,
    fr: 'Exécuter des conteneurs avec des privilèges élevés augmente la surface d\'attaque du conteneur et de l\'hôte sous-jacent.'
  },
  {
    re: /Use a non-root user in the Dockerfile/gi,
    fr: 'Utilisez un utilisateur non-root dans le Dockerfile'
  },
  {
    re: /Use the <code>USER<\/code> directive/gi,
    fr: 'Utilisez la directive <code>USER</code>'
  },
  {
    re: /An attacker who exploits a vulnerability in the application could gain root access[^<.]*/gi,
    fr: 'Un attaquant qui exploite une vulnérabilité dans l\'application pourrait obtenir un accès root au conteneur.'
  },
  {
    re: /This rule raises an issue when the instruction <code>USER<\/code> is not set[^<.]*/gi,
    fr: 'Cette règle signale un problème lorsque l\'instruction <code>USER</code> n\'est pas définie dans le Dockerfile.'
  },
  {
    re: /This rule raises an issue when a Dockerfile does not specify a non-root user[^<.]*/gi,
    fr: 'Cette règle signale un problème lorsqu\'un Dockerfile ne spécifie pas d\'utilisateur non-root.'
  },
];

const SEVERITY_FR: Record<string, string> = {
  BLOCKER: 'Bloquant',
  CRITICAL: 'Critique',
  MAJOR: 'Majeur',
  MINOR: 'Mineur',
  INFO: 'Info',
};

const ISSUE_TYPE_FR: Record<string, string> = {
  BUG: 'Bug',
  VULNERABILITY: 'Vulnérabilité',
  CODE_SMELL: 'Code smell',
  SECURITY_HOTSPOT: 'Point sensible',
};

const IMPACT_SEVERITY_FR: Record<string, string> = {
  BLOCKER: 'Bloquant',
  CRITICAL: 'Élevé',
  HIGH: 'Élevé',
  MAJOR: 'Moyen',
  MEDIUM: 'Moyen',
  MINOR: 'Faible',
  LOW: 'Faible',
  INFO: 'Info',
};

const CODE_ATTRIBUTE_FR: Record<string, string> = {
  Consistency: 'Cohérence',
  Intentionality: 'Intentionnalité',
  Adaptability: 'Adaptabilité',
  Responsibility: 'Responsabilité',
  CONSISTENCY: 'Cohérence',
  INTENTIONALITY: 'Intentionnalité',
  ADAPTABILITY: 'Adaptabilité',
  RESPONSIBILITY: 'Responsabilité',
};

const VULN_PROBABILITY_FR: Record<string, string> = {
  HIGH: 'Élevée',
  MEDIUM: 'Moyenne',
  LOW: 'Faible',
};

const SECURITY_CATEGORY_FR: Record<string, string> = {
  auth: 'Authentification',
  bypass: 'Contournement',
  'command-injection': 'Injection de commande',
  csrf: 'CSRF',
  'denial-of-service': 'Déni de service',
  'dos': 'Déni de service',
  'encrypt-data': 'Chiffrement des données',
  'file-manipulation': 'Manipulation de fichiers',
  'ldap-injection': 'Injection LDAP',
  'log-injection': 'Injection de logs',
  'os-command-injection': 'Injection de commande OS',
  privacy: 'Confidentialité',
  privilege: 'Privilèges',
  rce: 'Exécution de code à distance',
  'sql-injection': 'Injection SQL',
  ssl: 'SSL / TLS',
  'weak-cryptography': 'Cryptographie faible',
  xss: 'XSS',
  'xpath-injection': 'Injection XPath',
  xpath: 'XPath',
  injection: 'Injection',
  cryptography: 'Cryptographie',
  'insecure-conf': 'Configuration non sécurisée',
  'ssrf': 'SSRF',
  'xxe': 'XXE',
  'path-traversal': 'Traversée de chemin',
  'ldap': 'LDAP',
  'session-fixation': 'Fixation de session',
  'open-redirect': 'Redirection ouverte',
};

const TAG_FR: Record<string, string> = {
  'bad-practice': 'Mauvaise pratique',
  confusing: 'Confus',
  'cwe': 'CWE',
  'design': 'Conception',
  'docker': 'Docker',
  'java8': 'Java 8',
  'owasp-a1': 'OWASP A1',
  'owasp-a2': 'OWASP A2',
  'owasp-a3': 'OWASP A3',
  'owasp-a4': 'OWASP A4',
  'owasp-a5': 'OWASP A5',
  'owasp-a6': 'OWASP A6',
  'owasp-a7': 'OWASP A7',
  'owasp-a8': 'OWASP A8',
  'owasp-a9': 'OWASP A9',
  'owasp-a10': 'OWASP A10',
  'pitfall': 'Piège',
  'security': 'Sécurité',
  'suspicious': 'Suspect',
  'unused': 'Inutilisé',
  'clumsy': 'Maladroit',
  'cert': 'CERT',
  'multi-threading': 'Multithread',
  'regex': 'Expression régulière',
  'performance': 'Performance',
  'brain-overload': 'Surcharge cognitive',
};

const FR_WORDS = /\b(assurez|assuré|doit|être|les|des|une|ici|pas|étiquette|vulnérabilité|sûr|sûre|supprimez|marquez|membre|jamais|réassigné|bloquant|majeur|mineur|critique|maintenabilité|fiabilité|sécurité|cohérence|intentionnalité|adaptabilité|responsabilité|authentification|injection|point sensible|conteneur|image|utilisateur|demandez-vous|recommandé|pratiques|corriger|risque|cause)\b/i;

function looksFrench(text: string): boolean {
  return FR_WORDS.test(text);
}

function humanizeKeyFr(key: string): string {
  return key
    .split(/[-_/]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function normalizeSonarText(text: string): string {
  return text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function translatePlainBlock(text: string): string {
  const raw = text.trim();
  if (!raw || looksFrench(raw)) return text;
  const normalized = normalizeSonarText(raw);
  if (EXACT[normalized]) return EXACT[normalized];
  let out = translateSonarMessage(normalized);
  if (out !== normalized) return out;
  // Phrases multiples (ex. message hotspot nginx + « Make sure… »)
  const parts = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (parts.length > 1) {
    const translated = parts.map(p => translateSonarMessage(p));
    if (translated.some((t, i) => t !== parts[i])) {
      return translated.join(' ');
    }
  }
  return out;
}

/** Traduit un message court Sonar vers le français. */
export function translateSonarMessage(text: string | undefined | null): string {
  if (!text?.trim()) return text || '';
  const raw = normalizeSonarText(text);
  if (EXACT[raw]) return EXACT[raw];

  let out = raw;
  for (const { re, fr } of SENTENCE_PATTERNS) {
    if (re.test(out)) {
      out = out.replace(re, fr);
      return out.charAt(0).toUpperCase() + out.slice(1);
    }
    re.lastIndex = 0;
  }

  if (!looksFrench(out)) {
    for (const { re, fr } of WORD_PATTERNS) {
      if (re.test(out)) out = out.replace(re, fr);
      re.lastIndex = 0;
    }
  }

  if (out !== raw) return out.charAt(0).toUpperCase() + out.slice(1);
  return raw;
}

/** Traduit le HTML des règles Sonar (titres, paragraphes, listes). */
export function translateSonarHtml(html: string | undefined | null): string {
  if (!html?.trim()) return html || '';
  let out = html;
  for (const { re, fr } of HTML_PHRASES) {
    out = out.replace(re, fr);
  }
  // Titres h2–h4
  out = out.replace(/<(h[2-4])(\s[^>]*)?>([^<]+)<\/\1>/gi, (_m, tag, attrs, text) => {
    const fr = translatePlainBlock(text);
    return `<${tag}${attrs || ''}>${fr}</${tag}>`;
  });
  // Paragraphes, listes, cellules
  out = out.replace(/<(p|li|td|th|dt|dd)(\s[^>]*)?>([^<]+)<\/\1>/gi, (_m, tag, attrs, text) => {
    if (looksFrench(text.trim())) return _m;
    const fr = translatePlainBlock(text);
    return `<${tag}${attrs || ''}>${fr}</${tag}>`;
  });
  // Texte entre balises
  out = out.replace(/>([^<]{4,})</g, (_m, text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('http') || looksFrench(trimmed)) return `>${text}<`;
    return `>${translatePlainBlock(trimmed)}<`;
  });
  // Fragment sans balises HTML
  if (!/<[a-z][\s>]/i.test(out)) {
    return translatePlainBlock(out);
  }
  return out;
}

export function translateSonarSeverity(severity: string | undefined | null): string {
  const s = String(severity || '').toUpperCase();
  return SEVERITY_FR[s] || severity || '–';
}

export function translateSonarIssueType(type: string | undefined | null): string {
  const t = String(type || '').toUpperCase();
  return ISSUE_TYPE_FR[t] || type || '–';
}

export function translateSonarImpactSeverity(severity: string | undefined | null): string {
  const s = String(severity || '').toUpperCase();
  if (IMPACT_SEVERITY_FR[s]) return IMPACT_SEVERITY_FR[s];
  if (!severity) return '—';
  return severity.charAt(0).toUpperCase() + severity.slice(1).toLowerCase();
}

export function translateSonarCodeAttribute(attr: string | undefined | null): string {
  const raw = String(attr || '').trim();
  if (!raw) return '';
  if (CODE_ATTRIBUTE_FR[raw]) return CODE_ATTRIBUTE_FR[raw];
  const up = raw.toUpperCase();
  if (CODE_ATTRIBUTE_FR[up]) return CODE_ATTRIBUTE_FR[up];
  return raw;
}

export function translateSonarSecurityCategory(key: string | undefined | null): string {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return '';
  if (SECURITY_CATEGORY_FR[k]) return SECURITY_CATEGORY_FR[k];
  return humanizeKeyFr(k);
}

export function translateSonarTag(tag: string | undefined | null): string {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) return '';
  if (TAG_FR[t]) return TAG_FR[t];
  return humanizeKeyFr(t);
}

export function translateSonarVulnerabilityProbability(prob: string | undefined | null): string {
  const p = String(prob || '').toUpperCase();
  return VULN_PROBABILITY_FR[p] || prob || '–';
}

export function translateSonarQgStatus(status: string | undefined | null): string {
  const s = String(status || '').toUpperCase();
  if (s === 'OK') return 'Réussi';
  if (s === 'ERROR') return 'Échoué';
  if (s === 'WARN') return 'Avertissement';
  return status || '–';
}
