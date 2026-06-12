import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

export interface AdminCreateUserPayload {
  username: string;
  email: string;
  password: string;
  role?: 'ROLE_TESTER';
}

export interface AdminCreateUserResponse {
  id: string;
  username: string;
  email: string;
  roles: string[];
  accountStatus: string;
}

export interface AdminPipelineCounts {
  success: number;
  failed: number;
  running: number;
  pending: number;
  canceled: number;
  skipped: number;
  total?: number;
}

export interface AdminEnvironmentStatusBreakdown {
  pending: number;
  building: number;
  running: number;
  failed: number;
  destroyed: number;
  expired: number;
  total?: number;
}

export interface AdminUserApplicationDetail {
  id: string;
  name: string;
  description?: string | null;
  gitRepositoryUrl: string;
  createdAt: string | number[];
  linkedEnvironmentsCount: number;
  pipelineCounts: AdminPipelineCounts;
}

export interface AdminUserEnvironmentDetail {
  id: string;
  applicationId: string;
  applicationName: string;
  environmentName: string;
  gitBranch: string;
  status: string;
  url?: string | null;
  ttlHours: number;
  createdAt: string | number[];
  expiresAt: string | number[];
  gitlabPipelineId?: number | null;
  pipelineStatus?: string | null;
  pipelineStartedAt?: string | number[] | null;
  pipelineFinishedAt?: string | number[] | null;
}

export interface AdminUserMetrics {
  id: string;
  username: string;
  email: string;
  roles: string[];
  accountStatus: string;
  createdAt: string | number[];
  updatedAt?: string | number[] | null;
  validatedAt?: string | number[] | null;
  validatedByUsername?: string | null;
  rejectionReason?: string | null;
  activeEnvironmentsCount: number;
  pipelinesCount: number;
  applicationsCount: number;
  pipelineCounts: AdminPipelineCounts;
  environmentStatusBreakdown: AdminEnvironmentStatusBreakdown;
  applications: AdminUserApplicationDetail[];
  environments: AdminUserEnvironmentDetail[];
}

const BASE = environment.BASE_URL + 'api/admin/';

@Injectable({
  providedIn: 'root'
})
export class AdminService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  createUser(payload: AdminCreateUserPayload): Observable<AdminCreateUserResponse> {
    return this.http.post<AdminCreateUserResponse>(BASE + 'users', payload, { headers: this.authHeaders() });
  }

  getAllUsersWithMetrics(): Observable<AdminUserMetrics[]> {
    return this.http.get<AdminUserMetrics[]>(BASE + 'users', { headers: this.authHeaders() });
  }
}
