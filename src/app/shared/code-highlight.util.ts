/**
 * Coloration syntaxique légère pour les correctifs et commandes affichés dans l'analyse IA.
 * Pas de dépendance : un tokenizer par regex (commentaires, chaînes, mots-clés, nombres, clés).
 * Tout le texte est échappé ; seules des balises <span class="tk-…"> sont produites.
 */

type Rule = { cls: string; re: string };

const KW = {
  python: 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield',
  js: 'async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|yield',
  java: 'abstract|boolean|break|case|catch|class|continue|default|do|else|enum|extends|final|finally|for|if|implements|import|instanceof|int|interface|long|new|null|package|private|protected|public|return|static|super|switch|this|throw|throws|true|false|try|var|void|while',
  bash: 'if|then|else|elif|fi|for|do|done|while|case|esac|in|function|export|local|return|echo|sudo',
  docker: 'FROM|RUN|CMD|ENTRYPOINT|COPY|ADD|ENV|ARG|EXPOSE|WORKDIR|USER|LABEL|VOLUME|HEALTHCHECK|ONBUILD|SHELL|STOPSIGNAL|AS'
};

const STR_DQ = '"(?:[^"\\\\\\n]|\\\\.)*"';
const STR_SQ = "'(?:[^'\\\\\\n]|\\\\.)*'";
const STR_BT = '`(?:[^`\\\\]|\\\\.)*`';
const NUM = '\\b\\d+(?:\\.\\d+)?\\b';

function rulesFor(lang: string): Rule[] {
  switch (lang) {
    case 'python':
      return [
        { cls: 'tk-com', re: '#[^\\n]*' },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}` },
        { cls: 'tk-attr', re: '@[\\w.]+' },
        { cls: 'tk-kw', re: `\\b(?:${KW.python})\\b` },
        { cls: 'tk-num', re: NUM }
      ];
    case 'js':
    case 'java':
      return [
        { cls: 'tk-com', re: '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/' },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}|${STR_BT}` },
        { cls: 'tk-attr', re: '@\\w+' },
        { cls: 'tk-kw', re: `\\b(?:${lang === 'java' ? KW.java : KW.js})\\b` },
        { cls: 'tk-num', re: NUM }
      ];
    case 'bash':
      return [
        { cls: 'tk-com', re: '(?:^|(?<=\\s))#[^\\n]*' },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}` },
        { cls: 'tk-attr', re: '(?<=\\s)--?[\\w-]+' },
        { cls: 'tk-kw', re: `\\b(?:${KW.bash})\\b` },
        { cls: 'tk-fn', re: '(?:^|(?<=[|;&]\\s*))[\\w.-]+' }
      ];
    case 'yaml':
      return [
        { cls: 'tk-com', re: '#[^\\n]*' },
        { cls: 'tk-key', re: '^[ \\t-]*[\\w.\\/-]+(?=\\s*:)' },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}` },
        { cls: 'tk-num', re: NUM }
      ];
    case 'json':
      return [
        { cls: 'tk-key', re: `${STR_DQ}(?=\\s*:)` },
        { cls: 'tk-str', re: STR_DQ },
        { cls: 'tk-kw', re: '\\b(?:true|false|null)\\b' },
        { cls: 'tk-num', re: '-?\\b\\d+(?:\\.\\d+)?\\b' }
      ];
    case 'http':
      return [
        { cls: 'tk-key', re: '^[A-Za-z][\\w-]*(?=:)' },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}` },
        { cls: 'tk-num', re: NUM }
      ];
    case 'nginx':
      return [
        { cls: 'tk-com', re: '#[^\\n]*' },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}` },
        { cls: 'tk-kw', re: '^[ \\t]*[a-z_]+(?=\\s)' },
        { cls: 'tk-num', re: NUM }
      ];
    case 'docker':
      return [
        { cls: 'tk-com', re: '#[^\\n]*' },
        { cls: 'tk-kw', re: `^[ \\t]*(?:${KW.docker})\\b` },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}` }
      ];
    default:
      return [
        { cls: 'tk-com', re: '(?:^|(?<=\\s))(?:#|\\/\\/)[^\\n]*' },
        { cls: 'tk-str', re: `${STR_DQ}|${STR_SQ}` },
        { cls: 'tk-num', re: NUM }
      ];
  }
}

/** Normalise l'étiquette de langage renvoyée par l'IA (python, py, typescript, sh, conf…). */
export function normalizeCodeLanguage(lang: string | null | undefined, code = ''): string {
  const l = (lang || '').trim().toLowerCase();
  if (['python', 'py', 'fastapi', 'django', 'flask'].includes(l)) return 'python';
  if (['javascript', 'js', 'typescript', 'ts', 'node', 'express', 'angular', 'react', 'tsx', 'jsx'].includes(l)) return 'js';
  if (['java', 'kotlin', 'spring', 'csharp', 'c#', 'go'].includes(l)) return 'java';
  if (['bash', 'sh', 'shell', 'zsh', 'console', 'curl'].includes(l)) return 'bash';
  if (['yaml', 'yml', 'kubernetes', 'k8s', 'helm'].includes(l)) return 'yaml';
  if (['json'].includes(l)) return 'json';
  if (['http', 'headers', 'header'].includes(l)) return 'http';
  if (['nginx', 'conf', 'apache'].includes(l)) return 'nginx';
  if (['dockerfile', 'docker'].includes(l)) return 'docker';
  // Déduction prudente quand l'IA n'a rien précisé.
  if (/^\s*(from \w+ import|import \w+|def |@app\.)/m.test(code)) return 'python';
  if (/^\s*(curl|grep|npm|pip|mvn|docker|kubectl|git) /m.test(code)) return 'bash';
  if (/^\s*[A-Z][\w-]+: /m.test(code) && !/[{;]$/m.test(code)) return 'http';
  return 'plain';
}

/** Libellé lisible du langage pour l'en-tête du bloc de code. */
export function codeLanguageLabel(lang: string | null | undefined, code = ''): string {
  const raw = (lang || '').trim();
  if (raw) return raw.toLowerCase();
  const n = normalizeCodeLanguage(lang, code);
  return n === 'plain' ? 'texte' : n === 'js' ? 'javascript' : n === 'docker' ? 'dockerfile' : n;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** HTML coloré (échappé) pour un extrait de code. */
export function highlightCode(code: string | null | undefined, lang?: string | null): string {
  const src = code ?? '';
  if (!src) return '';
  const rules = rulesFor(normalizeCodeLanguage(lang, src));
  let combined: RegExp;
  try {
    combined = new RegExp(rules.map(r => `(${r.re})`).join('|'), 'gm');
  } catch {
    return escapeHtml(src);
  }
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(src)) !== null) {
    if (m[0].length === 0) {
      combined.lastIndex++;
      continue;
    }
    const idx = m.slice(1).findIndex(g => g !== undefined);
    out += escapeHtml(src.slice(last, m.index));
    out += idx >= 0
      ? `<span class="${rules[idx].cls}">${escapeHtml(m[0])}</span>`
      : escapeHtml(m[0]);
    last = m.index + m[0].length;
  }
  out += escapeHtml(src.slice(last));
  return out;
}
