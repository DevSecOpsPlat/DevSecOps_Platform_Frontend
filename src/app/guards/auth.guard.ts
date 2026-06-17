import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean | UrlTree {
    if (!this.authService.isAuthenticated()) {
      return this.router.parseUrl('/sign-in');
    }

    if (this.authService.mustChangePassword() && !this.isProfileRoute(route)) {
      return this.router.createUrlTree(['/profile'], { queryParams: { forcePassword: '1' } });
    }

    if (this.authService.requiresTwoFactorSetup() && !this.isProfileRoute(route)) {
      return this.router.createUrlTree(['/profile'], { queryParams: { force2fa: '1' } });
    }

    return true;
  }

  private isProfileRoute(route: ActivatedRouteSnapshot): boolean {
    return route.routeConfig?.path === 'profile'
      || route.pathFromRoot.some(r => r.routeConfig?.path === 'profile');
  }
}
