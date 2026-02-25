import { Component, OnInit } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';
import { ApplicationService } from '../../services/application/application.service';
import { ApplicationResponse } from 'src/app/models/application/application-response';

@Component({
  selector: 'app-user-sidebar',
  templateUrl: './user-sidebar.component.html',
  styleUrls: ['./user-sidebar.component.css']
})
export class UserSidebarComponent implements OnInit {
  currentAppId: string | null = null;
  lastEnvId: string | null = null;
  currentApp: ApplicationResponse | null = null;
   project: ApplicationResponse | null = null;

  constructor(
    public authService: AuthService,
    private router: Router,
    private applicationService: ApplicationService
  ) {}

  ngOnInit(): void {
    this.lastEnvId = localStorage.getItem('envirotest-last-pipeline-env');
    this.updateCurrentAppId(this.router.url);
    this.router.events.subscribe(ev => {
      if (ev instanceof NavigationEnd) {
        this.updateCurrentAppId(ev.urlAfterRedirects);
        this.lastEnvId = localStorage.getItem('envirotest-last-pipeline-env');
      }
    });
  }

  private updateCurrentAppId(url: string): void {
    // 1) cas /project/:appId/...
    let newId: string | null = null;
    const projectMatch = url.match(/\/project\/([^\/]+)/);
    if (projectMatch) {
      newId = projectMatch[1];
    } else {
      // 2) cas /pipeline/:envId?appId=...
      const appIdMatch = url.match(/[?&]appId=([^&]+)/);
      if (appIdMatch) {
        newId = decodeURIComponent(appIdMatch[1]);
      }
    }
    if (newId !== this.currentAppId) {
      this.currentAppId = newId;
      this.currentApp = null;
      if (this.currentAppId) {
        this.applicationService.getApplicationById(this.currentAppId).subscribe({
          next: app => { this.currentApp = app; },
          error: () => { this.currentApp = null; }
        });
      }
    }
  }

  navigate(path: string): void {
    this.router.navigate([path]);
  }

  goToProjectOverview(): void {
    if (this.currentAppId) {
      this.router.navigate(['/project', this.currentAppId, 'overview']);
    } else {
      this.navigate('/home');
    }
  }

  goToProjectPipelines(status?: string): void {
    if (!this.currentAppId) {
      this.navigate('/pipelines');
      return;
    }
    const queryParams = status ? { status } : {};
    this.router.navigate(
      ['/project', this.currentAppId, 'deployments'],
      { queryParams }
    );
  }

  goToLastPipeline(): void {
    const envId = this.lastEnvId || localStorage.getItem('envirotest-last-pipeline-env');
    if (envId) {
      this.router.navigate(['/pipeline', envId]);
    }
  }
    logout(): void {
    this.authService.logout();
  }
  openGrafana():void{

  }

  backToApplications(): void {
    this.router.navigate(['/my-applications']);
  }

}

