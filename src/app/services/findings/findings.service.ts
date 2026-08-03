import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

export interface FindingsStatsResponse {
  environmentId?: string;
  pipelineId?: number;
  applicationId?: string;
  statusFilter?: string;
  openDistinctTotal?: number;
  bySeverity: Record<string, number>;
  byTool: Record<string, number>;
  byScanType: Record<string, number>;
}

export interface FindingItem {
  id: string;
  fingerprint: string;
  scanType: string;
  toolName: string;
  severity: string;
  status: string;
  ruleId?: string;
  title?: string;
  description?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  cve?: string;
  cwe?: string;
  packageName?: string;
  installedVersion?: string;
  fixedVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

/** @deprecated Import from models/finding/finding-ai-remediation.model instead */
export type { FindingAiRemediationResponse } from '../../models/finding/finding-ai-remediation.model';

@Injectable({
  providedIn: 'root'
})
export class FindingsService {
  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getStatsByApplication(
    appId: string,
    status?: 'OPEN' | 'FIXED' | 'IGNORED' | 'ACCEPTED_RISK' | 'ALL'
  ): Observable<FindingsStatsResponse> {
    let params = new HttpParams();
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<FindingsStatsResponse>(`${BASE}api/findings/stats/by-application/${appId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  listByApplication(
    appId: string,
    page: number = 0,
    size: number = 50,
    filters?: { branch?: string; tool?: string; severity?: string; scanType?: string; status?: string }
  ): Observable<PageResponse<FindingItem>> {
    let params = new HttpParams().set('page', String(page)).set('size', String(size));
    const branch = filters?.branch?.trim();
    const tool = filters?.tool?.trim();
    const severity = filters?.severity?.trim();
    const scanType = filters?.scanType?.trim();
    const status = filters?.status?.trim();
    if (branch) params = params.set('branch', branch);
    if (tool) params = params.set('tool', tool);
    if (severity) params = params.set('severity', severity);
    if (scanType) params = params.set('scanType', scanType);
    if (status) params = params.set('status', status);
    return this.http.get<PageResponse<FindingItem>>(`${BASE}api/findings/by-application/${appId}`, {
      headers: this.authHeaders(),
      params
    });
  }
}
