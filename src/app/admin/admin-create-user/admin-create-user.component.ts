import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { AdminCreateUserPayload, AdminService } from '../../services/admin/admin.service';

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
    username: new FormControl('', [Validators.required, Validators.minLength(2)]),
    email: new FormControl('', [Validators.required, Validators.email]),
    password: new FormControl('', [Validators.required, Validators.minLength(6)]),
    confirmPassword: new FormControl('', [Validators.required])
  });

  saving = false;
  error: string | null = null;

  constructor(private adminService: AdminService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']?.currentValue === true) {
      this.resetForm();
    }
  }

  get passwordsMismatch(): boolean {
    const pwd = this.form.get('password')?.value ?? '';
    const confirm = this.form.get('confirmPassword')?.value ?? '';
    return confirm.length > 0 && pwd !== confirm;
  }

  cancel(): void {
    this.closed.emit();
  }

  submit(): void {
    if (this.form.invalid || this.passwordsMismatch) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving = true;
    this.error = null;

    const payload: AdminCreateUserPayload = {
      username: (this.form.get('username')?.value ?? '').trim(),
      email: (this.form.get('email')?.value ?? '').trim(),
      password: this.form.get('password')?.value ?? '',
      role: 'ROLE_TESTER'
    };

    this.adminService.createUser(payload).subscribe({
      next: () => {
        this.saving = false;
        this.userCreated.emit();
        this.closed.emit();
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
    this.saving = false;
  }
}
