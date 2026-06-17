import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, of, Subscription } from 'rxjs';
import { AuthService } from 'src/app/services/auth/auth.service';
import { SigninResponse } from 'src/app/models/user/signin-response';

interface LoginErrorBody {
  message?: string;
  accountLocked?: boolean;
  lockedUntil?: string;
  minutesRemaining?: number;
  remainingAttempts?: number;
}

@Component({
  selector: 'app-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.css']
})
export class SignInComponent implements OnInit, OnDestroy {
  formSignin!: FormGroup;
  totpForm = new FormGroup({
    code: new FormControl('', [Validators.required, Validators.pattern(/^\d{6}$/)])
  });

  errorMessage = '';
  isLoading = false;
  lockedIdentifier: string | null = null;
  minutesRemaining = 0;

  /** Étape 2 : code 2FA après mot de passe valide. */
  twoFactorStep = false;
  pendingLoginId: string | null = null;
  twoFactorUsername = '';
  twoFactorMethod: 'TOTP' | 'EMAIL' = 'TOTP';
  twoFactorInfoMessage = '';
  resendLoading = false;

  private usernameSub?: Subscription;

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.formSignin = new FormGroup({
      username: new FormControl('', [Validators.required]),
      password: new FormControl('', [Validators.required])
    });

    this.usernameSub = this.formSignin.get('username')?.valueChanges.subscribe(() => {
      this.onIdentifierChanged();
    });

    this.authService.isLoggedIn$.subscribe(isLoggedIn => {
      if (isLoggedIn) {
        this.router.navigate(['/home']);
      }
    });
  }

  ngOnDestroy(): void {
    this.usernameSub?.unsubscribe();
  }

  get currentIdentifier(): string {
    return (this.formSignin.get('username')?.value ?? '').trim().toLowerCase();
  }

  get isLockedForCurrentUser(): boolean {
    if (!this.lockedIdentifier) {
      return false;
    }
    return this.currentIdentifier === this.lockedIdentifier;
  }

  get submitDisabled(): boolean {
    return this.isLoading || this.formSignin.invalid || this.isLockedForCurrentUser;
  }

  get totpSubmitDisabled(): boolean {
    return this.isLoading || this.totpForm.invalid;
  }

  signin(): void {
    if (!this.formSignin.valid) {
      this.errorMessage = 'Veuillez remplir tous les champs obligatoires.';
      return;
    }

    this.isLoading = true;
    this.clearErrors();

    this.authService.login(this.formSignin.value).pipe(
      catchError(error => {
        this.isLoading = false;
        const body: LoginErrorBody = error.error ?? {};
        const locked = !!body.accountLocked || error.status === 423;

        if (locked) {
          this.lockedIdentifier = this.currentIdentifier;
          this.minutesRemaining = body.minutesRemaining ?? 15;
          this.errorMessage = body.message || 'Compte verrouillé. Réessayez dans 15 minutes.';
        } else {
          this.lockedIdentifier = null;
          this.errorMessage = body.message || 'Identifiants invalides.';
        }
        return of(null);
      })
    ).subscribe(response => {
      this.isLoading = false;
      if (!response) return;

      if (response.requiresTwoFactor && response.pendingLoginId) {
        this.twoFactorStep = true;
        this.pendingLoginId = response.pendingLoginId;
        this.twoFactorUsername = response.username;
        this.twoFactorMethod = (response.twoFactorMethod as 'TOTP' | 'EMAIL') || 'TOTP';
        this.twoFactorInfoMessage = response.message || '';
        this.errorMessage = response.emailSent === false ? (response.message || '') : '';
        return;
      }

      if (response.accessToken) {
        this.authService.completeLogin(response);
        this.authService.navigateAfterLogin(response);
      }
    });
  }

  verifyTotp(): void {
    if (!this.pendingLoginId || this.totpForm.invalid) {
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';

    const code = (this.totpForm.get('code')?.value ?? '').trim();

    this.authService.verifyTwoFactor({ pendingLoginId: this.pendingLoginId, code }).pipe(
      catchError(err => {
        this.isLoading = false;
        this.errorMessage = err?.error?.message || 'Code incorrect.';
        return of(null);
      })
    ).subscribe(response => {
      this.isLoading = false;
      if (response?.accessToken) {
        this.authService.navigateAfterLogin(response);
      }
    });
  }

  resendEmailCode(): void {
    if (!this.pendingLoginId || this.twoFactorMethod !== 'EMAIL') return;
    this.resendLoading = true;
    this.authService.resendLoginTwoFactor(this.pendingLoginId).subscribe({
      next: res => {
        this.resendLoading = false;
        this.twoFactorInfoMessage = res.message;
      },
      error: err => {
        this.resendLoading = false;
        this.errorMessage = err?.error?.message || 'Renvoi impossible.';
      }
    });
  }

  backToPasswordStep(): void {
    this.twoFactorStep = false;
    this.pendingLoginId = null;
    this.twoFactorMethod = 'TOTP';
    this.twoFactorInfoMessage = '';
    this.totpForm.reset();
    this.errorMessage = '';
  }

  private onIdentifierChanged(): void {
    if (this.lockedIdentifier && this.currentIdentifier !== this.lockedIdentifier) {
      this.clearErrors();
    } else if (!this.lockedIdentifier && this.errorMessage) {
      this.errorMessage = '';
    }
  }

  private clearErrors(): void {
    this.errorMessage = '';
    this.lockedIdentifier = null;
    this.minutesRemaining = 0;
  }
}
