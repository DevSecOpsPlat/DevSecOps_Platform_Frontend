import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit {
  constructor(
    public authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Rediriger les admins vers leur page d'accueil dédiée
    this.authService.isLoggedIn$.subscribe(isLoggedIn => {
      if (isLoggedIn && this.authService.hasRole('ROLE_ADMIN')) {
        this.router.navigate(['/admin-home']);
      }
    });
  }
}
