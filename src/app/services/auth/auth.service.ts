import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { UserService } from '../user/user.service';
import { SigninPayload } from '../../models/user/signin-payload';
import { SigninResponse, VerifyTwoFactorPayload } from '../../models/user/signin-response';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private isLoggedInSubject = new BehaviorSubject<boolean>(false);
  public isLoggedIn$ = this.isLoggedInSubject.asObservable();

  constructor(private userService: UserService, private router: Router) {
    this.checkAuthState();
  }

  private checkAuthState(): void {
    const token = this.userService.getToken();
    this.isLoggedInSubject.next(!!token);
  }

  login(credentials: SigninPayload): Observable<SigninResponse> {
    return this.userService.signin(credentials);
  }

  resendLoginTwoFactor(pendingLoginId: string): Observable<{ message: string; emailSent: boolean }> {
    return this.userService.resendLoginTwoFactor(pendingLoginId);
  }

  verifyTwoFactor(payload: VerifyTwoFactorPayload): Observable<SigninResponse> {
    return this.userService.verifyTwoFactor(payload).pipe(
      tap((response: SigninResponse) => this.persistSession(response))
    );
  }

  completeLogin(response: SigninResponse): void {
    this.persistSession(response);
    this.isLoggedInSubject.next(true);
  }

  private persistSession(response: SigninResponse): void {
    if (response.accessToken) {
      this.userService.saveToken(response.accessToken);
      this.userService.saveRefreshToken(response.refreshToken ?? '');
      this.userService.saveUser(response);
      this.isLoggedInSubject.next(true);
    }
  }

  navigateAfterLogin(response: SigninResponse): void {
    const roles = response.roles || [];
    if (response.mustChangePassword) {
      this.router.navigate(['/profile'], { queryParams: { forcePassword: '1' } });
      return;
    }
    if (response.mustEnableTwoFactor || !(response.twoFactorEnabled ?? response.totpEnabled)) {
      this.router.navigate(['/profile'], { queryParams: { force2fa: '1' } });
      return;
    }
    if (roles.includes('ROLE_ADMIN')) {
      this.router.navigate(['/admin/home']);
    } else {
      this.router.navigate(['/home']);
    }
  }

  mustChangePassword(): boolean {
    const user = this.getCurrentUser();
    return !!user?.mustChangePassword;
  }

  requiresTwoFactorSetup(): boolean {
    const user = this.getCurrentUser();
    if (!user) {
      return false;
    }
    if (user.twoFactorEnabled === true || user.totpEnabled === true) {
      return false;
    }
    return user.mustEnableTwoFactor === true
      || user.twoFactorEnabled === false
      || user.totpEnabled === false
      || (user.twoFactorEnabled == null && user.totpEnabled == null);
  }

  clearMustChangePassword(): void {
    this.userService.updateSecurityState({ mustChangePassword: false });
  }

  markTwoFactorEnabled(method: 'TOTP' | 'EMAIL' = 'TOTP'): void {
    this.userService.updateSecurityState({
      totpEnabled: true,
      twoFactorEnabled: true,
      twoFactorMethod: method,
      mustEnableTwoFactor: false
    });
  }

  navigateAfterSetupComplete(): void {
    const user = this.getCurrentUser();
    this.navigateAfterLogin({
      username: user?.username ?? '',
      roles: user?.roles ?? [],
      totpEnabled: true,
      twoFactorEnabled: true,
      mustEnableTwoFactor: false,
      mustChangePassword: false
    });
  }

  logout(): void {
    this.userService.clear();
    this.isLoggedInSubject.next(false);
    this.router.navigate(['/home']);
  }

  silentLogout(): void {
    this.userService.clear();
    this.isLoggedInSubject.next(false);
  }

  getCurrentUser(): any {
    return this.userService.getUser();
  }

  isAuthenticated(): boolean {
    return !!this.userService.getToken();
  }

  hasRole(role: string): boolean {
    const user = this.getCurrentUser();
    return !!user && Array.isArray(user.roles) && user.roles.includes(role);
  }

  getRoles(): string[] {
    const user = this.getCurrentUser();
    return user && Array.isArray(user.roles) ? user.roles : [];
  }
}
