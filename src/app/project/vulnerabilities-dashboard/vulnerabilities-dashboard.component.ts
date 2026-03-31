import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { distinctUntilChanged, finalize, map, takeUntil } from 'rxjs/operators';
import { EnvironmentService } from '../../services/environment/environment.service';
import {
  FindingsService,
  FindingItem,
  FindingsStatsResponse,
  FindingsTrendsResponse
} from '../../services/findings/findings.service';
import { UserService } from 'src/app/services/user/user.service';
import { PipelineService } from 'src/app/services/pipeline/pipeline.service';

@Component({
  selector: 'app-vulnerabilities-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './vulnerabilities-dashboard.component.html',
  styleUrls: ['./vulnerabilities-dashboard.component.css']
})
export class VulnerabilitiesDashboardComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  envId: string | null = null;
  ingesting = false;
  ingestResult: any = null;

  loading = false;
  error: string | null = null;

  stats: FindingsStatsResponse | null = null;
  trends: FindingsTrendsResponse | null = null;
  findings: FindingItem[] = [];

  page = 0;
  size = 20;
  totalElements = 0;

  /** Filtres appliqués sur la page courante (données déjà chargées). */
  filterSeverity = '';
  filterTool = '';
  searchQuery = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private environmentService: EnvironmentService,
    private findingsService: FindingsService,
    private userService: UserService,
    private pipelineService: PipelineService
  ) {}

  ngOnInit(): void {
    if (!this.userService.getToken()) {
      this.error = "Vous devez être authentifié pour voir les vulnérabilités.";
      this.loading = false;
      return;
    }

    this.route.queryParamMap
      .pipe(
        map(p => p.get('envId') ?? ''),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(qpEnvId => {
        if (qpEnvId) {
          if (this.envId !== qpEnvId) {
            this.envId = qpEnvId;
            this.page = 0;
            this.reload();
          }
          return;
        }
        this.loading = true;
        this.error = null;
        this.environmentService
          .getLatestEnvironment()
          .pipe(finalize(() => (this.loading = false)))
          .subscribe({
            next: (env: any) => {
              const id = env?.id ?? null;
              if (this.envId !== id) {
                this.envId = id;
                this.page = 0;
                this.reload();
              }
            },
            error: () => {
              this.error = "Impossible de récupérer le dernier environnement.";
            }
          });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(): void {
    if (!this.envId) {
      this.error = "Aucun environnement sélectionné.";
      return;
    }

    this.error = null;
    this.loading = true;
    this.ingestResult = null;

    this.findingsService.getStatsByEnvironment(this.envId).subscribe({
      next: s => (this.stats = s),
      error: () => (this.stats = null)
    });

    this.findingsService.getTrendsByEnvironment(this.envId).subscribe({
      next: t => (this.trends = t),
      error: () => (this.trends = null)
    });

    const tool = this.filterTool?.trim();
    const severity = this.filterSeverity?.trim();
    this.findingsService
      .listByEnvironment(this.envId, this.page, this.size, {
        ...(tool ? { tool } : {}),
        ...(severity ? { severity } : {})
      })
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: res => {
          this.findings = res.content ?? [];
          this.totalElements = res.totalElements ?? 0;
        },
        error: () => {
          this.error = "Impossible de charger les vulnérabilités.";
          this.findings = [];
          this.totalElements = 0;
        }
      });
  }

  ingestNow(): void {
    if (!this.envId || this.ingesting) return;
    this.error = null;
    this.ingestResult = null;
    this.ingesting = true;

    this.pipelineService.getPipelineAndScan(this.envId).subscribe({
      next: (res: any) => {
        const pipelineId = res?.pipelineId;
        if (!pipelineId) {
          this.ingesting = false;
          this.error = "PipelineId introuvable pour cet environnement.";
          return;
        }

        this.findingsService.ingestPipeline(Number(pipelineId)).pipe(finalize(() => (this.ingesting = false))).subscribe({
          next: (r) => {
            this.ingestResult = r;
            this.reload();
          },
          error: (err) => {
            const msg = err?.error?.error || err?.error?.message || err?.message;
            this.error = msg
              ? `Ingestion échouée: ${msg}`
              : "Ingestion échouée (job aggregate-report manquant ou pipeline non terminé).";
          }
        });
      },
      error: () => {
        this.ingesting = false;
        this.error = "Impossible de récupérer le pipeline pour cet environnement.";
      }
    });
  }

  nextPage(): void {
    if ((this.page + 1) * this.size >= this.totalElements) return;
    this.page++;
    this.reload();
  }

  prevPage(): void {
    if (this.page <= 0) return;
    this.page--;
    this.reload();
  }

  /** Page dédiée : code, IA, chat (voir `VulnerabilityDetailsComponent`). */
  openDetail(f: FindingItem): void {
    if (!this.envId || !f?.id) return;
    this.router.navigate(['vulnerabilities', f.id], {
      relativeTo: this.route.parent,
      queryParams: { envId: this.envId }
    });
  }

  /** Filtre outil / sévérité côté API ; ici seule la recherche texte reste locale sur la page chargée. */
  get displayedFindings(): FindingItem[] {
    let list = this.findings;
    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(f => {
        const blob = [
          f.title,
          f.ruleId,
          f.fingerprint,
          f.filePath,
          f.packageName,
          f.cve,
          f.scanType,
          f.toolName
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return blob.includes(q);
      });
    }
    return list;
  }

  /** Tous les outils connus pour l’env (stats globales), pas seulement la page courante du tableau. */
  get toolFilterOptions(): string[] {
    const set = new Set<string>();
    const byTool = this.stats?.byTool;
    if (byTool && typeof byTool === 'object') {
      for (const k of Object.keys(byTool)) {
        if (k?.trim()) set.add(k);
      }
    }
    for (const f of this.findings) {
      if (f.toolName?.trim()) set.add(f.toolName);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  onListFiltersChanged(): void {
    if (!this.envId) return;
    this.page = 0;
    this.reload();
  }

  clearFilters(): void {
    this.filterSeverity = '';
    this.filterTool = '';
    this.searchQuery = '';
    this.page = 0;
    if (this.envId) this.reload();
  }

  hasActiveFilters(): boolean {
    return !!(this.filterSeverity || this.filterTool || this.searchQuery.trim());
  }
}
