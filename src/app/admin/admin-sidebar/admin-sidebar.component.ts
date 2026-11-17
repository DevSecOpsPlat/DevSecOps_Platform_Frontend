import { Component, OnDestroy, OnInit } from '@angular/core';
import { AdminService } from '../../services/admin/admin.service';
import { Subscription, interval } from 'rxjs';
import { startWith, switchMap } from 'rxjs/operators';

interface NavItem {
  label: string;
  link: string;
  exact?: boolean;
  badge?: 'alerts';
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

@Component({
  selector: 'app-admin-sidebar',
  templateUrl: './admin-sidebar.component.html'
})
export class AdminSidebarComponent implements OnInit, OnDestroy {
  readonly groups: NavGroup[] = [
    { label: 'Pilotage', items: [{ label: 'Vue d’ensemble', link: '/admin/overview', exact: true }] },
    {
      label: 'Sécurité',
      items: [
        { label: 'Centre de sécurité', link: '/admin/alerts', badge: 'alerts' },
        { label: 'Journal d’audit', link: '/admin/audit' }
      ]
    },
    { label: 'Accès', items: [{ label: 'Utilisateurs', link: '/admin/users' }] },
    {
      label: 'Ressources',
      items: [
        { label: 'Applications', link: '/admin/applications' },
        { label: 'Environnements', link: '/admin/environments' }
      ]
    },
    {
      label: 'Infrastructure',
      items: [
        { label: 'Monitoring', link: '/admin/monitoring' },
        { label: 'Observabilité', link: '/admin/observability' }
      ]
    },
    { label: 'Support', items: [{ label: 'Réclamations', link: '/admin/reclamations' }] }
  ];

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
