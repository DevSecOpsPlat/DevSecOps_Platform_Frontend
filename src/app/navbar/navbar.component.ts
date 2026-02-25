import { Component, HostListener, OnInit } from '@angular/core';
import { AuthService } from '../services/auth/auth.service';
import { ThemeService } from '../services/ui/theme.service';
import { ApplicationService } from '../services/application/application.service';
import { ApplicationResponse } from '../models/application/application-response';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent implements OnInit {
  menuOpen = false;
  userMenuOpen = false;
  appDropdownOpen = false;
  applications: ApplicationResponse[] = [];
  selectedApp: ApplicationResponse | null = null;

  constructor(
    public authService: AuthService,
    public themeService: ThemeService,
    private applicationService: ApplicationService
  ) {}

  ngOnInit(): void {
    this.authService.isLoggedIn$.subscribe(logged => {
      if (logged) this.loadApplications();
    });
    this.loadApplications();
  }

  loadApplications(): void {
    if (!this.authService.isAuthenticated()) return;
    this.applicationService.getMyApplications().subscribe({
      next: apps => { this.applications = apps; if (apps.length && !this.selectedApp) this.selectedApp = apps[0]; }
    });
  }

  selectApp(app: ApplicationResponse): void {
    this.selectedApp = app;
  }

  get user() {
    return this.authService.getCurrentUser();
  }

  get isAdmin(): boolean {
    return this.authService.hasRole('ROLE_ADMIN');
  }

  get isTester(): boolean {
    return this.authService.hasRole('ROLE_TESTER');
  }

  logout(): void {
    this.userMenuOpen = false;
    this.menuOpen = false;
    this.authService.logout();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (this.userMenuOpen && target && !target.closest('.user-menu-wrap')) this.userMenuOpen = false;
    if (this.appDropdownOpen && target && !target.closest('.app-dropdown-wrap')) this.appDropdownOpen = false;
  }
}
