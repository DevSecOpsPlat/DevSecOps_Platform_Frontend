import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { HomeComponent } from './home/home.component';
import { EnvironmentCreateComponent } from './environment-create/environment-create.component';
import { SignInComponent } from './sign-in/sign-in.component';
import { SignUpComponent } from './sign-up/sign-up.component';
import { ProfileComponent } from './profile/profile.component';
import { AdminDashboardComponent } from './admin-dashboard/admin-dashboard.component';
import { MyApplicationsComponent } from './my-applications/my-applications.component';
import { PipelineDetailsComponent } from './pipeline-details/pipeline-details.component';
import { PipelinesListComponent } from './pipelines-list/pipelines-list.component';
import { AdminHomeComponent } from './admin-home/admin-home.component';
import { ApprovalWaitingMessageComponent } from './shared/approval-waiting-message/approval-waiting-message.component';
import { AuthGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { ProjectLayoutComponent } from './project/project-layout.component';
import { ProjectOverviewComponent } from './project/overview/project-overview.component';
import { ProjectDeploymentsComponent } from './project/deployments/project-deployments.component';
import { ProjectLogsComponent } from './project/logs/project-logs.component';
import { ProjectSecurityComponent } from './project/security/project-security.component';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', component: HomeComponent },
  { path: 'admin-home', component: AdminHomeComponent, canActivate: [AdminGuard] },
  { path: 'approval-waiting', component: ApprovalWaitingMessageComponent },

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
      { path: 'security', component: ProjectSecurityComponent }
    ]
  },

  // Utilisateur connecté
  { path: 'environment-create', component: EnvironmentCreateComponent, canActivate: [AuthGuard] },
  { path: 'environments', component: EnvironmentCreateComponent, canActivate: [AuthGuard] },
  { path: 'my-applications', component: MyApplicationsComponent, canActivate: [AuthGuard] },
  { path: 'pipelines', component: PipelinesListComponent, canActivate: [AuthGuard] },
  { path: 'pipeline/:envId', component: PipelineDetailsComponent, canActivate: [AuthGuard] },

  // Administration
  { path: 'admin-dashboard', component: AdminDashboardComponent, canActivate: [AdminGuard] },

  // Auth
  { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] },
  { path: 'sign-in', component: SignInComponent },
  { path: 'sign-up', component: SignUpComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
