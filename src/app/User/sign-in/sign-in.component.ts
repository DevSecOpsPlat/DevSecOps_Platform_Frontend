import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, of, Subscription } from 'rxjs';
import { AuthService } from '../../services/auth/auth.service';
import { SigninResponse } from '../../models/user/signin-response';

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

  /** Onglet affiché : connexion ou explication de l'obtention d'un compte. */
  activeTab: 'login' | 'access' = 'login';
  showPassword = false;
  capsLockOn = false;
  /** Secousse brève de la carte après un échec de connexion. */
  shake = false;
  private shakeTimer?: ReturnType<typeof setTimeout>;

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
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
  }

  onPasswordKey(event: KeyboardEvent): void {
    if (typeof event.getModifierState === 'function') {
      this.capsLockOn = event.getModifierState('CapsLock');
    }
  }

  private triggerShake(): void {
    this.shake = false;
    if (this.shakeTimer) clearTimeout(this.shakeTimer);
    setTimeout(() => {
      this.shake = true;
      this.shakeTimer = setTimeout(() => (this.shake = false), 600);
    });
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
        this.triggerShake();
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
        this.triggerShake();
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

  /** Méthode application, téléphone indisponible : recevoir plutôt un code à l'e-mail du compte. */
  useEmailCodeInstead(): void {
    if (!this.pendingLoginId || this.twoFactorMethod !== 'TOTP' || this.resendLoading) return;
    this.resendLoading = true;
    this.errorMessage = '';
    this.authService.resendLoginTwoFactor(this.pendingLoginId).subscribe({
      next: res => {
        this.resendLoading = false;
        this.twoFactorMethod = 'EMAIL';
        this.twoFactorInfoMessage = res.message;
        this.totpForm.reset();
      },
      error: err => {
        this.resendLoading = false;
        this.errorMessage = err?.error?.message || 'Envoi du code par e-mail impossible.';
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
