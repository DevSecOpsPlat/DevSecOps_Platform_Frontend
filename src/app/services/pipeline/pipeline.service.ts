import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { PipelineScanResponse } from '../../models/pipeline/pipeline-scan-response';
import { SecuritySummaryResponse } from '../../models/pipeline/security-summary-response';
import { PipelineListItem } from '../../models/pipeline/pipeline-list-item';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

@Injectable({
  providedIn: 'root'
})
export class PipelineService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  listPipelines(page: number = 0, size: number = 10): Observable<any> {
  return this.http.get(`${BASE}api/pipelines?page=${page}&size=${size}`, {
    headers: this.authHeaders()
  });
}

  getPipelineAndScan(envId: string): Observable<PipelineScanResponse> {
    // BDD-first côté backend (reports non inclus par défaut)
    return this.http.get<PipelineScanResponse>(BASE + `api/pipelines/by-environment/${envId}?includeReports=false`, {
      headers: this.authHeaders()
    });
  }

  /** Mode “live”: demande au backend de rafraîchir les jobs en arrière-plan. */
  getPipelineAndScanLive(envId: string): Observable<PipelineScanResponse> {
    return this.http.get<PipelineScanResponse>(
      BASE + `api/pipelines/by-environment/${envId}?includeReports=false&refresh=true`,
      { headers: this.authHeaders() }
    );
  }

  getSecuritySummary(envId: string): Observable<SecuritySummaryResponse> {
    return this.http.get<SecuritySummaryResponse>(BASE + `api/environments/${envId}/security-summary`, {
      headers: this.authHeaders()
    });
  }

  getPipelineById(pipelineId: number): Observable<PipelineScanResponse> {
  return this.http.get<PipelineScanResponse>(BASE + `api/pipelines/by-id/${pipelineId}?includeReports=false`, {
    headers: this.authHeaders()
  });
}

getLatestPipeline(): Observable<any> {
  return this.http.get(BASE + 'api/pipelines/latest', {
    headers: this.authHeaders()
  });
}

  cancelPipeline(pipelineId: number): Observable<void> {
    return this.http.post<void>(BASE + `api/pipelines/${pipelineId}/cancel`, null, {
      headers: this.authHeaders()
    });
  }

  getJobLogs(jobId: number): Observable<string> {
    return this.http.get(BASE + `api/pipelines/jobs/${jobId}/logs`, {
      headers: this.authHeaders(),
      responseType: 'text'
    });
  }

  retryJob(jobId: number): Observable<void> {
    return this.http.post<void>(BASE + `api/pipelines/jobs/${jobId}/retry`, null, {
      headers: this.authHeaders()
    });
  }

  getScanResults(jobId: number): Observable<any> {
    return this.http.get(BASE + `api/pipelines/jobs/${jobId}/scan`, {
      headers: this.authHeaders(),
      observe: 'response'
    }).pipe(
      map(res => (res.status === 204 || res.body == null) ? null : res.body)
    );
  }

  // Dans pipeline.service.ts
deletePipeline(pipelineId: number): Observable<void> {
  return this.http.delete<void>(BASE + `api/pipelines/${pipelineId}`, {
    headers: this.authHeaders()
  });
}
}

