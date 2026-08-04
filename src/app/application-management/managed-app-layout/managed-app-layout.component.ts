import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { ManagedAppStateService } from '../managed-app-state.service';
import { EnvirotestNavSidebarComponent } from '../../shared/envirotest-nav-sidebar/envirotest-nav-sidebar.component';

@Component({
  selector: 'app-managed-app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, EnvirotestNavSidebarComponent],
  templateUrl: './managed-app-layout.component.html',
  styleUrls: ['./managed-app-layout.component.css']
})
export class ManagedAppLayoutComponent implements OnInit, OnDestroy {
  appId = '';
  loading = true;
  error: string | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private state: ManagedAppStateService
  ) {}

  ngOnInit(): void {
    this.appId = this.route.snapshot.paramMap.get('id') || '';
    this.redirectLegacy();
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe(() => this.redirectLegacy());

    this.state.load(this.appId).subscribe({
      next: (app) => {
        this.loading = false;
        try {
          localStorage.setItem('envirotest-last-managed-app-id', this.appId);
          if (app?.name) localStorage.setItem('envirotest-last-managed-app-name', app.name);
        } catch { /* ignore */ }
      },
      error: () => {
        this.error = 'Application introuvable.';
        this.loading = false;
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.state.clear();
  }

  private redirectLegacy(): void {
    const url = this.router.url.split(/[?#]/)[0];
    const match = url.match(/\/projects\/[^/]+\/([^/]+)/);
    const section = (match?.[1] || '').toLowerCase();
    if (section === 'security') {
      this.router.navigate(['/projects', this.appId, 'defectdojo'], { replaceUrl: true });
      return;
    }
    if (section === 'services' || section === 'databases') {
      this.router.navigate(['/projects', this.appId, 'dashboard'], { replaceUrl: true });
    }
  }
}
