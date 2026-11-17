import { Component } from '@angular/core';
import { UserService } from '../../services/user/user.service';

/**
 * Coque admin : barre latérale + zone principale. La racine `.adm` porte les variables du thème
 * de la console (src/app/admin/admin-theme.css), héritées par toutes les pages admin.
 */
@Component({
  selector: 'app-admin-layout',
  templateUrl: './admin-layout.component.html'
})
export class AdminLayoutComponent {
  constructor(public userService: UserService) {}

  get isLoggedIn(): boolean {
    return !!this.userService.getToken();
  }
}
