import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule, HTTP_INTERCEPTORS } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app/app.component';
import { NavbarComponent } from './navbar/navbar.component';
import { HomeComponent } from './home/home.component';
import { SignInComponent } from './User/sign-in/sign-in.component';
import { ProfileComponent } from './User/profile/profile.component';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AdminUsersComponent } from './admin/admin-users/admin-users.component';
import { AdminCreateUserComponent } from './admin/admin-create-user/admin-create-user.component';
import { AdminUserDetailComponent } from './admin/admin-user-detail/admin-user-detail.component';
import { PipelineDetailsComponent } from './project/pipeline-details/pipeline-details.component';
import { PipelinesListComponent } from './project/pipelines-list/pipelines-list.component';
import { AdminHomeComponent } from './admin/admin-home/admin-home.component';
import { AdminOverviewComponent } from './admin/admin-overview/admin-overview.component';
import { AdminInventoryComponent } from './admin/admin-inventory/admin-inventory.component';
import { AdminObservabilityComponent } from './admin/admin-observability/admin-observability.component';
import { AdminLayoutComponent } from './admin/admin-layout/admin-layout.component';
import { ProjectLayoutComponent } from './project/project-layout/project-layout.component';
import { ProjectOverviewComponent } from './project/overview/project-overview.component';
import { ProjectDeploymentsComponent } from './project/deployments/project-deployments.component';
import { ProjectLogsComponent } from './project/logs/project-logs.component';
import { ProjectSecurityComponent } from './project/security/project-security.component';
import { DeploySuccessModalComponent } from './project/deploy-success-modal/deploy-success-modal.component';
import { AdminSidebarComponent } from './admin/admin-sidebar/admin-sidebar.component';
import { UserSidebarComponent } from './project/user-sidebar/user-sidebar.component';
import { EnvironmentDetailsComponent } from './project/environments/environment-details/environment-details.component';
import { TimeAgoPipe } from './pipes/time-ago.pipe';
import { RecentActivityComponent } from './project/recent-activity/recent-activity.component';
import { SonarqubeComponent } from './project/sonarqube/sonarqube.component';
import { ToastContainerComponent } from './toast-container/toast-container.component';
import { SecurityDashboardComponent } from './project/security-dashboard/security-dashboard.component';
import { DefectDojoFindingDetailsComponent } from './project/defectdojo-finding-details/defectdojo-finding-details.component';
import { MonitoringComponent } from './project/monitoring/monitoring.component';
import { UserAccountLayoutComponent } from './project/user-account-layout/user-account-layout.component';
import { UserReclamationsComponent } from './project/user-reclamations/user-reclamations.component';
import { AdminReclamationsComponent } from './admin/admin-reclamations/admin-reclamations.component';
import { AdminAlertsComponent } from './admin/admin-alerts/admin-alerts.component';
import { AdminAuditComponent } from './admin/admin-audit/admin-audit.component';
import { ActivateAccountComponent } from './User/activate-account/activate-account.component';
import { PasswordRequirementsComponent } from './shared/password/password-requirements.component';
import { AuthInterceptor } from './interceptors/auth.interceptor';

@NgModule({
  declarations: [
    AppComponent,
    NavbarComponent,
    HomeComponent,
    SignInComponent,
    ProfileComponent,
    AdminUsersComponent,
    AdminCreateUserComponent,
    AdminUserDetailComponent,
    PipelineDetailsComponent,
    PipelinesListComponent,
    AdminLayoutComponent,
    AdminHomeComponent,
    AdminOverviewComponent,
    AdminInventoryComponent,
    AdminObservabilityComponent,
    AdminSidebarComponent,
    ToastContainerComponent,
    ProjectLayoutComponent,
    ProjectDeploymentsComponent,
    ProjectLogsComponent,
    ProjectSecurityComponent,
    DeploySuccessModalComponent,
    UserSidebarComponent,
    EnvironmentDetailsComponent,
    TimeAgoPipe,
    RecentActivityComponent,
    SonarqubeComponent,
    MonitoringComponent,
    UserAccountLayoutComponent,
    UserReclamationsComponent,
    AdminReclamationsComponent,
    AdminAlertsComponent,
    AdminAuditComponent,
    ActivateAccountComponent,
    PasswordRequirementsComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule,
    SecurityDashboardComponent,
    ProjectOverviewComponent,
    DefectDojoFindingDetailsComponent
  ],
  providers: [
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
  ],
  bootstrap: [AppComponent]
})
export class AppModule { }
