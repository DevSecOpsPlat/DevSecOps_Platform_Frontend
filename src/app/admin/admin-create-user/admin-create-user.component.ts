import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AdminCreateUserPayload, AdminService } from '../../services/admin/admin.service';
import { usernameValidator } from '../../shared/username/username.validator';

@Component({
  selector: 'app-admin-create-user',
  templateUrl: './admin-create-user.component.html',
  styleUrls: ['./admin-create-user.component.css']
})
export class AdminCreateUserComponent implements OnChanges {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();
  @Output() userCreated = new EventEmitter<void>();

  form = new FormGroup({
    username: new FormControl('', [Validators.required, usernameValidator()]),
    email: new FormControl('', [Validators.required, Validators.email])
  });

  saving = false;
  error: string | null = null;
  successMessage: string | null = null;
  activationLink: string | null = null;
  emailSent = false;

  constructor(private adminService: AdminService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue === true) {
      this.resetForm();
    }
  }

  cancel(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving = true;
    this.error = null;
    this.successMessage = null;

    const payload: AdminCreateUserPayload = {
      username: (this.form.get('username')?.value ?? '').trim(),
      email: (this.form.get('email')?.value ?? '').trim(),
      role: 'ROLE_TESTER'
    };

    this.adminService.createUser(payload).subscribe({
      next: res => {
        this.saving = false;
        this.emailSent = !!res.activationEmailSent;
        this.activationLink = res.activationLink ?? null;
        this.successMessage = res.message
          || (this.emailSent
            ? `Compte créé. E-mail d'activation envoyé à ${res.email}.`
            : `Compte créé pour ${res.email}. E-mail non envoyé — transmettez le lien ci-dessous.`);
        this.userCreated.emit();
        if (this.emailSent) {
          setTimeout(() => this.closed.emit(), 4000);
        }
      },
      error: err => {
        this.saving = false;
        this.error = err?.error?.message || err?.message || 'Impossible de créer le compte.';
      }
    });
  }

  private resetForm(): void {
    this.form.reset();
    this.error = null;
    this.successMessage = null;
    this.activationLink = null;
    this.emailSent = false;
    this.saving = false;
  }

  copyLink(): void {
    if (!this.activationLink) return;
    navigator.clipboard?.writeText(this.activationLink).catch(() => {});
  }
}
