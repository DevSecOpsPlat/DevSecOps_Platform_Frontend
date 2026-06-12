import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth/auth.service';
import { UserService } from '../../services/user/user.service';
import { UserProfile } from '../../models/user/profile.models';

type ProfilePanel = 'overview' | 'email' | 'password';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit {
  profile: UserProfile | null = null;
  loading = true;
  error: string | null = null;

  activePanel: ProfilePanel = 'overview';

  emailForm = new FormGroup({
    email: new FormControl('', [Validators.required, Validators.email]),
    currentPassword: new FormControl('', [Validators.required])
  });

  passwordForm = new FormGroup({
    currentPassword: new FormControl('', [Validators.required]),
    newPassword: new FormControl('', [Validators.required, Validators.minLength(8)]),
    confirmPassword: new FormControl('', [Validators.required])
  });

  emailSaving = false;
  emailSuccess: string | null = null;
  emailError: string | null = null;

  passwordSaving = false;
  passwordSuccess: string | null = null;
  passwordError: string | null = null;

  showEmailPassword = false;
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;

  constructor(
    public authService: AuthService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  get user() {
    return this.profile ?? this.authService.getCurrentUser();
  }

  get roleLabel(): string {
    const roles = this.user?.roles ?? [];
    if (roles.includes('ROLE_ADMIN')) {
      return 'Administrateur';
    }
    if (roles.includes('ROLE_TESTER')) {
      return 'Utilisateur métier';
    }
    return roles.join(', ') || 'Utilisateur';
  }

  get accountStatusLabel(): string {
    const status = (this.profile?.accountStatus || '').toUpperCase();
    const map: Record<string, string> = {
      APPROVED: 'Actif',
      PENDING: 'En attente',
      REJECTED: 'Rejeté',
      SUSPENDED: 'Suspendu'
    };
    return map[status] || status || 'Actif';
  }

  get passwordsMismatch(): boolean {
    const pwd = this.passwordForm.get('newPassword')?.value ?? '';
    const confirm = this.passwordForm.get('confirmPassword')?.value ?? '';
    return confirm.length > 0 && pwd !== confirm;
  }

  loadProfile(): void {
    this.loading = true;
    this.error = null;
    this.userService.getProfile().subscribe({
      next: profile => {
        this.profile = profile;
        this.emailForm.patchValue({ email: profile.email });
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err?.error?.message || 'Impossible de charger votre profil.';
        const cached = this.authService.getCurrentUser();
        if (cached) {
          this.profile = {
            id: cached.id,
            username: cached.username,
            email: cached.email,
            roles: cached.roles ?? [],
            accountStatus: 'APPROVED'
          };
          this.emailForm.patchValue({ email: cached.email });
        }
      }
    });
  }

  setPanel(panel: ProfilePanel): void {
    this.activePanel = panel;
    this.emailSuccess = null;
    this.emailError = null;
    this.passwordSuccess = null;
    this.passwordError = null;
  }

  submitEmail(): void {
    if (this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }

    this.emailSaving = true;
    this.emailSuccess = null;
    this.emailError = null;

    const { email, currentPassword } = this.emailForm.getRawValue();
    this.userService.updateEmail({
      email: (email ?? '').trim(),
      currentPassword: currentPassword ?? ''
    }).subscribe({
      next: updated => {
        this.profile = updated;
        this.userService.updateStoredEmail(updated.email);
        this.emailForm.patchValue({ currentPassword: '' });
        this.emailSaving = false;
        this.emailSuccess = 'Adresse e-mail mise à jour avec succès.';
      },
      error: err => {
        this.emailSaving = false;
        this.emailError = err?.error?.message || 'Mise à jour impossible.';
      }
    });
  }

  submitPassword(): void {
    if (this.passwordForm.invalid || this.passwordsMismatch) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.passwordSaving = true;
    this.passwordSuccess = null;
    this.passwordError = null;

    const { currentPassword, newPassword } = this.passwordForm.getRawValue();
    this.userService.changePassword({
      currentPassword: currentPassword ?? '',
      newPassword: newPassword ?? ''
    }).subscribe({
      next: res => {
        this.passwordSaving = false;
        this.passwordSuccess = res.message || 'Mot de passe mis à jour.';
        this.passwordForm.reset();
      },
      error: err => {
        this.passwordSaving = false;
        this.passwordError = err?.error?.message || 'Modification impossible.';
      }
    });
  }
}
