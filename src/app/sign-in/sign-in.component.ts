import { Component, OnInit } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { AuthService } from '../services/auth/auth.service';
import { UserService } from '../services/user/user.service';
import { User } from '../models/user/user';

@Component({
  selector: 'app-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.css']
})
export class SignInComponent implements OnInit {
  formSignin!: FormGroup;
  errorMessage: string = '';
  isLoading: boolean = false;

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

    // Check if user is already logged in
    this.authService.isLoggedIn$.subscribe(isLoggedIn => {
      if (isLoggedIn) {
        this.router.navigate(['/home']);
      }
    });
  }

  signin(): void {
    if (this.formSignin.valid) {
      this.isLoading = true;
      this.errorMessage = '';

      const username = this.formSignin.get('username')?.value;

      // First check if user exists and is not banned
      this.userService.getUserByUsername(username).pipe(
        catchError((error) => {
          console.error('Error fetching user:', error);
          // Continue with login attempt even if user fetch fails
          return of(null);
        })
      ).subscribe((user: User | null) => {
        if (user && user.isBanned) {
          this.isLoading = false;
          this.errorMessage = `User is banned until ${user.banDate}`;
          this.showAlert(this.errorMessage);
          return;
        }

        // Proceed with login
        this.authService.login(this.formSignin.value).pipe(
          catchError((error) => {
            this.isLoading = false;
            console.error('Login error:', error);
            this.errorMessage = error.error?.message || 'Invalid username or password';
            this.showAlert(this.errorMessage);
            return of(null);
          })
        ).subscribe((response) => {
          if (response) {
            this.isLoading = false;
            this.router.navigate(['/home']);
          }
        });
      });
    } else {
      this.errorMessage = 'Please fill in all required fields.';
      this.showAlert(this.errorMessage);
    }
  }

  showAlert(message: string): void {
    // You can implement a toast/alert component here
    alert(message);
  }
}
