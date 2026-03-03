import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { NavbarComponent } from './navbar/navbar.component';
import { HomeComponent } from './home/home.component';
import { SignUpComponent } from './sign-up/sign-up.component';
import { EnvironmentCreateComponent } from './environment-create/environment-create.component';
import { SignInComponent } from './sign-in/sign-in.component';
import { ProfileComponent } from './profile/profile.component';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AdminDashboardComponent } from './admin-dashboard/admin-dashboard.component';
import { MyApplicationsComponent } from './my-applications/my-applications.component';
import { PipelineDetailsComponent } from './pipeline-details/pipeline-details.component';
import { PipelinesListComponent } from './pipelines-list/pipelines-list.component';
import { AdminHomeComponent } from './admin-home/admin-home.component';
import { ToastContainerComponent } from './shared/toast-container/toast-container.component';
import { ProjectLayoutComponent } from './project/project-layout.component';
import { ProjectOverviewComponent } from './project/overview/project-overview.component';
import { ProjectDeploymentsComponent } from './project/deployments/project-deployments.component';
import { ProjectLogsComponent } from './project/logs/project-logs.component';
import { ProjectSecurityComponent } from './project/security/project-security.component';
import { DeploySuccessModalComponent } from './shared/deploy-success-modal/deploy-success-modal.component';
import { ApprovalWaitingMessageComponent } from './shared/approval-waiting-message/approval-waiting-message.component';
import { AdminSidebarComponent } from './shared/admin-sidebar/admin-sidebar.component';
import { UserSidebarComponent } from './shared/user-sidebar/user-sidebar.component';
import { ApplicationsActiveComponent } from './applications-active/applications-active.component';
import { SecurityAiFixesComponent } from './security-ai-fixes/security-ai-fixes.component';
import { EnvironmentDetailsComponent } from './shared/environment-details/environment-details.component';
import { TimeAgoPipe } from './pipes/time-ago.pipe';
import { RecentActivityComponent } from './recent-activity/recent-activity.component';

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
    SecurityAiFixesComponent,
    EnvironmentDetailsComponent,
    TimeAgoPipe,
    RecentActivityComponent,
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
