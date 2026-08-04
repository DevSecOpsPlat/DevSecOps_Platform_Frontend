import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { AppServiceModel, ManagedApp } from '../../models/application-management/application-management.models';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import { SECTION_MAP } from '../envirotest-nav-sidebar/envirotest-nav-sidebar.component';

@Component({
  selector: 'app-service-context-bar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './service-context-bar.component.html',
  styleUrls: ['./service-context-bar.component.css']
})
export class ServiceContextBarComponent implements OnInit, OnDestroy {
  serviceId = '';
  managedApp: ManagedApp | null = null;
  currentService: AppServiceModel | null = null;
  menuOpen = false;
  private activeKey = 'overview';
  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private appMgmt: ApplicationManagementService
  ) {}

  ngOnInit(): void {
    this.sync(this.router.url);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntil(this.destroy$)
      )
      .subscribe((e) => this.sync(e.urlAfterRedirects));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get siblings(): AppServiceModel[] {
    return (this.managedApp?.services || []).filter(s => !!s.id);
  }

  get appLink(): string[] {
    const id = this.managedApp?.id;
    const path = (SECTION_MAP[this.activeKey] || SECTION_MAP['overview']).app;
    return id ? ['/projects', id, path] : ['/projects'];
  }

  get appLabel(): string {
    return this.managedApp?.name || 'Application';
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  select(svc: AppServiceModel): void {
    if (!svc?.id) return;
    this.menuOpen = false;
    const path = (SECTION_MAP[this.activeKey] || SECTION_MAP['overview']).service;
    this.router.navigate(['/project', svc.id, path]);
  }

  @HostListener('document:click')
  close(): void {
    this.menuOpen = false;
  }

  private sync(url: string): void {
    const path = url.split(/[?#]/)[0];
    const m = path.match(/^\/project\/([^/]+)(?:\/([^/]+))?/);
    if (!m) {
      this.serviceId = '';
      return;
    }
    const next = m[1];
    const section = (m[2] || 'overview').toLowerCase();
    this.activeKey = this.keyFromSection(section);
    if (next !== this.serviceId) {
      this.serviceId = next;
      this.load(next);
    }
  }

  private keyFromSection(section: string): string {
    if (section === 'security-dashboard' || section === 'security') return 'defectdojo';
    for (const k of Object.keys(SECTION_MAP)) {
      if (SECTION_MAP[k].service === section) return k;
    }
    return 'overview';
  }

  private load(serviceId: string): void {
    this.appMgmt.getDeployContext(serviceId).pipe(takeUntil(this.destroy$)).subscribe({
      next: (ctx) => {
        const id = ctx?.managedApplicationId;
        if (!id) return;
        this.appMgmt.get(id).pipe(takeUntil(this.destroy$)).subscribe({
          next: (app) => {
            this.managedApp = app;
            this.currentService = (app.services || []).find(s => s.id === serviceId) || null;
          }
        });
      }
    });
  }
}
