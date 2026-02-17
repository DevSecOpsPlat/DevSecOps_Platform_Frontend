import { Injectable } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {

  constructor(private authService: AuthService, private router: Router) {}

  canActivate(): boolean | UrlTree {
    if (this.authService.isAuthenticated() && this.authService.hasRole('ROLE_ADMIN')) {
      return true;
    }
    // Rediriger les non-admins vers la page principale utilisateur
    return this.router.parseUrl('/environments');
  }
}

