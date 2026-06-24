import { Component } from '@angular/core';
import { UserService } from '../../services/user/user.service';

/**
 * Coque utilisateur (sidebar + zone principale) sans contexte projet — ex. réclamations.
 */
@Component({
  selector: 'app-user-account-layout',
  templateUrl: './user-account-layout.component.html',
  styleUrls: ['../project-layout/project-layout.component.css']
})
export class UserAccountLayoutComponent {
  constructor(public userService: UserService) {}

  get isLoggedIn(): boolean {
    return !!this.userService.getToken();
  }
}
