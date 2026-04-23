import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app/app.component';
import { NavbarComponent } from './navbar/navbar.component';
import { HomeComponent } from './home/home.component';
import { SignInComponent } from './User/sign-in/sign-in.component';
import { ProfileComponent } from './User/profile/profile.component';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AdminDashboardComponent } from './admin/admin-dashboard/admin-dashboard.component';
import { AdminUsersComponent } from './admin/admin-users/admin-users.component';
import { PipelineDetailsComponent } from './project/pipeline-details/pipeline-details.component';
import { PipelinesListComponent } from './project/pipelines-list/pipelines-list.component';
import { AdminHomeComponent } from './admin/admin-home/admin-home.component';
import { ProjectLayoutComponent } from './project/project-layout/project-layout.component';
import { ProjectOverviewComponent } from './project/overview/project-overview.component';
import { ProjectDeploymentsComponent } from './project/deployments/project-deployments.component';
import { ProjectLogsComponent } from './project/logs/project-logs.component';
import { ProjectSecurityComponent } from './project/security/project-security.component';
import { DeploySuccessModalComponent } from './project/deploy-success-modal/deploy-success-modal.component';
import { ApprovalWaitingMessageComponent } from './User/approval-waiting-message/approval-waiting-message.component';
import { AdminSidebarComponent } from './admin/admin-sidebar/admin-sidebar.component';
import { UserSidebarComponent } from './project/user-sidebar/user-sidebar.component';
import { ApplicationsActiveComponent } from './applications/applications-active/applications-active.component';
import { EnvironmentDetailsComponent } from './project/environments/environment-details/environment-details.component';
import { TimeAgoPipe } from './pipes/time-ago.pipe';
import { RecentActivityComponent } from './project/recent-activity/recent-activity.component';
import { SignUpComponent } from './User/sign-up/sign-up.component';
import { SonarqubeComponent } from './project/sonarqube/sonarqube.component';
import { MyApplicationsComponent } from './applications/my-applications/my-applications.component';
import { EnvironmentCreateComponent } from './project/environments/environment-create/environment-create.component';
import { ToastContainerComponent } from './toast-container/toast-container.component';
import { VulnerabilitiesDashboardComponent } from './project/vulnerabilities-dashboard/vulnerabilities-dashboard.component';
import { VulnerabilityDetailsComponent } from './project/vulnerability-details/vulnerability-details.component';

@NgModule({
  declarations: [
    AppComponent,
    NavbarComponent,
    HomeComponent,
    SignInComponent,
    SignUpComponent,
    EnvironmentCreateComponent,
    ProfileComponent,
    AdminDashboardComponent,
    AdminUsersComponent,
    MyApplicationsComponent,
    PipelineDetailsComponent,
    PipelinesListComponent,
    AdminHomeComponent,
    AdminSidebarComponent,
    ApprovalWaitingMessageComponent,
    ToastContainerComponent,
    ProjectLayoutComponent,
    ProjectOverviewComponent,
    ProjectDeploymentsComponent,
    ProjectLogsComponent,
    ProjectSecurityComponent,
    DeploySuccessModalComponent,
    UserSidebarComponent,
    ApplicationsActiveComponent,
    EnvironmentDetailsComponent,
    TimeAgoPipe,
    RecentActivityComponent,
    SonarqubeComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule,
    VulnerabilitiesDashboardComponent,
    VulnerabilityDetailsComponent
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
