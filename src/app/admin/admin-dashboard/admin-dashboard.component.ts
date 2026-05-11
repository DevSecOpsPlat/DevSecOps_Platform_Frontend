import { Component, OnInit } from '@angular/core';
import { AdminService, PendingUser } from '../../services/admin/admin.service';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['../admin-route-page.css', './admin-dashboard.component.css']
})
export class AdminDashboardComponent implements OnInit {
  pendingUsers: PendingUser[] = [];
  loading = false;
  error: string | null = null;

  /** Utilisateur pour lequel le panneau de rejet est ouvert. */
  rejectModalUser: PendingUser | null = null;
  rejectReason = '';

  /** Désactive les actions pendant l’appel API (par id utilisateur). */
  actionBusyId: string | null = null;

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
        this.error = err.error?.message || err.message || 'Erreur lors du chargement des utilisateurs en attente.';
      }
    });
  }

  approve(user: PendingUser): void {
    if (this.actionBusyId) {
      return;
    }
    this.error = null;
    this.actionBusyId = user.id;
    this.adminService.approveUser(String(user.id)).subscribe({
      next: () => {
        this.pendingUsers = this.pendingUsers.filter(u => u.id !== user.id);
        this.actionBusyId = null;
      },
      error: err => {
        this.actionBusyId = null;
        this.error = err.error?.message || err.message || 'Approbation impossible.';
      }
    });
  }

  openReject(user: PendingUser): void {
    this.error = null;
    this.rejectModalUser = user;
    this.rejectReason = '';
  }

  cancelReject(): void {
    this.rejectModalUser = null;
    this.rejectReason = '';
  }

  confirmReject(): void {
    const user = this.rejectModalUser;
    if (!user || this.actionBusyId) {
      return;
    }
    this.error = null;
    this.actionBusyId = user.id;
    const reason = this.rejectReason.trim() || undefined;
    this.adminService.rejectUser(String(user.id), reason).subscribe({
      next: () => {
        this.pendingUsers = this.pendingUsers.filter(u => u.id !== user.id);
        this.cancelReject();
        this.actionBusyId = null;
      },
      error: err => {
        this.actionBusyId = null;
        this.error = err.error?.message || err.message || 'Rejet impossible.';
      }
    });
  }

  isBusy(userId: string): boolean {
    return this.actionBusyId === userId;
  }

  userInitials(username: string): string {
    const u = (username || '?').trim();
    if (!u) {
      return '?';
    }
    return u.slice(0, 2).toUpperCase();
  }
}
