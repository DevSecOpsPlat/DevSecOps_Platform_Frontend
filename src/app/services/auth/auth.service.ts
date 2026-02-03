import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { UserService } from '../user/user.service';
import { SigninPayload } from '../../models/user/signin-payload';
import { SigninResponse } from '../../models/user/signin-response';

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
    return this.userService.signin(credentials)
      .pipe(
        tap((response: SigninResponse) => {
          this.userService.saveToken(response.accessToken);
          this.userService.saveRefreshToken(response.refreshToken ?? '');
          this.userService.saveUser(response);
          this.isLoggedInSubject.next(true);
        })
      );
  }

  logout(): void {
    this.userService.clear();
    this.isLoggedInSubject.next(false);
    this.router.navigate(['/home']);
  }

  getCurrentUser(): any {
    return this.userService.getUser();
  }

  isAuthenticated(): boolean {
    return !!this.userService.getToken();
  }
}
