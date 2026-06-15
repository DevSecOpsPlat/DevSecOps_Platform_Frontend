import { Component, OnDestroy, OnInit } from '@angular/core';
import { AdminService } from '../../services/admin/admin.service';
import { Subscription, interval } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-admin-sidebar',
  templateUrl: './admin-sidebar.component.html',
  styleUrls: ['./admin-sidebar.component.css']
})
export class AdminSidebarComponent implements OnInit, OnDestroy {
  unreadAlerts = 0;
  private sub?: Subscription;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.sub = interval(60000)
      .pipe(
        startWith(0),
        switchMap(() => this.adminService.getUnreadAlertCount())
      )
      .subscribe({
        next: res => (this.unreadAlerts = res?.count ?? 0),
        error: () => {}
      });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
