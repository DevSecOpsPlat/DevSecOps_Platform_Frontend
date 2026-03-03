import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';
import { DeployRequest } from '../../models/environment/deploy-request';
import { DeployResponse } from '../../models/environment/deploy-response';
import { EnvironmentSummaryResponse } from '../../models/environment/environment-summary-response';
import { map } from 'rxjs/operators';

const BASE = environment.BASE_URL;

@Injectable({
  providedIn: 'root'
})
export class EnvironmentService {

   constructor(
    private http: HttpClient,
    private userService: UserService
  ) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getEnvironmentById(envId: string): Observable<EnvironmentSummaryResponse> {
  return this.http.get<EnvironmentSummaryResponse>(BASE + `api/environments/by-id/${envId}`, {
    headers: this.authHeaders()
  });
}

getLatestEnvironment(): Observable<any> {
  return this.http.get(BASE + 'api/environments/latest', {
    headers: this.authHeaders()
  });
}

  private convertEnvironment(data: any): EnvironmentSummaryResponse {
    return {
      id: data.id,
      environmentName: data.environmentName,
      gitRepositoryUrl: data.gitRepositoryUrl,
      gitBranch: data.gitBranch,
      ttlHours: data.ttlHours,
      status: data.status,
      previewUrl: data.previewUrl,
      createdAt: this.convertDateArray(data.createdAt),
      expiresAt: this.convertDateArray(data.expiresAt),
      latestPipelineId: data.latestPipelineId,
      latestPipelineStatus: data.latestPipelineStatus
    };
  }

  private convertDateArray(dateArray: any[] | null): string {
    if (!dateArray || !Array.isArray(dateArray) || dateArray.length < 6) {
      return new Date().toISOString();
    }
    
    // Tableau: [année, mois, jour, heure, minute, seconde, nanoseconde]
    const [year, month, day, hour, minute, second] = dateArray;
    
    // Créer une date (mois est 0-indexé en JS, donc on soustrait 1)
    const date = new Date(year, month - 1, day, hour, minute, second);
    
    return date.toISOString();
  }


  deploy(request: DeployRequest): Observable<DeployResponse> {
    return this.http.post<DeployResponse>(BASE + 'api/deploy', request, {
      headers: this.authHeaders()
    });
  }
   getMyEnvironments(): Observable<EnvironmentSummaryResponse[]> {
    return this.http.get<EnvironmentSummaryResponse[]>(`${BASE}api/environments`, {
      headers: this.authHeaders()
    });
  }

  getEnvironment(envId: string): Observable<EnvironmentSummaryResponse> {
    return this.http.get<EnvironmentSummaryResponse>(BASE + `api/environments/${envId}`, {
      headers: this.authHeaders()
    });
  }

}
