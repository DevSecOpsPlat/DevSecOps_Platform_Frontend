import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChatMarkdownPipe } from '../../pipes/chat-markdown.pipe';
import { Subject, combineLatest } from 'rxjs';
import { distinctUntilChanged, finalize, map, takeUntil } from 'rxjs/operators';
import {
  DefectDojoFindingDetail,
  DefectDojoService
} from '../../services/defectdojo/defectdojo.service';
import { FindingAiRemediationResponse } from '../../services/findings/findings.service';
import { UserService } from '../../services/user/user.service';

@Component({
  selector: 'app-defectdojo-finding-details',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ChatMarkdownPipe],
  templateUrl: './defectdojo-finding-details.component.html',
  styleUrls: [
    '../vulnerability-details/vulnerability-details.component.css',
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
  aiResult: FindingAiRemediationResponse | null = null;
  aiError: string | null = null;

  chatMessages: { role: 'user' | 'assistant'; content: string }[] = [];
  chatInput = '';
  chatLoading = false;
  chatError: string | null = null;
  showFullFileRewrite = false;

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
    this.resetChat();

    this.defectDojoService.getFindingDetail(this.appId, this.findingId, this.branch).subscribe({
      next: d => {
        this.detail = d;
        this.detailLoading = false;
        this.codeSnippetInput = (d.codeSnippet ?? '').trim();
        this.runAiRemediation();
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

  runAiRemediation(): void {
    if (!this.appId || this.findingId == null || this.aiLoading) return;
    this.aiLoading = true;
    this.aiError = null;
    this.aiResult = null;
    const snippet = this.codeSnippetInput?.trim();
    this.defectDojoService
      .requestAiRemediation(
        this.appId,
        this.findingId,
        this.branch,
        snippet ? { codeSnippet: snippet } : undefined
      )
      .pipe(finalize(() => (this.aiLoading = false)))
      .subscribe({
        next: r => (this.aiResult = r),
        error: err => {
          const msg = err?.error?.problemSummary || err?.error?.message || err?.message;
          this.aiError = msg ? String(msg) : 'Erreur appel IA.';
        }
      });
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

  copyText(_label: string, text: string): void {
    const v = text?.trim();
    if (!v || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(v).catch(() => {});
  }

  sourceLabel(src?: string | null): string {
    const s = (src || 'NONE').toUpperCase();
    if (s === 'GITHUB') return 'Dépôt GitHub';
    if (s === 'GITLAB') return 'Dépôt GitLab';
    if (s === 'MANUAL') return 'Saisie manuelle';
    if (s === 'REPO') return 'Dépôt (branche)';
    return 'Non disponible';
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
    return [header, r.problemSummary, r.impact, ...(r.remediationSteps ?? [])].filter(Boolean).join('\n');
  }
}
