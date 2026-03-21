

import { Component, OnInit } from '@angular/core';
import { AdminService, PendingUser } from '../../services/admin/admin.service';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.css']
})
export class AdminDashboardComponent implements OnInit {

  pendingUsers: PendingUser[] = [];
  loading = false;
  error: string | null = null;

  constructor(private adminService: AdminService) {}

  ngOnInit(): void {
    this.loadPendingUsers();
  }

  loadPendingUsers(): void {
    this.loading = true;
    this.error = null;
    this.adminService.getPendingUsers().subscribe({
      next: users => {
        this.pendingUsers = users;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || 'Erreur lors du chargement des utilisateurs en attente';
      }
    });
  }

  approve(user: PendingUser): void {
    this.adminService.approveUser(String(user.id)).subscribe({
      next: () => {
        this.pendingUsers = this.pendingUsers.filter(u => u.id !== user.id);
      }
    });
  }

  reject(user: PendingUser): void {
    const reason = prompt(`Raison du rejet pour ${user.username} :`) || undefined;
    this.adminService.rejectUser(String(user.id), reason).subscribe({
      next: () => {
        this.pendingUsers = this.pendingUsers.filter(u => u.id !== user.id);
      }
    });
  }
}

