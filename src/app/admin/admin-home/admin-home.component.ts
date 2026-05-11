import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth/auth.service';

@Component({
  selector: 'app-admin-home',
  templateUrl: './admin-home.component.html',
  styleUrls: ['../admin-route-page.css', './admin-home.component.css']
})
export class AdminHomeComponent implements OnInit {
  
  constructor(public authService: AuthService) {}

  ngOnInit(): void {
  }

  get user() {
    return this.authService.getCurrentUser();
  }
}
