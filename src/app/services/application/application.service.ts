import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApplicationResponse } from '../../models/application/application-response';
import { DeploymentHistoryItem } from '../../models/application/deployment-history-item';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

@Injectable({
  providedIn: 'root'
})
export class ApplicationService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getMyApplications(): Observable<ApplicationResponse[]> {
    return this.http.get<ApplicationResponse[]>(BASE + 'api/applications', { headers: this.authHeaders() });
  }

  getApplicationById(id: string): Observable<ApplicationResponse> {
    return this.http.get<ApplicationResponse>(BASE + `api/applications/${id}`, { headers: this.authHeaders() });
  }

  getDeploymentHistory(appId: string, branch?: string): Observable<DeploymentHistoryItem[]> {
    const url = branch && branch.trim().length > 0
      ? `${BASE}api/applications/${appId}/deployments?branch=${encodeURIComponent(branch)}`
      : `${BASE}api/applications/${appId}/deployments`;
    return this.http.get<DeploymentHistoryItem[]>(url, {
      headers: this.authHeaders()
    });
  }
}

