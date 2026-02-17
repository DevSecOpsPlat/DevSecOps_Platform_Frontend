import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PipelineScanResponse } from '../../models/pipeline/pipeline-scan-response';
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

  getPipelineAndScan(envId: string): Observable<PipelineScanResponse> {
    return this.http.get<PipelineScanResponse>(BASE + `api/environments/${envId}/pipeline`, {
      headers: this.authHeaders()
    });
  }

  getJobLogs(jobId: number): Observable<string> {
    return this.http.get(BASE + `api/pipeline/jobs/${jobId}/logs`, {
      responseType: 'text'
    });
  }

  getScanResults(jobId: number): Observable<any> {
    return this.http.get(BASE + `api/scan-results/${jobId}`, {
      headers: this.authHeaders()
    });
  }
}

