import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChatMarkdownPipe } from '../../pipes/chat-markdown.pipe';
import { EMPTY, Subject, combineLatest, of, throwError, timer } from 'rxjs';
import { distinctUntilChanged, finalize, map, switchMap, take, takeUntil, timeout } from 'rxjs/operators';
import {
  DefectDojoFindingDetail,
  DefectDojoFindingStatusAction,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';
import {
  DiagnosisItem,
  FindingAiRemediationResponse,
  FixLayer
} from '../../models/finding/finding-ai-remediation.model';
import { UserService } from '../../services/user/user.service';
import { codeLanguageLabel, highlightCode } from '../../shared/code-highlight.util';

/** Correctif affiché (un seul, même pour les anciennes analyses qui en donnaient plusieurs formes). */
interface PatchView {
  code: string;
  html: string;
  language: string;
  target: string;
}

const SOURCE_LABELS: Record<string, string> = {
  SCANNER: 'Scanner',
  PLATFORM_CHECK: 'Contrôle plateforme',
  REPOSITORY: 'Dépôt',
  HYPOTHESIS: 'Hypothèse'
};

const LAYER_LABELS: Record<string, string> = {
  APPLICATION: 'Application (votre dépôt)',
  REVERSE_PROXY: 'Reverse proxy (Ingress Traefik)',
  CDN_TLS: 'CDN / TLS (Cloudflare)',
  KUBERNETES: 'Kubernetes',
  WEB_SERVER: 'Serveur web',
  BUILD: 'Build / image',
  DEPENDENCY: 'Dépendance',
  OTHER: 'Autre'
};

const AI_REQUEST_TIMEOUT_MS = 90_000;
const AI_POLL_INTERVAL_MS = 3_000;
const AI_POLL_MAX_MS = 600_000;

interface FindingActionButton {
  action: DefectDojoFindingStatusAction;
  label: string;
  tone: 'primary' | 'secondary' | 'danger' | 'neutral';
  confirm?: string;
}

@Component({
  selector: 'app-defectdojo-finding-details',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ChatMarkdownPipe],
  templateUrl: './defectdojo-finding-details.component.html',
  styleUrls: [
    '../shared/finding-detail.styles.css',
    './defectdojo-finding-details.component.css'
  ]
})
export class DefectDojoFindingDetailsComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  appId: string | null = null;
  branch = '';
  category = '';
  findingId: number | null = null;

  detail: DefectDojoFindingDetail | null = null;
  detailLoading = true;
  detailError: string | null = null;
  authError: string | null = null;

  codeSnippetInput = '';
  aiLoading = false;
  aiPolling = false;
  aiError: string | null = null;

  /** Vues précalculées (coloration syntaxique) à chaque nouveau résultat IA. */
  patchView: PatchView | null = null;
  commandViews: Array<{ code: string; html: string }> = [];
  fullFileHtml = '';
  snippetHtml = '';

  /** Zones repliables. */
  refineOpen = false;
  snippetOpen = false;
  liveCheckOpen = false;
  copiedKey: string | null = null;

  private _aiResult: FindingAiRemediationResponse | null = null;
  get aiResult(): FindingAiRemediationResponse | null {
    return this._aiResult;
  }
  set aiResult(r: FindingAiRemediationResponse | null) {
    this._aiResult = r;
    this.buildAiViews();
  }

  chatMessages: { role: 'user' | 'assistant'; content: string }[] = [];
  chatInput = '';
  chatLoading = false;
  chatError: string | null = null;
  showFullFileRewrite = false;

  statusLoading = false;
  statusError: string | null = null;
  statusMessage: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private defectDojoService: DefectDojoService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    if (!this.userService.getToken()) {
      this.authError = 'Vous devez être authentifié.';
      this.detailLoading = false;
      return;
    }

    this.appId =
      this.route.pathFromRoot
        .map(r => r.snapshot.paramMap.get('appId'))
        .find(id => !!id) ?? null;

    combineLatest([
      this.route.paramMap.pipe(map(p => p.get('findingId'))),
      this.route.queryParamMap.pipe(map(q => q.get('branch') ?? '')),
      this.route.queryParamMap.pipe(map(q => q.get('category') ?? ''))
    ])
      .pipe(
        distinctUntilChanged((a, b) => a.every((v, i) => v === b[i])),
        takeUntil(this.destroy$)
      )
      .subscribe(([fid, branch, category]) => {
        this.branch = branch;
        this.category = category;
        const id = fid ? Number(fid) : NaN;
        if (!this.appId || !fid || Number.isNaN(id)) {
          this.detailError = 'Paramètres invalides (application ou finding manquant).';
          this.detailLoading = false;
          return;
        }
        this.findingId = id;
        this.loadDetail();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDetail(): void {
    if (!this.appId || this.findingId == null) return;
    this.detailLoading = true;
    this.detailError = null;
    this.detail = null;
    this.aiResult = null;
    this.aiError = null;
    this.statusError = null;
    this.statusMessage = null;
    this.resetChat();

    this.defectDojoService.getFindingDetail(this.appId, this.findingId, this.branch).subscribe({
      next: d => {
        this.detail = d;
        this.detailLoading = false;
        // L'extrait chargé automatiquement est déjà envoyé à l'IA : la zone « Affiner » sert à en coller un autre.
        this.codeSnippetInput = '';
        this.snippetHtml = highlightCode(d.codeSnippet ?? '', this.languageFromPath(d.codeFilePath || d.filePath));
        this.refineOpen = false;
        this.snippetOpen = false;
        this.liveCheckOpen = false;
        this.runAiRemediation(false);
      },
      error: err => {
        this.detailLoading = false;
        const msg = err?.error?.message;
        this.detailError = msg
          ? String(msg)
          : 'Impossible de charger le finding DefectDojo pour cette branche.';
      }
    });
  }

  backLink(): string[] {
    if (!this.appId) return ['/my-applications'];
    const fromOverview = /\/(overview|security-center)\//.test(this.router.url);
    return fromOverview
      ? ['/project', this.appId, 'overview']
      : ['/project', this.appId, 'security-dashboard'];
  }

  backQueryParams(): Record<string, string> {
    const q: Record<string, string> = {};
    if (this.branch) q['branch'] = this.branch;
    if (this.category) q['category'] = this.category;
    return q;
  }

  resetChat(): void {
    this.chatMessages = [];
    this.chatInput = '';
    this.chatLoading = false;
    this.chatError = null;
  }

  runAiRemediation(deepAnalysis = false): void {
    if (!this.appId || this.findingId == null || this.aiLoading) return;
    this.aiLoading = true;
    this.aiPolling = false;
    this.aiError = null;
    if (!deepAnalysis) {
      this.aiResult = null;
    }
    console.info('[DevSecOps AI] Démarrage analyse', {
      deepAnalysis,
      chaine: 'Groq → OpenRouter (openrouter/free → gpt-oss-20b → qwen3-coder → …) → Ollama'
    });
    const snippet = this.codeSnippetInput?.trim();
    this.defectDojoService
      .requestAiRemediation(
        this.appId,
        this.findingId,
        this.branch,
        { ...(snippet ? { codeSnippet: snippet } : {}), deepAnalysis }
      )
      .pipe(
        timeout(AI_REQUEST_TIMEOUT_MS),
        switchMap(r => {
          if (r?.status === 'PENDING') {
            this.aiResult = r;
            this.logAiModelInConsole(r, 'ollama-async-en-cours');
          } else {
            this.logAiModelInConsole(r, 'reponse-initiale');
          }
          return this.followRemediationJob(r);
        }),
        finalize(() => {
          this.aiLoading = false;
          this.aiPolling = false;
        })
      )
      .subscribe({
        next: r => {
          this.logAiModelInConsole(r, 'termine');
          // Analyse écartée par le backend (hors sujet, anglais, modèles saturés) : message, pas de faux résultat.
          if (r?.status === 'FAILED') {
            this.aiResult = null;
            this.aiError = r.problemSummary || 'Analyse IA indisponible pour le moment.';
            return;
          }
          this.aiResult = r;
        },
        error: err => {
          const msg = err?.name === 'TimeoutError'
            ? 'Analyse IA trop longue — le modèle cloud est peut-être saturé. Réessayez ou lancez une analyse approfondie (Ollama local).'
            : (err?.error?.problemSummary || err?.error?.message || err?.message);
          this.aiError = msg ? String(msg) : 'Erreur appel IA.';
        }
      });
  }

  /** Si le backend renvoie un job Ollama async, poll jusqu'à COMPLETE/FAILED. */
  private followRemediationJob(r: FindingAiRemediationResponse) {
    if (r?.status !== 'PENDING' || !r?.jobId) {
      return of(r);
    }
    this.aiPolling = true;
    const deadline = Date.now() + AI_POLL_MAX_MS;
    return timer(0, AI_POLL_INTERVAL_MS).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.defectDojoService.pollAiRemediationJob(r.jobId!)),
      switchMap(polled => {
        if (polled?.status === 'COMPLETE' || polled?.status === 'FAILED') {
          return of(polled);
        }
        if (Date.now() > deadline) {
          return throwError(
            () => new Error('Analyse Ollama trop longue — vérifiez qu\'Ollama tourne (ollama serve).')
          );
        }
        return EMPTY;
      }),
      take(1)
    );
  }

  responseSourceLabel(): string {
    const r = this.aiResult;
    if (!r) return '';
    const src = r.responseSource?.toUpperCase() ?? '';
    const provider = r.aiProviderUsed ?? '';
    const model = r.aiModelUsed?.trim();

    if (src === 'CACHE') {
      if (provider === 'static-template' && model) {
        return `Cache · template ${model}`;
      }
      return model ? `Cache · ${model}` : 'Cache';
    }
    if (src === 'STATIC' || provider === 'static-template') {
      return model ? `OWASP · ${model}` : 'Recommandation validée';
    }
    if (src === 'GROQ' || provider === 'groq') {
      return model ? `Groq · ${model}` : 'Groq';
    }
    if (src === 'OPENROUTER' || provider === 'openrouter') {
      return model ? `OpenRouter · ${model}` : 'OpenRouter';
    }
    if (src === 'OLLAMA' || provider === 'ollama' || r.status === 'PENDING') {
      return model ? `Ollama · ${model}` : 'Ollama local';
    }
    return model || '';
  }

  /** Affiche provider + modèle dans la console du navigateur (Inspecter → Console). */
  private logAiModelInConsole(r: FindingAiRemediationResponse | null | undefined, phase: string): void {
    if (!r) return;

    const source = (r.responseSource ?? '').toUpperCase();
    const provider = r.aiProviderUsed ?? '';
    const isLlm =
      source === 'GROQ' ||
      source === 'OPENROUTER' ||
      source === 'OLLAMA' ||
      provider === 'groq' ||
      provider === 'openrouter' ||
      provider === 'ollama' ||
      r.status === 'PENDING';

    let engine: string;
    let llmModel: string | null = null;
    let templateId: string | null = null;

    if (source === 'CACHE') {
      engine = 'cache (réponse déjà calculée — pas d’appel API)';
      if (provider === 'static-template') {
        templateId = r.aiModelUsed ?? null;
      } else {
        llmModel = r.aiModelUsed ?? null;
      }
    } else if (source === 'STATIC' || provider === 'static-template') {
      engine = 'template OWASP validé (pas d’IA cloud)';
      templateId = r.aiModelUsed ?? null;
    } else if (isLlm) {
      engine = r.status === 'PENDING' ? 'Ollama local (async)' : `IA cloud (${provider || source})`;
      llmModel = r.aiModelUsed ?? null;
    } else {
      engine = provider || source || 'inconnu';
      llmModel = r.aiModelUsed ?? null;
    }

    const summary = isLlm && llmModel
      ? `Modèle IA : ${llmModel}`
      : templateId
        ? `Template : ${templateId} (aucun Groq/OpenRouter/Ollama)`
        : source === 'CACHE'
          ? 'Cache — aucun modèle IA appelé cette fois'
          : 'Aucun modèle IA cloud utilisé';

    const payload = {
      phase,
      resume: summary,
      moteur: engine,
      modeleIa: llmModel,
      template: templateId,
      provider: provider || null,
      source: r.responseSource ?? null,
      status: r.status ?? 'COMPLETE',
      quotaFallback: r.quotaFallbackUsed ?? false
    };

    if (r.status === 'PENDING') {
      console.info('[DevSecOps AI] ⏳ En cours —', payload);
    } else if (isLlm) {
      console.info('[DevSecOps AI] 🤖 Modèle IA utilisé —', payload);
    } else {
      console.info('[DevSecOps AI] 📋 Pas d’IA cloud —', payload);
    }
  }

  sendChat(): void {
    if (!this.appId || this.findingId == null || this.chatLoading) return;
    const text = this.chatInput?.trim();
    if (!text) return;
    this.chatInput = '';
    this.chatError = null;
    const nextMessages = [...this.chatMessages, { role: 'user' as const, content: text }];
    this.chatMessages = nextMessages;
    this.chatLoading = true;
    this.defectDojoService
      .postFindingChat(this.appId, this.findingId, this.branch, {
        messages: nextMessages,
        remediationSummary: this.remediationSummaryForChat()
      })
      .pipe(finalize(() => (this.chatLoading = false)))
      .subscribe({
        next: res => {
          this.chatMessages = [
            ...this.chatMessages,
            { role: 'assistant', content: res?.reply?.trim() || '(Réponse vide)' }
          ];
        },
        error: err => {
          this.chatError = err?.error?.reply || err?.error?.message || 'Erreur chat IA.';
          this.chatMessages = this.chatMessages.slice(0, -1);
          this.chatInput = text;
        }
      });
  }

  onChatEnter(event: Event): void {
    const e = event as KeyboardEvent;
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    this.sendChat();
  }

  toggleFullFileRewrite(): void {
    this.showFullFileRewrite = !this.showFullFileRewrite;
  }

  copyText(key: string, text: string): void {
    const v = text?.trim();
    if (!v || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(v).then(() => {
      this.copiedKey = key;
      setTimeout(() => {
        if (this.copiedKey === key) this.copiedKey = null;
      }, 1500);
    }).catch(() => {});
  }

  // ── Vues de l'analyse IA ────────────────────────────────────────────────────────────────────

  private buildAiViews(): void {
    const r = this._aiResult;
    this.showFullFileRewrite = false;
    if (!r) {
      this.patchView = null;
      this.commandViews = [];
      this.fullFileHtml = '';
      return;
    }
    // Un seul correctif : le patch ; à défaut (ancien format), le code « après ».
    const code = (r.suggestedPatch?.trim() || r.secureCodeAfter?.trim() || '');
    this.patchView = code
      ? {
          code,
          html: highlightCode(code, r.patchLanguage),
          language: codeLanguageLabel(r.patchLanguage, code),
          target: (r.patchTarget || '').trim()
        }
      : null;
    this.commandViews = (r.verificationCommands ?? [])
      .filter(c => !!c?.trim())
      .map(c => ({ code: c.trim(), html: highlightCode(c.trim(), 'bash') }));
    this.fullFileHtml = r.fullFileRewrite?.trim() ? highlightCode(r.fullFileRewrite, r.patchLanguage) : '';
  }

  get isDast(): boolean {
    return !!this.detail?.dynamicFinding;
  }

  get analyzedUrls(): string[] {
    return this.detail?.analyzedUrls ?? [];
  }

  get hasSnippet(): boolean {
    return !!this.detail?.codeSnippet?.trim();
  }

  /** Une ligne : « main.py · déduit du Dockerfile » ou « aucun fichier associé identifié ». */
  get codeSourcePath(): string {
    const d = this.detail;
    if (!d) return '';
    if (d.codeContextSource === 'DOCKERFILE') return 'Dockerfile';
    return d.codeFilePath || d.filePath || d.componentName || '';
  }

  get noCodeText(): string {
    if (this.isContainerImagePath()) return 'paquet de l\'image Docker scannée, pas un fichier du dépôt.';
    return 'aucun fichier associé identifié.';
  }

  get diagnosisItems(): DiagnosisItem[] {
    return (this._aiResult?.diagnosis ?? []).filter(d => !!d?.statement?.trim());
  }

  get fixLayers(): FixLayer[] {
    return (this._aiResult?.fixLayers ?? []).filter(l => !!l?.description?.trim());
  }

  get remediationSteps(): string[] {
    return (this._aiResult?.remediationSteps ?? []).filter(s => !!s?.trim());
  }

  get bestPractices(): string[] {
    return (this._aiResult?.bestPractices ?? []).filter(s => !!s?.trim());
  }

  get verificationHints(): string[] {
    return (this._aiResult?.verificationHints ?? []).filter(s => !!s?.trim());
  }

  /** Impact + risque métier des anciennes analyses, en un seul bloc. */
  get impactText(): string {
    const r = this._aiResult;
    if (!r) return '';
    const impact = r.impact?.trim() || '';
    const business = r.businessRisk?.trim() || '';
    if (!business || impact.includes(business)) return impact;
    return impact ? `${impact}\n\n${business}` : business;
  }

  get hasScannerDetails(): boolean {
    const d = this.detail;
    return !!(d && (d.description || d.mitigation || this.scannerFieldList.length || d.references));
  }

  diagSourceLabel(source: string | null | undefined): string {
    return SOURCE_LABELS[(source || '').toUpperCase()] || 'Hypothèse';
  }

  diagSourceClass(source: string | null | undefined): string {
    const s = (source || '').toUpperCase();
    return SOURCE_LABELS[s] ? s.toLowerCase().replace('_', '-') : 'hypothesis';
  }

  layerLabel(layer: string | null | undefined): string {
    return LAYER_LABELS[(layer || '').toUpperCase()] || 'Autre';
  }

  certaintyLabel(status: string | null | undefined): string {
    switch ((status || '').toUpperCase()) {
      case 'CONFIRMED': return 'Confirmée';
      case 'PROBABLE': return 'Probable';
      case 'UNDETERMINED': return 'À déterminer';
      default: return '';
    }
  }

  certaintyClass(status: string | null | undefined): string {
    return (status || '').toLowerCase();
  }

  get confidenceLevel(): 'high' | 'medium' | 'low' | null {
    const c = (this._aiResult?.confidence || '').toUpperCase();
    if (c === 'HIGH') return 'high';
    if (c === 'LOW') return 'low';
    return c ? 'medium' : null;
  }

  get confidenceText(): string {
    switch (this.confidenceLevel) {
      case 'high': return 'Confiance élevée';
      case 'low': return 'Confiance faible';
      case 'medium': return 'Confiance moyenne';
      default: return '';
    }
  }

  cweLabel(cwe: string | null | undefined): string {
    const v = (cwe || '').trim();
    if (!v || v === '0') return '';
    return /^\d+$/.test(v) ? `CWE-${v}` : v;
  }

  severityClass(): string {
    return (this.detail?.severity || 'info').toLowerCase();
  }

  get liveHeaders(): Array<{ name: string; value: string }> {
    const h = this.detail?.liveCheck?.headers;
    if (!h) return [];
    return Object.keys(h).map(name => ({ name, value: h[name] }));
  }

  /** Résumé d'une ligne du contrôle HTTP de la plateforme. */
  get liveCheckSummary(): string {
    const c = this.detail?.liveCheck;
    if (!c) return '';
    if (c.error) return c.error;
    const missing = c.missingHeaders?.length ?? 0;
    const status = c.status ? `HTTP ${c.status}` : '';
    return [status, missing ? `${missing} en-tête${missing > 1 ? 's' : ''} de sécurité absent${missing > 1 ? 's' : ''}` : 'en-têtes de sécurité présents']
      .filter(Boolean).join(' · ');
  }

  private languageFromPath(path: string | null | undefined): string {
    const p = (path || '').toLowerCase();
    if (p.endsWith('.py')) return 'python';
    if (/\.(m?js|cjs|ts|tsx|jsx)$/.test(p)) return 'js';
    if (/\.(java|kt)$/.test(p)) return 'java';
    if (/\.(ya?ml)$/.test(p)) return 'yaml';
    if (p.endsWith('.json')) return 'json';
    if (p.endsWith('.conf')) return 'nginx';
    if (p.endsWith('dockerfile') || this.detail?.codeContextSource === 'DOCKERFILE') return 'docker';
    if (p.endsWith('.sh')) return 'bash';
    return '';
  }

  /** Métadonnées techniques extraites de la description brute du scanner (PURL, méthode…). */
  get scannerFieldList(): Array<{ label: string; value: string }> {
    const fields = this.detail?.scannerFields;
    if (!fields) return [];
    return Object.keys(fields)
      .map(label => ({ label, value: String(fields[label] ?? '').trim() }))
      .filter(f => !!f.value);
  }

  sourceLabel(src?: string | null): string {
    const s = (src || 'NONE').toUpperCase();
    if (s === 'GITHUB') return 'Dépôt GitHub';
    if (s === 'GITLAB') return 'Dépôt GitLab';
    if (s === 'DOCKERFILE') return 'Dockerfile (dépôt)';
    if (s === 'MANUAL') return 'Saisie manuelle';
    if (s === 'REPO') return 'Dépôt (branche)';
    return 'Non disponible';
  }

  isContainerImagePath(): boolean {
    const p = this.detail?.filePath?.trim() ?? '';
    return p.startsWith('/lib/') || p.startsWith('/usr/') || p.includes('/apk/');
  }

  get availableStatusActions(): FindingActionButton[] {
    const d = this.detail;
    if (!d) return [];

    if (d.riskAccepted) {
      return [
        { action: 'UNACCEPT_RISK', label: 'Retirer l\'acceptation de risque', tone: 'secondary' },
        { action: 'REACTIVATE', label: 'Réactiver', tone: 'primary', confirm: 'Réactiver ce finding dans DefectDojo ?' }
      ];
    }
    if (d.falsePositive || d.outOfScope) {
      return [
        { action: 'REACTIVATE', label: 'Réactiver (revenir en Open)', tone: 'primary', confirm: 'Réactiver ce finding ?' }
      ];
    }
    if (d.mitigated || (!d.active && !d.falsePositive && !d.outOfScope)) {
      return [
        { action: 'REOPEN', label: 'Rouvrir', tone: 'primary', confirm: 'Rouvrir ce finding dans DefectDojo ?' }
      ];
    }

    const actions: FindingActionButton[] = [];
    if (d.verified) {
      actions.push({ action: 'UNVERIFY', label: 'Retirer la vérification', tone: 'neutral' });
    } else {
      actions.push({ action: 'VERIFY', label: 'Vérifier', tone: 'secondary' });
    }
    actions.push(
      { action: 'CLOSE', label: 'Clore (mitigé)', tone: 'primary', confirm: 'Marquer comme corrigé / mitigé dans DefectDojo ?' },
      { action: 'FALSE_POSITIVE', label: 'Faux positif', tone: 'danger', confirm: 'Marquer comme faux positif ? Le finding quittera la liste Open.' },
      { action: 'OUT_OF_SCOPE', label: 'Hors périmètre', tone: 'danger', confirm: 'Marquer hors périmètre ?' },
      { action: 'UNDER_REVIEW', label: 'En revue', tone: 'neutral' },
      { action: 'ACCEPT_RISK', label: 'Accepter le risque', tone: 'secondary', confirm: 'Accepter le risque sans correction ? (Simple Risk Acceptance requis dans DefectDojo)' }
    );
    return actions;
  }

  applyStatusAction(btn: FindingActionButton): void {
    if (!this.appId || this.findingId == null || this.statusLoading) return;
    if (btn.confirm && !window.confirm(btn.confirm)) return;

    this.statusLoading = true;
    this.statusError = null;
    this.statusMessage = null;

    this.defectDojoService
      .updateFindingStatus(this.appId, this.findingId, btn.action, this.branch)
      .pipe(finalize(() => (this.statusLoading = false)))
      .subscribe({
        next: d => {
          this.detail = d;
          this.statusMessage = `Statut mis à jour : ${d.status}`;
          this.syncCategoryFromDetail(d);
        },
        error: err => {
          this.statusError = err?.error?.message || 'Impossible de mettre à jour le statut dans DefectDojo.';
        }
      });
  }

  private syncCategoryFromDetail(d: DefectDojoFindingDetail): void {
    if (d.falsePositive) this.category = 'false_positive';
    else if (d.outOfScope) this.category = 'out_of_scope';
    else if (d.riskAccepted) this.category = 'risk_accepted';
    else if (d.mitigated) this.category = 'closed';
    else if (!d.active) this.category = 'inactive';
    else if (d.verified) this.category = 'verified';
    else this.category = 'open';
  }

  private remediationSummaryForChat(): string | undefined {
    const r = this.aiResult;
    const d = this.detail;
    const header = d
      ? [
          `Finding DefectDojo: ${d.title}`,
          `Produit: ${d.productName} | Branche: ${d.branch}`,
          `Scan: ${d.scanType} | Gravité: ${d.severity}`,
          d.description ? `Description: ${d.description}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      : '';
    if (!r) return header || undefined;
    return [
      header,
      r.problemSummary,
      ...(r.diagnosis ?? []).map(d => `[${this.diagSourceLabel(d.source)}] ${d.statement}`),
      r.rootCause,
      r.location,
      r.impact,
      r.businessRisk,
      ...(r.remediationSteps ?? [])
    ].filter(Boolean).join('\n');
  }
}
