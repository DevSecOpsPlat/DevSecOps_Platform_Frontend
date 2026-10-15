import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApplicationService } from '../../services/application/application.service';
import { ApplicationResponse } from '../../models/application/application-response';
import { UserService } from '../../services/user/user.service';

@Component({
  selector: 'app-project-layout',
  templateUrl: './project-layout.component.html',
  styleUrls: ['./project-layout.component.css']
})
export class ProjectLayoutComponent implements OnInit {
  appId: string | null = null;
  project: ApplicationResponse | null = null;
  loading = true;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private applicationService: ApplicationService,
    public userService: UserService
  ) {}

  get isLoggedIn(): boolean {
    return !!this.userService.getToken();
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.appId = params.get('appId');
      if (this.appId) {
        this.loadProject();
      } else {
        this.loading = false;
      }
    });
  }

  loadProject(): void {
    if (!this.appId) return;
    this.loading = true;
    this.error = null;
    this.applicationService.getApplicationById(this.appId).subscribe({
      next: (app: ApplicationResponse) => {
        this.project = app;
        this.loading = false;
        try {
          localStorage.setItem('envirotest-last-project-app-id', this.appId!);
        } catch { /* ignore */ }
      },
      error: (err: any) => {
        this.loading = false;
        this.error = err.error?.message || 'Service introuvable';
      }
    });
  }
}
