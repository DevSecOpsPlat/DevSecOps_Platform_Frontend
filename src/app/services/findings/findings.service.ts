import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

export interface FindingsStatsResponse {
  environmentId?: string;
  pipelineId?: number;
  bySeverity: Record<string, number>;
  byTool: Record<string, number>;
  byScanType: Record<string, number>;
}

export interface ScaFixesStatsResponse {
  environmentId: string;
  openScaCount: number;
  fixedScaCount: number;
  ignoredScaCount: number;
}

export interface FindingsTrendsResponse {
  environmentId: string;
  lastPipelineId: number | null;
  previousPipelineId: number | null;
  newCount: number;
  fixedCount: number;
  newFingerprints: string[];
  fixedFingerprints: string[];
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

/** Réponse GET /api/findings/detail/{id}?envId= */
export interface FindingDetailResponse extends FindingItem {
  evidenceJson?: Record<string, unknown> | null;
  lastArtifactPath?: string | null;
  lastJobName?: string | null;
  lastObservedAt?: string | null;
  /** Extrait optionnel renvoyé par l’API pour l’affichage détail */
  codeSnippet?: string | null;
  /** GITHUB | GITLAB | NONE — origine de l’extrait */
  codeContextSource?: string | null;
}

export interface FindingAiRemediationResponse {
  problemSummary?: string;
  impact?: string;
  location?: string;
  remediationSteps?: string[];
  suggestedPatch?: string;
  fullFileRewrite?: string;
  verificationHints?: string[];
  /** Commandes shell / outil pour valider après correctif */
  verificationCommands?: string[];
  rawModelOutput?: string;
  /** MANUAL | GITHUB | GITLAB | NONE */
  codeContextSource?: string;
}

export interface PageResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

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

  getStatsByEnvironment(envId: string): Observable<FindingsStatsResponse> {
    return this.http.get<FindingsStatsResponse>(`${BASE}api/findings/stats/by-environment/${envId}`, {
      headers: this.authHeaders()
    });
  }

  getTrendsByEnvironment(envId: string): Observable<FindingsTrendsResponse> {
    return this.http.get<FindingsTrendsResponse>(`${BASE}api/findings/trends/by-environment/${envId}`, {
      headers: this.authHeaders()
    });
  }

  getScaFixesStatsByEnvironment(envId: string): Observable<ScaFixesStatsResponse> {
    return this.http.get<ScaFixesStatsResponse>(`${BASE}api/findings/sca-fixes/stats/by-environment/${envId}`, {
      headers: this.authHeaders()
    });
  }

  listScaFixesOpenByEnvironment(envId: string, page: number = 0, size: number = 50): Observable<PageResponse<FindingItem>> {
    const params = new HttpParams().set('page', String(page)).set('size', String(size));
    return this.http.get<PageResponse<FindingItem>>(`${BASE}api/findings/sca-fixes/by-environment/${envId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  updateFindingStatus(findingId: string, envId: string, status: 'OPEN' | 'FIXED' | 'IGNORED' | 'ACCEPTED_RISK'): Observable<{ id: string; status: string }> {
    const params = new HttpParams().set('envId', envId);
    return this.http.patch<{ id: string; status: string }>(`${BASE}api/findings/${findingId}/status`, { status }, {
      headers: this.authHeaders().set('Content-Type', 'application/json'),
      params
    });
  }

  listByEnvironment(
    envId: string,
    page: number = 0,
    size: number = 50,
    filters?: { tool?: string; severity?: string }
  ): Observable<PageResponse<FindingItem>> {
    let params = new HttpParams().set('page', String(page)).set('size', String(size));
    const tool = filters?.tool?.trim();
    const severity = filters?.severity?.trim();
    if (tool) params = params.set('tool', tool);
    if (severity) params = params.set('severity', severity);
    return this.http.get<PageResponse<FindingItem>>(`${BASE}api/findings/by-environment/${envId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  ingestPipeline(pipelineId: number): Observable<any> {
    return this.http.post(`${BASE}api/findings/ingest/pipeline/${pipelineId}`, null, {
      headers: this.authHeaders()
    });
  }

  getDetail(findingId: string, envId: string): Observable<FindingDetailResponse> {
    const params = new HttpParams().set('envId', envId);
    return this.http.get<FindingDetailResponse>(`${BASE}api/findings/detail/${findingId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  postFindingChat(
    findingId: string,
    envId: string,
    body: { messages: { role: string; content: string }[]; remediationSummary?: string }
  ): Observable<{ reply: string }> {
    const params = new HttpParams().set('envId', envId);
    return this.http.post<{ reply: string }>(`${BASE}api/findings/detail/${findingId}/ai-chat`, body, {
      headers: this.authHeaders().set('Content-Type', 'application/json'),
      params
    });
  }

  requestAiRemediation(
    findingId: string,
    envId: string,
    body?: { codeSnippet?: string }
  ): Observable<FindingAiRemediationResponse> {
    const params = new HttpParams().set('envId', envId);
    return this.http.post<FindingAiRemediationResponse>(
      `${BASE}api/findings/detail/${findingId}/ai-remediation`,
      body && (body.codeSnippet?.length ?? 0) > 0 ? body : {},
      {
        headers: this.authHeaders().set('Content-Type', 'application/json'),
        params
      }
    );
  }
}

