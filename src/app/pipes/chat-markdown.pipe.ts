import { Pipe, PipeTransform } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import * as DomPurifyModule from 'dompurify';
import { marked } from 'marked';

/** DOMPurify est en `export =` (CJS) : résolution sans default import. */
function domPurifySanitize(html: string): string {
  const mod = DomPurifyModule as unknown as {
    sanitize?: (s: string, c?: import('dompurify').Config) => string;
    default?: { sanitize: (s: string, c?: import('dompurify').Config) => string };
  };
  const api = mod.sanitize ? mod : mod.default;
  if (!api?.sanitize) {
    return '';
  }
  return api.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel']
  });
}

let markedConfigured = false;

/**
 * Ligne utile hors préfixe de liste (1. / - / *).
 */
function lineListStripped(line: string): string {
  return line.replace(/^\s*(?:(?:[-*+]|\d+\.)\s+)+/, '').trim();
}

/**
 * Si le modèle oublie les ```, entoure les lignes type commande / balise HTML (hors blocs existants).
 */
function fenceBareCommandLines(text: string): string {
  const segments = text.split(/(```[\s\S]*?```)/g);
  return segments
    .map((seg, idx) => {
      if (idx % 2 === 1) {
        return seg;
      }
      const lines = seg.split('\n');
      const out: string[] = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        const trimmedStart = line.replace(/^\s*/, '');
        const inner = lineListStripped(line);

        // Balise <link …> ou <script …> sur une ou plusieurs lignes jusqu'au premier '>'
        if (/^<\s*link\b/i.test(inner) || /^<\s*script\b/i.test(inner)) {
          const leadWs = line.match(/^\s*/)?.[0] ?? '';
          let buf = inner;
          let j = i;
          while (!buf.includes('>') && j + 1 < lines.length) {
            j++;
            buf += ' ' + lineListStripped(lines[j]);
          }
          if (buf.includes('>')) {
            out.push(`${leadWs}\`\`\`html\n${buf.trim()}\n\`\`\``);
            i = j + 1;
            continue;
          }
        }

        if (/^openssl\s+/i.test(inner)) {
          const leadWs = line.match(/^\s*/)?.[0] ?? '';
          out.push(`${leadWs}\`\`\`bash\n${inner}\n\`\`\``);
          i++;
          continue;
        }

        if (
          /^(?:npm|npx|yarn|pnpm|git|curl|wget|docker|kubectl|sh|bash)\s+\S/i.test(inner) &&
          inner.length >= 8 &&
          !/^\d+\./.test(inner)
        ) {
          const leadWs = line.match(/^\s*/)?.[0] ?? '';
          out.push(`${leadWs}\`\`\`bash\n${inner}\n\`\`\``);
          i++;
          continue;
        }

        out.push(line);
        i++;
      }
      return out.join('\n');
    })
    .join('');
}

/**
 * Ajoute des <a> pour les URLs encore en clair dans le HTML (filet de sécurité après marked).
 */
function linkifyPlainUrlsInHtml(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }
  try {
    const doc = new DOMParser().parseFromString(`<div class="chat-md-root">${html}</div>`, 'text/html');
    const root = doc.body.querySelector('.chat-md-root');
    if (!root) {
      return html;
    }

    const skipAncestor = (el: Element | null): boolean => {
      if (!el) {
        return false;
      }
      const t = el.tagName;
      if (t === 'A' || t === 'CODE' || t === 'PRE' || t === 'KBD' || t === 'SAMP') {
        return true;
      }
      return skipAncestor(el.parentElement);
    };

    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? '';
        if (!/https?:\/\//i.test(text) || !node.parentElement || skipAncestor(node.parentElement)) {
          return;
        }
        const re = /https?:\/\/[^\s<>"']+/gi;
        const matches = [...text.matchAll(re)];
        if (matches.length === 0) {
          return;
        }
        const frag = doc.createDocumentFragment();
        let last = 0;
        for (const m of matches) {
          const ix = m.index ?? 0;
          const raw = m[0];
          if (ix > last) {
            frag.appendChild(doc.createTextNode(text.slice(last, ix)));
          }
          let href = raw.replace(/[.,;:!?…]+$/u, '');
          while (/[)\]}>]$/.test(href) && href.length > 10) {
            href = href.slice(0, -1);
          }
          if (!/^https?:\/\//i.test(href)) {
            frag.appendChild(doc.createTextNode(raw));
            last = ix + raw.length;
            continue;
          }
          const a = doc.createElement('a');
          a.setAttribute('href', href);
          a.textContent = raw;
          frag.appendChild(a);
          last = ix + raw.length;
        }
        if (last < text.length) {
          frag.appendChild(doc.createTextNode(text.slice(last)));
        }
        node.parentNode?.replaceChild(frag, node);
        return;
      }
      const children = Array.from(node.childNodes);
      for (const c of children) {
        walk(c);
      }
    };

    walk(root);
    return root.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Met en gras des termes techniques quand le modèle ne met pas de **…** (hors blocs ``` et `).
 */
