import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): boolean | UrlTree {
    if (!this.authService.isAuthenticated()) {
      return this.router.parseUrl('/sign-in');
    }

    if (this.authService.mustChangePassword()) {
      return this.router.createUrlTree(['/profile'], { queryParams: { forcePassword: '1' } });
    }

    if (this.authService.requiresTwoFactorSetup()) {
      return this.router.createUrlTree(['/profile'], { queryParams: { force2fa: '1' } });
    }

    if (this.authService.hasRole('ROLE_ADMIN')) {
      return true;
    }

    return this.router.parseUrl('/environments');
  }
}
