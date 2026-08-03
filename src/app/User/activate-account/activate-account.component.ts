import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../services/user/user.service';
import { AuthService } from '../../services/auth/auth.service';
import { passwordStrengthValidator } from '../../shared/password/password-strength.validator';
import { isPasswordStrong } from '../../shared/password/password-rules';

@Component({
  selector: 'app-activate-account',
  templateUrl: './activate-account.component.html',
  styleUrls: ['./activate-account.component.css']
})
export class ActivateAccountComponent implements OnInit {
  form = new FormGroup({
    newPassword: new FormControl('', [Validators.required, passwordStrengthValidator()]),
    confirmPassword: new FormControl('', [Validators.required])
  });

  token = '';
  loading = false;
  success: string | null = null;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      this.authService.silentLogout();
    }

    this.route.queryParamMap.subscribe(params => {
      this.token = params.get('token') ?? '';
      if (!this.token) {
        this.error = 'Lien d\'activation invalide. Vérifiez l\'URL reçue par e-mail.';
      }
    });
  }

  get newPasswordStrong(): boolean {
    return isPasswordStrong(this.form.get('newPassword')?.value ?? '');
  }

  get passwordsMismatch(): boolean {
    const pwd = this.form.get('newPassword')?.value ?? '';
    const confirm = this.form.get('confirmPassword')?.value ?? '';
    return confirm.length > 0 && pwd !== confirm;
  }

  submit(): void {
    if (!this.token || this.form.invalid || this.passwordsMismatch) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.error = null;
    this.success = null;

    const newPassword = this.form.get('newPassword')?.value ?? '';
    this.userService.activateAccount(this.token, newPassword).subscribe({
      next: res => {
        this.loading = false;
        this.success = res.message || 'Compte activé. Vous pouvez vous connecter.';
        setTimeout(() => this.router.navigate(['/sign-in']), 2500);
      },
      error: err => {
        this.loading = false;
        this.error = err?.error?.message || 'Activation impossible.';
      }
    });
  }
}