function boldTechTerms(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((chunk, ci) => {
      if (ci % 2 === 1) {
        return chunk;
      }
      const sub = chunk.split(/(\*\*[^*]+\*\*)/g);
      return sub
        .map((seg, si) => {
          if (si % 2 === 1) {
            return seg;
          }
          let s = seg;
          s = s.replace(/\bSubresource Integrity\b/gi, '**$&**');
          s = s.replace(/\bContent Security Policy\b/gi, '**$&**');
          s = s.replace(/\bSHA-(?:256|384|512)\b/gi, '**$&**');
          s = s.replace(/\bbase64\b/gi, '**$&**');
          s = s.replace(/\bopenssl\b/gi, '**openssl**');
          s = s.replace(/\bintegrity\b/gi, '**integrity**');
          s = s.replace(/\bnonce\b/gi, '**nonce**');
          s = s.replace(/\bcrossorigin\b/gi, '**crossorigin**');
          s = s.replace(/\bcdnjs\b/gi, '**cdnjs**');
          s = s.replace(/\bSRI\b/g, '**SRI**');
          s = s.replace(/\bCSP\b/g, '**CSP**');
          return s;
        })
        .join('');
    })
    .join('');
}

/**
 * URLs brutes → &lt;url&gt; pour que marked (GFM) les transforme en liens cliquables.
 * Ignore les URLs déjà dans une référence Markdown ](…).
 */
function angleBracketAutolinks(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        return part;
      }
      return part.replace(/(?<!\]\()(https?:\/\/[^\s<>"']+)/gi, (raw) => {
        let u = raw.replace(/[.,;:!?…]+$/u, '');
        while (/[)\]}>]$/.test(u) && u.length > 8) {
          u = u.slice(0, -1);
        }
        return u.length > 0 ? `<${u}>` : raw;
      });
    })
    .join('');
}

function configureMarked(): void {
  if (markedConfigured) {
    return;
  }
  marked.setOptions({
    gfm: true,
    breaks: true,
    async: false
  });
  markedConfigured = true;
}

/**
 * Rendu Markdown sécurisé pour les réponses assistant (listes, code, liens).
 */
@Pipe({
  name: 'chatMarkdown',
  standalone: true
})
export class ChatMarkdownPipe implements PipeTransform {
  constructor(private readonly sanitizer: DomSanitizer) {}

  transform(value: string | null | undefined): SafeHtml {
    configureMarked();
    const text = value?.trim() ?? '';
    if (!text) {
      return this.sanitizer.bypassSecurityTrustHtml('');
    }
    const prepared = angleBracketAutolinks(boldTechTerms(fenceBareCommandLines(text)));
    const raw = marked.parse(prepared, { async: false }) as string;
    const clean = domPurifySanitize(linkifyPlainUrlsInHtml(raw));
    const linksOpenNewTab = clean.replace(
      /<a href=/g,
      '<a rel="noopener noreferrer" target="_blank" href='
    );
    return this.sanitizer.bypassSecurityTrustHtml(linksOpenNewTab);
  }
}
