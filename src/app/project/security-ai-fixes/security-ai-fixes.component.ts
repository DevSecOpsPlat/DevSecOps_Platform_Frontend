import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { distinctUntilChanged, finalize, map, takeUntil } from 'rxjs/operators';
import { EnvironmentService } from '../../services/environment/environment.service';
import { FindingsService, FindingItem, ScaFixesStatsResponse } from '../../services/findings/findings.service';
import { UserService } from 'src/app/services/user/user.service';

@Component({
  selector: 'app-security-ai-fixes',
  templateUrl: './security-ai-fixes.component.html',
  styleUrls: ['./security-ai-fixes.component.css']
})
export class SecurityAiFixesComponent implements OnInit, OnDestroy {
  private readonly destroy$ = new Subject<void>();

  envId: string | null = null;
  loading = false;
  error: string | null = null;
  feedback: string | null = null;

  stats: ScaFixesStatsResponse | null = null;
  fixes: FindingItem[] = [];
  actionId: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private environmentService: EnvironmentService,
    private findingsService: FindingsService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    if (!this.userService.getToken()) {
      this.error = 'Vous devez être authentifié.';
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
            this.loadAll();
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
                this.loadAll();
              }
            },
            error: () => {
              this.error =
                'Impossible de récupérer un environnement. Ouvre la page avec ?envId=... ou crée un environnement.';
            }
          });
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAll(): void {
    if (!this.envId) {
      this.error = 'Aucun environnement.';
      return;
    }
    this.error = null;
    this.feedback = null;
    this.loading = true;
    this.findingsService.getScaFixesStatsByEnvironment(this.envId).subscribe({
      next: s => (this.stats = s),
      error: () => (this.stats = null)
    });
    this.findingsService
      .listScaFixesOpenByEnvironment(this.envId, 0, 100)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: res => (this.fixes = res.content ?? []),
        error: () => {
          this.error = 'Impossible de charger les correctifs SCA.';
          this.fixes = [];
        }
      });
  }

  goVulnerabilities(): void {
    const appId =
      this.route.parent?.snapshot.paramMap.get('appId') ||
      localStorage.getItem('envirotest-last-project-app-id');
    const qp = this.envId ? { envId: this.envId } : {};
    if (appId) {
      this.router.navigate(['/project', appId, 'vulnerabilities'], { queryParams: qp });
    } else {
      this.router.navigate(['/my-applications']);
    }
  }

  suggestionText(f: FindingItem): string {
    const pkg = f.packageName || f.title || 'dépendance';
    const cve = f.cve ? ` (${f.cve})` : '';
    if (f.fixedVersion) {
      return `Mettre à jour ${pkg} vers ${f.fixedVersion}${cve} pour corriger la vulnérabilité signalée par le scanner.`;
    }
    const base = f.description || f.title;
    if (base) {
      return base.length > 400 ? base.slice(0, 400) + '…' : base;
    }
    return 'Consulter le rapport du scanner (npm-audit, Trivy, etc.) et appliquer la version corrigée ou le correctif recommandé.';
  }

  installHint(f: FindingItem): string | null {
    const pkg = f.packageName;
    const v = f.fixedVersion;
    if (!pkg || !v) return null;
    const t = (f.toolName || '').toLowerCase();
    if (t.includes('npm')) return `npm install ${pkg}@${v}`;
    if (t.includes('pip')) return `pip install "${pkg}==${v}"`;
    if (t.includes('trivy') && pkg.includes('/')) return null;
    return null;
  }

  displayTitle(f: FindingItem): string {
    const cve = f.cve || f.ruleId || 'Vulnérabilité';
    const pkg = f.packageName ? `${f.packageName}` : f.title || 'dépendance';
    const ver = f.installedVersion ? ` ${f.installedVersion}` : '';
    return `${cve} – ${pkg}${ver}`;
  }

  severityClass(sev?: string): string {
    const s = (sev || 'info').toLowerCase();
    return `severity-badge ${s}`;
  }

  applyFix(f: FindingItem): void {
    const hint = this.installHint(f);
    this.feedback = null;
    if (hint) {
      navigator.clipboard.writeText(hint).then(
        () => (this.feedback = `Commande copiée : ${hint}`),
        () => (this.feedback = `Exécute dans ton repo : ${hint}`)
      );
    } else if (f.fixedVersion && f.packageName) {
      this.feedback = `Mets à jour ${f.packageName} vers ${f.fixedVersion} (package.json, requirements.txt, etc.).`;
    } else {
      this.feedback = 'Pas de commande automatique : utilise le dashboard vulnérabilités ou le rapport du pipeline.';
    }
  }

  markIgnored(f: FindingItem): void {
    if (!this.envId || !f.id) return;
    this.actionId = f.id;
    this.findingsService.updateFindingStatus(f.id, this.envId, 'IGNORED').pipe(finalize(() => (this.actionId = null))).subscribe({
      next: () => {
        this.feedback = 'Finding ignoré.';
        this.loadAll();
      },
      error: () => (this.feedback = 'Échec mise à jour du statut.')
    });
  }

  markFixed(f: FindingItem): void {
    if (!this.envId || !f.id) return;
    this.actionId = f.id;
    this.findingsService.updateFindingStatus(f.id, this.envId, 'FIXED').pipe(finalize(() => (this.actionId = null))).subscribe({
      next: () => {
        this.feedback = 'Marqué comme corrigé.';
        this.loadAll();
      },
      error: () => (this.feedback = 'Échec mise à jour du statut.')
    });
  }
}
