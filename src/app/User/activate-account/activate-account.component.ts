import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../../services/user/user.service';

@Component({
  selector: 'app-activate-account',
  templateUrl: './activate-account.component.html',
  styleUrls: ['./activate-account.component.css']
})
export class ActivateAccountComponent implements OnInit {
  form = new FormGroup({
    newPassword: new FormControl('', [Validators.required, Validators.minLength(8)]),
    confirmPassword: new FormControl('', [Validators.required])
  });

  token = '';
  loading = false;
  success: string | null = null;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe(params => {
      this.token = params.get('token') ?? '';
      if (!this.token) {
        this.error = 'Lien d\'activation invalide. Vérifiez l\'URL reçue par e-mail.';
      }
    });
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
