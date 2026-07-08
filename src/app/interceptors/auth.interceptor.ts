import { Injectable } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth/auth.service';
import { UserService } from '../services/user/user.service';

/** Attache le JWT à chaque appel API et redirige vers la connexion si la session a expiré. */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(
    private userService: UserService,
    private authService: AuthService,
    private router: Router
  ) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const apiBase = environment.BASE_URL;
    const isBackendApi = req.url.startsWith(apiBase) || req.url.includes('/projet/api/');

    let authReq = req;
    const token = this.userService.getToken();
    if (isBackendApi && token && !req.headers.has('Authorization')) {
      authReq = req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
      });
    }

    return next.handle(authReq).pipe(
      catchError((err: HttpErrorResponse) => {
        const isLogin = req.url.includes('auth/login') || req.url.includes('auth/verify-2fa');
        if (isBackendApi && err.status === 401 && !isLogin) {
          this.authService.silentLogout();
          if (!this.router.url.startsWith('/sign-in')) {
            this.router.navigate(['/sign-in'], {
              queryParams: { returnUrl: this.router.url, reason: 'session-expired' },
            });
          }
        }
        return throwError(() => err);
      })
    );
  }
}
