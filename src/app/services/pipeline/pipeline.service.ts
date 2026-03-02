import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
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
    return this.http.get<PipelineScanResponse>(BASE + `api/pipelines/by-environment/${envId}`, {
      headers: this.authHeaders()
    });
  }

  getSecuritySummary(envId: string): Observable<SecuritySummaryResponse> {
    return this.http.get<SecuritySummaryResponse>(BASE + `api/environments/${envId}/security-summary`, {
      headers: this.authHeaders()
    });
  }

  getByPipelineId(pipelineId: number): Observable<PipelineScanResponse> {
    return this.http.get<PipelineScanResponse>(BASE + `api/pipelines/${pipelineId}`, {
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

  getScanResults(jobId: number): Observable<any> {
    return this.http.get(BASE + `api/pipelines/jobs/${jobId}/scan`, {
      headers: this.authHeaders()
    });
  }
}

