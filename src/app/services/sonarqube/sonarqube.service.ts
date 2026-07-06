import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

@Injectable({ providedIn: 'root' })
export class SonarQubeService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    let headers = new HttpHeaders({ 'Content-Type': 'application/json' });
    const token = this.userService.getToken();
    if (token?.trim()) {
      headers = headers.set('Authorization', `Bearer ${token.trim()}`);
    }
    return headers;
  }

  getSonarQubeResults(): Observable<any> {
    return this.http.get(BASE + 'api/sonarqube/results', {
      headers: this.authHeaders()
    });
  }

  getQualityGateStatus(): Observable<any> {
    return this.http.get(BASE + 'api/sonarqube/quality-gate', {
      headers: this.authHeaders()
    });
  }

  getResultsForBranch(branch: string, serviceId?: string): Observable<any> {
    const params: any = { branch };
    if (serviceId) {
      params.serviceId = serviceId;
    }
    return this.http.get(BASE + 'api/sonarqube/results-by-branch', {
      headers: this.authHeaders(),
      params
    });
  }

  getBranches(serviceId?: string): Observable<string[]> {
    const params: any = {};
    if (serviceId) {
      params.serviceId = serviceId;
    }
    return this.http.get<string[]>(BASE + 'api/sonarqube/branches', {
      headers: this.authHeaders(),
      params
    });
  }

  getFileDuplications(componentKey: string): Observable<any> {
    return this.http.get(BASE + 'api/sonarqube/duplications', {
      headers: this.authHeaders(),
      params: { componentKey }
    });
  }

  getHotspotDetails(hotspotKey: string): Observable<any> {
    return this.http.get(BASE + 'api/sonarqube/hotspots/detail', {
      headers: this.authHeaders(),
      params: { hotspotKey }
    });
  }

  /** Change le statut d'une issue (persisté dans SonarCloud). */
  issueTransition(issueKey: string, transition: string): Observable<any> {
    return this.http.post(BASE + 'api/sonarqube/issues/transition', null, {
      headers: this.authHeaders(),
      params: { issueKey, transition }
    });
  }

  /** Assigne une issue au compte SonarCloud par défaut (\"Assign to me\"). */
  issueAssignToMe(issueKey: string): Observable<any> {
    return this.http.post(BASE + 'api/sonarqube/issues/assign/me', null, {
      headers: this.authHeaders(),
      params: { issueKey }
    });
  }

  /** Désassigne complètement une issue (Not assigned). */
  issueUnassign(issueKey: string): Observable<any> {
    return this.http.post(BASE + 'api/sonarqube/issues/assign/unassign', null, {
      headers: this.authHeaders(),
      params: { issueKey }
    });
  }

  getIssueDetails(issueKey: string, branch?: string): Observable<any> {
    const params: any = { issueKey };
    if (branch) params.branch = branch;
    return this.http.get(BASE + 'api/sonarqube/issues/detail', {
      headers: this.authHeaders(),
      params
    });
  }

  getActivityHistory(branch: string, serviceId?: string): Observable<any> {
    const params: any = { branch };
    if (serviceId) params.serviceId = serviceId;
    return this.http.get(BASE + 'api/sonarqube/activity', {
      headers: this.authHeaders(),
      params
    });
  }
}

