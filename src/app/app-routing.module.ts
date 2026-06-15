import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { HomeComponent } from './home/home.component';
import { SignInComponent } from './User/sign-in/sign-in.component';
import { ProfileComponent } from './User/profile/profile.component';
import { AdminUsersComponent } from './admin/admin-users/admin-users.component';
import { AdminUserDetailComponent } from './admin/admin-user-detail/admin-user-detail.component';
import { PipelineDetailsComponent } from './project/pipeline-details/pipeline-details.component';
import { PipelinesListComponent } from './project/pipelines-list/pipelines-list.component';
import { AdminHomeComponent } from './admin/admin-home/admin-home.component';
import { AdminOverviewComponent } from './admin/admin-overview/admin-overview.component';
import { AdminInventoryComponent } from './admin/admin-inventory/admin-inventory.component';
import { AdminObservabilityComponent } from './admin/admin-observability/admin-observability.component';
import { AdminLayoutComponent } from './admin/admin-layout/admin-layout.component';
import { AuthGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { ProjectLayoutComponent } from './project/project-layout/project-layout.component';
import { ProjectOverviewComponent } from './project/overview/project-overview.component';
import { ProjectDeploymentsComponent } from './project/deployments/project-deployments.component';
import { ProjectLogsComponent } from './project/logs/project-logs.component';
import { ProjectSecurityComponent } from './project/security/project-security.component';
import { ApplicationsActiveComponent } from './applications/applications-active/applications-active.component';
import { EnvironmentDetailsComponent } from './project/environments/environment-details/environment-details.component';
import { RecentActivityComponent } from './project/recent-activity/recent-activity.component';
import { VulnerabilitiesDashboardComponent } from './project/vulnerabilities-dashboard/vulnerabilities-dashboard.component';
import { VulnerabilityDetailsComponent } from './project/vulnerability-details/vulnerability-details.component';
import { MonitoringComponent } from './project/monitoring/monitoring.component';

import { SonarqubeComponent } from './project/sonarqube/sonarqube.component';
import { MyApplicationsComponent } from './applications/my-applications/my-applications.component';
import { EnvironmentCreateComponent } from './project/environments/environment-create/environment-create.component';
import { UserAccountLayoutComponent } from './project/user-account-layout/user-account-layout.component';
import { UserReclamationsComponent } from './project/user-reclamations/user-reclamations.component';
import { AdminReclamationsComponent } from './admin/admin-reclamations/admin-reclamations.component';
import { AdminAlertsComponent } from './admin/admin-alerts/admin-alerts.component';
import { AdminAuditComponent } from './admin/admin-audit/admin-audit.component';
import { ActivateAccountComponent } from './User/activate-account/activate-account.component';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomeComponent },
  { path: 'overview', component: HomeComponent },

  // Projet (style Vercel) : sidebar + Overview, Deployments, Logs, Security
  {
    path: 'project/:appId',
    component: ProjectLayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', component: ProjectOverviewComponent },
      { path: 'deployments', component: ProjectDeploymentsComponent },
      { path: 'logs', component: ProjectLogsComponent },
      { path: 'security', component: ProjectSecurityComponent },
      { path: 'pipelines', component: PipelinesListComponent },
      { path: 'activity', component: RecentActivityComponent },
      { path: 'sonarqube', component: SonarqubeComponent },
      { path: 'monitoring', component: MonitoringComponent },
      { path: 'vulnerabilities/:findingId', component: VulnerabilityDetailsComponent },
      { path: 'vulnerabilities', component: VulnerabilitiesDashboardComponent }
    ]
  },

  // Utilisateur connecté
  { path: 'environment-create', component: EnvironmentCreateComponent, canActivate: [AuthGuard] },
  { path: 'environments', component: EnvironmentCreateComponent, canActivate: [AuthGuard] },
  { path: 'environment/:envId', component: EnvironmentDetailsComponent, canActivate: [AuthGuard] },
  {
    path: 'applications',
    canActivate: [AuthGuard],
    children: [
      { path: '', component: MyApplicationsComponent },
      { path: 'active', component: ApplicationsActiveComponent }
    ]
  },
  { path: 'my-applications', component: MyApplicationsComponent, canActivate: [AuthGuard] },
  {
    path: 'reclamations',
    component: UserAccountLayoutComponent,
    canActivate: [AuthGuard],
    children: [{ path: '', component: UserReclamationsComponent }]
  },
  { path: 'pipelines', component: PipelinesListComponent, canActivate: [AuthGuard] },
  { path: 'pipeline/:envId', component: PipelineDetailsComponent, canActivate: [AuthGuard] },

  // Anciennes URLs (sans app dans le chemin) → choisir une application
  { path: 'security/vulnerabilities', redirectTo: 'my-applications', pathMatch: 'full' },
  { path: 'security/fixes', redirectTo: 'my-applications', pathMatch: 'full' },

  // Administration (app isolée : /admin/*, même coque que le layout projet, sans routes métier)
  {
    path: 'admin',
    component: AdminLayoutComponent,
    canActivate: [AdminGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: AdminHomeComponent },
      { path: 'overview', component: AdminOverviewComponent },
      { path: 'users', component: AdminUsersComponent },
      { path: 'users/:id', component: AdminUserDetailComponent },
      { path: 'alerts', component: AdminAlertsComponent },
      { path: 'audit', component: AdminAuditComponent },
      { path: 'inventory', component: AdminInventoryComponent },
      { path: 'observability', component: AdminObservabilityComponent },
      { path: 'reclamations', component: AdminReclamationsComponent }
    ]
  },
  { path: 'admin-home', redirectTo: 'admin/home', pathMatch: 'full' },
  { path: 'admin-dashboard', redirectTo: 'admin/users', pathMatch: 'full' },
  { path: 'admin-users', redirectTo: 'admin/users', pathMatch: 'full' },
  { path: 'admin-overview', redirectTo: 'admin/overview', pathMatch: 'full' },
  { path: 'admin-inventory', redirectTo: 'admin/inventory', pathMatch: 'full' },
  { path: 'admin-observability', redirectTo: 'admin/observability', pathMatch: 'full' },
  { path: 'admin-reclamations', redirectTo: 'admin/reclamations', pathMatch: 'full' },
  { path: 'admin/validations', redirectTo: 'admin/users', pathMatch: 'full' },
  { path: 'sign-up', redirectTo: 'sign-in', pathMatch: 'full' },
  { path: 'approval-waiting', redirectTo: 'sign-in', pathMatch: 'full' },

  // Auth
  { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] },
  { path: 'sign-in', component: SignInComponent },
  { path: 'activate', component: ActivateAccountComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
