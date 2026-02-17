import { Component, HostListener } from '@angular/core';
import { AuthService } from '../services/auth/auth.service';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent {
  menuOpen = false;
  userMenuOpen = false;

  constructor(public authService: AuthService) {}

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
    if (this.userMenuOpen && target && !target.closest('.user-menu-wrap')) {
      this.userMenuOpen = false;
    }
  }
}
