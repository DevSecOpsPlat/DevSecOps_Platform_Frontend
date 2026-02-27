import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
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
    
    return this.http.get<any[]>(url, { headers: this.authHeaders() }).pipe(
      map(items => items.map(item => this.convertDeploymentItem(item)))
    );
  }
 

  private convertDeploymentItem(item: any): DeploymentHistoryItem {
    return {
      environmentId: item.environmentId,
      environmentName: item.environmentName,
      gitBranch: item.gitBranch,
      pipelineId: item.pipelineId,
      pipelineStatus: item.pipelineStatus,
      environmentStatus: item.environmentStatus,
      ttlHours: item.ttlHours,
      shortSha: item.shortSha,
      commitMessage: item.commitMessage,
      createdAt: this.convertDateArray(item.createdAt),
      expiresAt: this.convertDateArray(item.expiresAt),
      finishedAt: item.finishedAt ? this.convertDateArray(item.finishedAt) : null,
      triggeredByUsername: item.triggeredByUsername
    };
  }

  private convertDateArray(dateArray: any[] | null | string): string {
    if (!dateArray) return new Date().toISOString();
    
    // Si c'est déjà une string, la retourner
    if (typeof dateArray === 'string') return dateArray;
    
    // Si c'est un tableau [année, mois, jour, heure, minute, seconde]
    if (Array.isArray(dateArray) && dateArray.length >= 6) {
      const [year, month, day, hour, minute, second] = dateArray;
      // Attention: mois est 0-indexé en JS, donc month - 1
      const date = new Date(year, month - 1, day, hour, minute, second);
      return date.toISOString();
    }
    
    return new Date().toISOString();
  }


}

