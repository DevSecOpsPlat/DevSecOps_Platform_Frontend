import { Component } from '@angular/core';
import { UserService } from '../../services/user/user.service';

/**
 * Coque admin : même structure visuelle que le layout projet (sidebar + zone principale),
 * sans réutiliser les routes / écrans métier (projet, pipeline détail, etc.).
 */
@Component({
  selector: 'app-admin-layout',
  templateUrl: './admin-layout.component.html',
  styleUrls: ['./admin-layout.component.css']
})
export class AdminLayoutComponent {
  constructor(public userService: UserService) {}

  get isLoggedIn(): boolean {
    return !!this.userService.getToken();
  }
}
