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
import { ReactiveFormsModule } from '@angular/forms';
import { AdminDashboardComponent } from './admin-dashboard/admin-dashboard.component';
import { MyApplicationsComponent } from './my-applications/my-applications.component';
import { PipelineDetailsComponent } from './pipeline-details/pipeline-details.component';
import { PipelinesListComponent } from './pipelines-list/pipelines-list.component';
import { AdminHomeComponent } from './admin-home/admin-home.component';
import { AdminSidebarComponent } from './shared/admin-sidebar/admin-sidebar.component';
import { ApprovalWaitingMessageComponent } from './shared/approval-waiting-message/approval-waiting-message.component';

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
    ApprovalWaitingMessageComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
