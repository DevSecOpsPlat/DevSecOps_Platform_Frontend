import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../../models/user/user';
import { environment } from '../../../environments/environment';
import { SigninResponse, TwoFactorSetupResponse } from '../../models/user/signin-response';
import { SigninPayload } from '../../models/user/signin-payload';
import { ChangePasswordPayload, UpdateEmailPayload, UserProfile } from '../../models/user/profile.models';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  private TOKEN_KEY = 'auth_token';
  private REFRESH_TOKEN_KEY = 'auth_refresh_token';
  private USER_KEY = 'auth_user';

  constructor(private http: HttpClient) { }

  private readonly baseurl: string = `${environment.BASE_URL}`;

  // Authentication (AuthController: POST /auth/login)
  signin(signinPayload: SigninPayload): Observable<SigninResponse> {
    return this.http.post<SigninResponse>(this.baseurl + "auth/login", signinPayload);
  }

  verifyTwoFactor(payload: { pendingLoginId: string; code: string }): Observable<SigninResponse> {
    return this.http.post<SigninResponse>(this.baseurl + "auth/verify-2fa", payload);
  }

  getTwoFactorStatus(): Observable<{
    enabled: boolean;
    required: boolean;
    mandatory: boolean;
    method: string;
    accountEmail: string;
    enabledAt?: string;
  }> {
    return this.http.get<{
      enabled: boolean;
      required: boolean;
      mandatory: boolean;
      method: string;
      accountEmail: string;
      enabledAt?: string;
    }>(this.baseurl + 'api/profile/2fa/status', { headers: this.authHeaders() });
  }

  setupTotpTwoFactor(currentPassword?: string): Observable<TwoFactorSetupResponse> {
    return this.http.post<TwoFactorSetupResponse>(
      this.baseurl + 'api/profile/2fa/setup/totp',
      { currentPassword: currentPassword ?? null },
      { headers: this.authHeaders() }
    );
  }

  setupEmailTwoFactor(currentPassword?: string): Observable<{ message: string; emailSent: boolean; accountEmail: string }> {
    return this.http.post<{ message: string; emailSent: boolean; accountEmail: string }>(
      this.baseurl + 'api/profile/2fa/setup/email',
      { currentPassword: currentPassword ?? null },
      { headers: this.authHeaders() }
    );
  }

  enableTotpTwoFactor(code: string, currentPassword?: string): Observable<{ message: string; enabled: boolean; method: string }> {
    return this.http.post<{ message: string; enabled: boolean; method: string }>(
      this.baseurl + 'api/profile/2fa/enable/totp',
      { code, currentPassword: currentPassword ?? null },
      { headers: this.authHeaders() }
    );
  }

  enableEmailTwoFactor(code: string, currentPassword?: string): Observable<{ message: string; enabled: boolean; method: string }> {
    return this.http.post<{ message: string; enabled: boolean; method: string }>(
      this.baseurl + 'api/profile/2fa/enable/email',
      { code, currentPassword: currentPassword ?? null },
      { headers: this.authHeaders() }
    );
  }

  /** @deprecated use setupTotpTwoFactor */
  setupTwoFactor(): Observable<TwoFactorSetupResponse> {
    return this.setupTotpTwoFactor();
  }

  /** @deprecated use enableTotpTwoFactor */
  enableTwoFactor(code: string): Observable<{ message: string; enabled: boolean }> {
    return this.enableTotpTwoFactor(code);
  }

  resendLoginTwoFactor(pendingLoginId: string): Observable<{ message: string; emailSent: boolean }> {
    return this.http.post<{ message: string; emailSent: boolean }>(
      this.baseurl + 'auth/resend-2fa',
      { pendingLoginId }
    );
  }

  disableTwoFactor(code: string, currentPassword: string): Observable<{ message: string; enabled: boolean }> {
    return this.http.post<{ message: string; enabled: boolean }>(
      this.baseurl + 'api/profile/2fa/disable',
      { code, currentPassword },
      { headers: this.authHeaders() }
    );
  }

  getUserByUsername(username: string): Observable<User> {
    return this.http.get<User>(this.baseurl + 'user/username/' + username);
  }

  private authHeaders(): HttpHeaders {
    const token = this.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getProfile(): Observable<UserProfile> {
    return this.http.get<UserProfile>(this.baseurl + 'api/profile/me', { headers: this.authHeaders() });
  }

  updateEmail(payload: UpdateEmailPayload): Observable<UserProfile> {
    return this.http.patch<UserProfile>(this.baseurl + 'api/profile/email', payload, { headers: this.authHeaders() });
  }

  changePassword(payload: ChangePasswordPayload): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(this.baseurl + 'api/profile/password', payload, { headers: this.authHeaders() });
  }

  activateAccount(token: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(this.baseurl + 'auth/activate', { token, newPassword });
  }

  updateStoredEmail(email: string): void {
    const user = this.getUser();
    if (user) {
      this.saveUser({ ...user, email });
    }
  }

  // Token management
  saveToken(token: string): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.setItem(this.TOKEN_KEY, token);
  }

  saveRefreshToken(refreshToken: string): void {
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  saveUser(user: any): void {
    localStorage.removeItem(this.USER_KEY);
    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
      totpEnabled: !!(user.twoFactorEnabled ?? user.totpEnabled),
      twoFactorEnabled: !!(user.twoFactorEnabled ?? user.totpEnabled),
      twoFactorMethod: user.twoFactorMethod ?? '',
      mustEnableTwoFactor: !!user.mustEnableTwoFactor,
      mustChangePassword: !!user.mustChangePassword,
    };
    localStorage.setItem(this.USER_KEY, JSON.stringify(userData));
  }

  updateSecurityState(partial: {
    totpEnabled?: boolean;
    twoFactorEnabled?: boolean;
    twoFactorMethod?: string;
    mustEnableTwoFactor?: boolean;
    mustChangePassword?: boolean;
  }): void {
    const user = this.getUser();
    if (!user) return;
    this.saveUser({ ...user, ...partial });
  }

  getUser(): any {
    const userStr = localStorage.getItem(this.USER_KEY);
    if (userStr) {
      return JSON.parse(userStr);
    }
    return null;
  }

  clear(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }
}
