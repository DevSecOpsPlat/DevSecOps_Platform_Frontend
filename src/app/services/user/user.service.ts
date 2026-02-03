import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../../models/user/user';
import { environment } from '../../../environments/environment';
import { SigninResponse } from '../../models/user/signin-response';
import { SigninPayload } from '../../models/user/signin-payload';
import { RegisterPayload } from '../../models/user/register-payload';

@Injectable({
  providedIn: 'root'
})
export class UserService {

  private TOKEN_KEY = 'auth_token';
  private REFRESH_TOKEN_KEY = 'auth_refresh_token';
  private USER_KEY = 'auth_user';

  constructor(private http: HttpClient) { }

  private readonly baseurl: string = `${environment.BASE_URL}`;

  // Authentication methods (match backend: AuthController uses /auth/register and /auth/login)
  signin(signinPayload: SigninPayload): Observable<SigninResponse> {
    return this.http.post<SigninResponse>(this.baseurl + "auth/login", signinPayload);
  }

  /** Register: backend expects exactly { username, password, email }. */
  register(payload: RegisterPayload): Observable<unknown> {
    return this.http.post(this.baseurl + "auth/register", payload);
  }

  getUserByUsername(username: string): Observable<User> {
    return this.http.get<User>(this.baseurl + 'user/username/' + username);
  }

  getUserById(id: number): Observable<User> {
    const token = this.getToken();
    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    return this.http.get<User>(this.baseurl + 'user/' + id, { headers });
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
    };
    localStorage.setItem(this.USER_KEY, JSON.stringify(userData));
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
