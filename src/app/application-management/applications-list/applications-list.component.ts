import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { ManagedApp } from '../../models/application-management/application-management.models';
import { ProjectFormComponent, ProjectFormPayload } from '../project-form/project-form.component';

@Component({
  selector: 'app-managed-applications-list',
  standalone: true,
  imports: [CommonModule, RouterModule, ProjectFormComponent],
  templateUrl: './applications-list.component.html',
  styleUrls: ['../shared/app-management.shared.css', './applications-list.component.css']
})
export class ApplicationsListComponent implements OnInit {
  apps: ManagedApp[] = [];
  orphanServices: Array<{ id: string; name: string; description: string | null; gitRepositoryUrl: string | null }> = [];
  loading = true;
  error: string | null = null;

  showCreateForm = false;
  creating = false;
  createError: string | null = null;

  constructor(private api: ApplicationManagementService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  get totalServices(): number {
    return this.apps.reduce((n, a) => n + (a.services?.length ?? 0), 0);
  }

  get totalDatabases(): number {
    return this.apps.reduce((n, a) => n + (a.databases?.length ?? 0), 0);
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.list().subscribe({
      next: (apps) => {
        this.apps = apps ?? [];
        this.loading = false;
      },
      error: () => {
        this.error = 'Impossible de charger les projets.';
        this.loading = false;
      }
    });
    this.api.listOrphanServices().subscribe({
      next: (list) => (this.orphanServices = list ?? []),
      error: () => (this.orphanServices = [])
    });
  }

  open(app: ManagedApp): void {
    this.router.navigate(['/projects', app.id]);
  }

  create(): void {
    this.createError = null;
    this.showCreateForm = true;
  }

  cancelCreate(): void {
    if (this.creating) return;
    this.showCreateForm = false;
    this.createError = null;
  }

  saveProject(payload: ProjectFormPayload): void {
    this.creating = true;
    this.createError = null;
    this.api.create(payload).subscribe({
      next: (app) => {
        this.creating = false;
        this.showCreateForm = false;
        this.router.navigate(['/projects', app.id]);
      },
      error: (e) => {
        this.createError = e?.error?.message || 'Création impossible.';
        this.creating = false;
      }
    });
  }

  openOrphanServiceDashboard(svcId: string): void {
    this.router.navigate(['/project', svcId, 'overview']);
  }

  openOrphanSecurityDashboard(svcId: string): void {
    this.router.navigate(['/project', svcId, 'security-dashboard']);
  }

  formatDate(value?: unknown): string {
    const date = this.safeParseDate(value);
    if (!date) return '—';
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  /** Accepte ISO string, epoch, ou tableau Jackson LocalDateTime [y,m,d,h,mi,s]. */
  private safeParseDate(dateValue: unknown): Date | null {
    if (dateValue == null || dateValue === '') return null;
    try {
      if (typeof dateValue === 'number') {
        const date = new Date(dateValue < 1e12 ? dateValue * 1000 : dateValue);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (typeof dateValue === 'string') {
        const date = new Date(dateValue);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      if (Array.isArray(dateValue) && dateValue.length >= 3) {
        const [year, month, day, hour = 0, minute = 0, second = 0] = dateValue as number[];
        const date = new Date(year, month - 1, day, hour, minute, Math.floor(Number(second) || 0));
        return Number.isNaN(date.getTime()) ? null : date;
      }
      return null;
    } catch {
      return null;
    }
  }

  compositionLabel(app: ManagedApp): string {
    const parts: string[] = [];
    const fe = app.services.filter(s => s.role === 'FRONTEND').length;
    const be = app.services.filter(s => s.role === 'BACKEND').length;
    const wk = app.services.filter(s => s.role === 'WORKER').length;
    if (fe) parts.push(`${fe} frontend`);
    if (be) parts.push(`${be} backend`);
    if (wk) parts.push(`${wk} worker`);
    const dbEngines = [...new Set(app.databases.map(d => d.engine))];
    if (dbEngines.length) parts.push(dbEngines.join(', '));
    return parts.length ? 'Contient : ' + parts.join(' · ') : '';
  }

  stack(app: ManagedApp): 'Angular' | 'Spring' | 'React' | 'Service' {
    const refs = [
      app.slug,
      app.name,
      ...(app.services ?? []).map(s => `${s.name} ${s.gitRepositoryUrl ?? ''}`)
    ].join(' ').toLowerCase();
    if (refs.includes('angular')) return 'Angular';
    if (refs.includes('spring') || refs.includes('java')) return 'Spring';
    if (refs.includes('react')) return 'React';
    return 'Service';
  }

  stackIcon(stack: string): string {
    if (stack === 'Angular') return 'A';
    if (stack === 'Spring') return 'S';
    if (stack === 'React') return 'R';
    return '◆';
  }
}
