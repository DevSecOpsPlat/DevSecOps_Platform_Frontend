import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';
import { UserService } from '../../services/user/user.service';
import { UserProfile } from '../../models/user/profile.models';
import { TwoFactorSetupResponse } from '../../models/user/signin-response';
import { passwordStrengthValidator } from '../../shared/password/password-strength.validator';
import { isPasswordStrong } from '../../shared/password/password-rules';

type ProfilePanel = 'overview' | 'email' | 'password' | 'twofactor';
type TwoFactorMethodUi = 'TOTP' | 'EMAIL';
type TwoFactorSetupView = 'choose' | 'totp' | 'email';

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
    newPassword: new FormControl('', [Validators.required, passwordStrengthValidator()]),
    confirmPassword: new FormControl('', [Validators.required])
  });

  emailSaving = false;
  emailSuccess: string | null = null;
  emailError: string | null = null;

  passwordSaving = false;
  passwordSuccess: string | null = null;
  passwordError: string | null = null;
  forcePasswordChange = false;
  forceTwoFactorSetup = false;

  twoFactorEnabled = false;
  twoFactorRequired = false;
  twoFactorMandatory = true;
  twoFactorMethod: TwoFactorMethodUi | null = null;
  setupView: TwoFactorSetupView = 'choose';
  switchingMethod = false;

  twoFactorSetup: TwoFactorSetupResponse | null = null;
  emailCodeSent = false;
  emailSetupMessage: string | null = null;

  twoFactorEnableForm = new FormGroup({
    code: new FormControl('', [Validators.required, Validators.pattern(/^\d{6}$/)]),
    currentPassword: new FormControl('')
  });

  twoFactorSaving = false;
  twoFactorSuccess: string | null = null;
  twoFactorError: string | null = null;

  showEmailPassword = false;
  showCurrentPassword = false;
  showNewPassword = false;
  showConfirmPassword = false;

  constructor(
    public authService: AuthService,
    private userService: UserService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.forcePasswordChange = params.get('forcePassword') === '1';
      this.forceTwoFactorSetup = params.get('force2fa') === '1';
      if (this.forcePasswordChange) {
        this.activePanel = 'password';
      } else if (this.forceTwoFactorSetup) {
        this.activePanel = 'twofactor';
      }
    });
    this.loadProfile();
  }

  get user() {
    return this.profile ?? this.authService.getCurrentUser();
  }

  get roleLabel(): string {
    const roles = this.user?.roles ?? [];
    if (roles.includes('ROLE_ADMIN')) return 'Administrateur';
    if (roles.includes('ROLE_TESTER')) return 'Utilisateur métier';
    return roles.join(', ') || 'Utilisateur';
  }

  get accountStatusLabel(): string {
    const status = (this.profile?.accountStatus || '').toUpperCase();
    const map: Record<string, string> = { ACTIVE: 'Actif', DISABLED: 'Désactivé' };
    return map[status] || status || 'Actif';
  }

  get newPasswordStrong(): boolean {
    return isPasswordStrong(this.passwordForm.get('newPassword')?.value ?? '');
  }

  get passwordsMismatch(): boolean {
    const pwd = this.passwordForm.get('newPassword')?.value ?? '';
    const confirm = this.passwordForm.get('confirmPassword')?.value ?? '';
    return confirm.length > 0 && pwd !== confirm;
  }

  get twoFactorMethodLabel(): string {
    if (this.twoFactorMethod === 'EMAIL') return 'Code par e-mail';
    if (this.twoFactorMethod === 'TOTP') return 'Application d\'authentification';
    return '—';
  }

  get needsSwitchPassword(): boolean {
    return this.switchingMethod;
  }

  loadProfile(): void {
    this.loading = true;
    this.error = null;
    this.userService.getProfile().subscribe({
      next: profile => {
        this.profile = profile;
        this.twoFactorEnabled = !!(profile.twoFactorEnabled ?? profile.totpEnabled);
        this.twoFactorRequired = !!profile.mustEnableTwoFactor;
        this.twoFactorMethod = (profile.twoFactorMethod as TwoFactorMethodUi) ?? null;
        this.userService.updateSecurityState({
          totpEnabled: this.twoFactorEnabled,
          twoFactorEnabled: this.twoFactorEnabled,
          twoFactorMethod: profile.twoFactorMethod ?? '',
          mustEnableTwoFactor: !!profile.mustEnableTwoFactor
        });
        if (profile.mustEnableTwoFactor && !this.forcePasswordChange) {
          this.forceTwoFactorSetup = true;
          this.activePanel = 'twofactor';
          this.setupView = 'choose';
        }
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
            accountStatus: 'ACTIVE'
          };
          this.emailForm.patchValue({ email: cached.email });
        }
      }
    });
  }

  setPanel(panel: ProfilePanel): void {
    if (this.forcePasswordChange && panel !== 'password') return;
    if ((this.forceTwoFactorSetup || this.twoFactorRequired) && panel !== 'twofactor') return;
    this.activePanel = panel;
    this.emailSuccess = null;
    this.emailError = null;
    this.passwordSuccess = null;
    this.passwordError = null;
    this.twoFactorSuccess = null;
    this.twoFactorError = null;
  }

  startChangeMethod(): void {
    this.switchingMethod = true;
    this.setupView = 'choose';
    this.twoFactorSetup = null;
    this.emailCodeSent = false;
    this.emailSetupMessage = null;
    this.twoFactorEnableForm.reset();
    this.twoFactorError = null;
    this.twoFactorSuccess = null;
  }

  cancelChangeMethod(): void {
    this.switchingMethod = false;
    this.setupView = 'choose';
    this.twoFactorSetup = null;
    this.emailCodeSent = false;
    this.twoFactorEnableForm.reset();
  }

  selectSetupMethod(method: TwoFactorMethodUi): void {
    this.twoFactorError = null;
    this.twoFactorSuccess = null;
    const savedPassword = (this.twoFactorEnableForm.get('currentPassword')?.value ?? '').trim();
    if (this.switchingMethod && !savedPassword) {
      this.twoFactorError = 'Saisissez votre mot de passe avant de choisir une méthode.';
      return;
    }
    this.twoFactorSetup = null;
    this.emailCodeSent = false;
    this.emailSetupMessage = null;
    this.twoFactorEnableForm.patchValue({ code: '' });
    this.setupView = method === 'TOTP' ? 'totp' : 'email';
    if (method === 'TOTP') {
      this.beginTotpSetup();
    } else {
      this.beginEmailSetup();
    }
  }

  beginTotpSetup(): void {
    const pwd = (this.twoFactorEnableForm.get('currentPassword')?.value ?? '').trim();
    if (this.switchingMethod && !pwd) {
      this.twoFactorError = 'Saisissez votre mot de passe pour changer de méthode.';
      return;
    }
    this.twoFactorSaving = true;
    this.userService.setupTotpTwoFactor(pwd || undefined).subscribe({
      next: setup => {
        this.twoFactorSetup = setup;
        this.twoFactorSaving = false;
      },
      error: err => {
        this.twoFactorSaving = false;
        this.twoFactorError = err?.error?.message || 'Impossible de démarrer la configuration TOTP.';
      }
    });
  }

  beginEmailSetup(): void {
    const pwd = (this.twoFactorEnableForm.get('currentPassword')?.value ?? '').trim();
    if (this.switchingMethod && !pwd) {
      this.twoFactorError = 'Saisissez votre mot de passe pour changer de méthode.';
      return;
    }
    this.twoFactorSaving = true;
    this.userService.setupEmailTwoFactor(pwd || undefined).subscribe({
      next: res => {
        this.twoFactorSaving = false;
        this.emailCodeSent = res.emailSent;
        this.emailSetupMessage = res.message;
        if (!res.emailSent) {
          this.twoFactorError = res.message;
        }
      },
      error: err => {
        this.twoFactorSaving = false;
        this.twoFactorError = err?.error?.message || 'Impossible d\'envoyer le code e-mail.';
      }
    });
  }

  enableTotp(): void {
    if (this.twoFactorEnableForm.invalid) {
      this.twoFactorEnableForm.markAllAsTouched();
      return;
    }
    this.twoFactorSaving = true;
    this.twoFactorError = null;
    const code = this.twoFactorEnableForm.get('code')?.value ?? '';
    const pwd = this.twoFactorEnableForm.get('currentPassword')?.value ?? undefined;
    this.userService.enableTotpTwoFactor(code, pwd || undefined).subscribe({
      next: res => this.onTwoFactorActivated(res.message, 'TOTP'),
      error: err => {
        this.twoFactorSaving = false;
        this.twoFactorError = err?.error?.message || 'Activation impossible.';
      }
    });
  }

  enableEmail(): void {
    if (this.twoFactorEnableForm.invalid) {
      this.twoFactorEnableForm.markAllAsTouched();
      return;
    }
    this.twoFactorSaving = true;
    this.twoFactorError = null;
    const code = this.twoFactorEnableForm.get('code')?.value ?? '';
    const pwd = this.twoFactorEnableForm.get('currentPassword')?.value ?? undefined;
    this.userService.enableEmailTwoFactor(code, pwd || undefined).subscribe({
      next: res => this.onTwoFactorActivated(res.message, 'EMAIL'),
      error: err => {
        this.twoFactorSaving = false;
        this.twoFactorError = err?.error?.message || 'Activation impossible.';
      }
    });
  }

  private onTwoFactorActivated(message: string, method: TwoFactorMethodUi): void {
    this.twoFactorSaving = false;
    this.twoFactorEnabled = true;
    this.twoFactorRequired = false;
    this.twoFactorMethod = method;
    this.switchingMethod = false;
    this.setupView = 'choose';
    this.twoFactorSetup = null;
    this.emailCodeSent = false;
    this.twoFactorEnableForm.reset();
    this.twoFactorSuccess = message;
    this.authService.markTwoFactorEnabled(method);
    this.loadProfile();
    if (this.forceTwoFactorSetup) {
      this.authService.navigateAfterSetupComplete();
    }
  }

  encodeUri(value: string): string {
    return encodeURIComponent(value);
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
        this.forcePasswordChange = false;
        this.authService.clearMustChangePassword();
        if (this.authService.requiresTwoFactorSetup()) {
          this.forceTwoFactorSetup = true;
          this.activePanel = 'twofactor';
          this.setupView = 'choose';
        }
      },
      error: err => {
        this.passwordSaving = false;
        this.passwordError = err?.error?.message || 'Modification impossible.';
      }
    });
  }
}
