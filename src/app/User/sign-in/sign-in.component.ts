import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, of, Subscription } from 'rxjs';
import { AuthService } from 'src/app/services/auth/auth.service';
import { UserService } from 'src/app/services/user/user.service';

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
  errorMessage = '';
  isLoading = false;
  /** Verrouillage lié à l'identifiant qui a échoué 3 fois — pas au formulaire entier. */
  lockedIdentifier: string | null = null;
  minutesRemaining = 0;

  private usernameSub?: Subscription;

  constructor(
    private authService: AuthService,
    private userService: UserService,
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

  /** Verrouillage affiché uniquement pour le compte actuellement saisi. */
  get isLockedForCurrentUser(): boolean {
    if (!this.lockedIdentifier) {
      return false;
    }
    return this.currentIdentifier === this.lockedIdentifier;
  }

  get submitDisabled(): boolean {
    return this.isLoading || this.formSignin.invalid || this.isLockedForCurrentUser;
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
      if (response) {
        this.isLoading = false;
        this.clearErrors();
        const roles = response.roles || [];
        if (response.mustChangePassword) {
          this.router.navigate(['/profile'], { queryParams: { forcePassword: '1' } });
          return;
        }
        if (roles.includes('ROLE_ADMIN')) {
          this.router.navigate(['/admin-home']);
        } else {
          this.router.navigate(['/home']);
        }
      }
    });
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
