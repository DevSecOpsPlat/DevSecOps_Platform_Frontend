import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../services/auth/auth.service';
import { UserService } from '../services/user/user.service';
import { RegisterPayload } from '../models/user/register-payload';

@Component({
  selector: 'app-sign-up',
  templateUrl: './sign-up.component.html',
  styleUrls: ['./sign-up.component.css']
})
export class SignUpComponent implements OnInit {
  formSignup!: FormGroup;
  errorMessage: string = '';
  isLoading: boolean = false;

  constructor(
    private userService: UserService,
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.formSignup = new FormGroup({
      username: new FormControl('', [Validators.required, Validators.minLength(2)]),
      email: new FormControl('', [Validators.required, Validators.email]),
      password: new FormControl('', [Validators.required, Validators.minLength(6)])
    });

    this.authService.isLoggedIn$.subscribe(isLoggedIn => {
      if (isLoggedIn) {
        this.router.navigate(['/home']);
      }
    });
  }

  signup(): void {
    if (this.formSignup.valid) {
      this.isLoading = true;
      this.errorMessage = '';

      const payload: RegisterPayload = {
        username: this.formSignup.get('username')?.value?.trim() ?? '',
        email: this.formSignup.get('email')?.value?.trim() ?? '',
        password: this.formSignup.get('password')?.value ?? ''
      };

      this.userService.register(payload).pipe(
        catchError((error) => {
          this.isLoading = false;
          console.error('Register error:', error);
          const body = error.error;
          const msg = typeof body === 'string'
            ? body.replace(/^Error:\s*/, '')
            : (body?.message || body?.error || error.message || 'An error occurred while creating your account');
          this.errorMessage = msg;
          return of(null);
        })
      ).subscribe((response) => {
        this.isLoading = false;
        if (response !== null) {
          alert('Compte créé avec succès. Merci de patienter pendant la validation par un administrateur.');
          this.router.navigate(['/sign-in']);
        }
      });
    } else {
      this.errorMessage = 'Please fill in all required fields correctly.';
    }
  }
}
