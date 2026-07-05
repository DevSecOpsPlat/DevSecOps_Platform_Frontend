import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

export interface FindingsStatsResponse {
  environmentId?: string;
  pipelineId?: number;
  applicationId?: string;
  /** OPEN par défaut côté API /stats/by-application */
  statusFilter?: string;
  openDistinctTotal?: number;
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

export interface FindingsTrendsByApplicationResponse {
  applicationId: string;
  branch?: string | null;
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
  /** envId réellement utilisé côté backend (peut différer du envId de la page) */
  effectiveEnvId?: string | null;
}

export interface FindingAiRemediationResponse {
  problemSummary?: string;
  rootCause?: string;
  impact?: string;
  businessRisk?: string;
  location?: string;
  reproduction?: string;
  remediationSteps?: string[];
  suggestedPatch?: string;
  secureCodeBefore?: string;
  secureCodeAfter?: string;
  fullFileRewrite?: string;
  bestPractices?: string[];
  references?: { type: string; id: string; url: string }[];
  verificationHints?: string[];
  verificationCommands?: string[];
  confidence?: string;
  rawModelOutput?: string;
  codeContextSource?: string;

  /** Infos d’observabilité : provider/modèle réellement utilisé + fallback quota éventuel */
  aiProviderUsed?: string | null;
  aiModelUsed?: string | null;
  quotaFallbackUsed?: boolean | null;
  /** DEFAULT | HIGH */
  aiModelTier?: string | null;
  /** CACHE | STATIC | GROQ | OPENROUTER | OLLAMA */
  responseSource?: string | null;
  status?: 'PENDING' | 'COMPLETE' | 'FAILED' | string | null;
  jobId?: string | null;
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

  /**
   * Stats agrégées pour toute l’application (tous envs).
   * Sans `status` : tous les statuts. Sinon OPEN | FIXED | IGNORED | ACCEPTED_RISK | ALL.
   */
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

  getTrendsByEnvironment(envId: string): Observable<FindingsTrendsResponse> {
    return this.http.get<FindingsTrendsResponse>(`${BASE}api/findings/trends/by-environment/${envId}`, {
      headers: this.authHeaders()
    });
  }

  getTrendsByApplication(appId: string, branch?: string): Observable<FindingsTrendsByApplicationResponse> {
    let params = new HttpParams();
    const b = branch?.trim();
    if (b) params = params.set('branch', b);
    return this.http.get<FindingsTrendsByApplicationResponse>(`${BASE}api/findings/trends/by-application/${appId}`, {
      headers: this.authHeaders(),
      params
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
    filters?: { tool?: string; severity?: string; scanType?: string }
  ): Observable<PageResponse<FindingItem>> {
    let params = new HttpParams().set('page', String(page)).set('size', String(size));
    const tool = filters?.tool?.trim();
    const severity = filters?.severity?.trim();
    const scanType = filters?.scanType?.trim();
    if (tool) params = params.set('tool', tool);
    if (severity) params = params.set('severity', severity);
    if (scanType) params = params.set('scanType', scanType);
    return this.http.get<PageResponse<FindingItem>>(`${BASE}api/findings/by-environment/${envId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  getStatsByPipeline(pipelineId: number): Observable<FindingsStatsResponse> {
    return this.http.get<FindingsStatsResponse>(`${BASE}api/findings/stats/by-pipeline/${pipelineId}`, {
      headers: this.authHeaders()
    });
  }

  /** Findings dont au moins une occurrence a été enregistrée pour ce pipeline GitLab. */
  listByPipeline(
    pipelineId: number,
    page: number = 0,
    size: number = 50,
    filters?: { tool?: string; severity?: string; scanType?: string; status?: string }
  ): Observable<PageResponse<FindingItem>> {
    let params = new HttpParams().set('page', String(page)).set('size', String(size));
    const tool = filters?.tool?.trim();
    const severity = filters?.severity?.trim();
    const scanType = filters?.scanType?.trim();
    const status = filters?.status?.trim();
    if (tool) params = params.set('tool', tool);
    if (severity) params = params.set('severity', severity);
    if (scanType) params = params.set('scanType', scanType);
    if (status) params = params.set('status', status);
    return this.http.get<PageResponse<FindingItem>>(`${BASE}api/findings/by-pipeline/${pipelineId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  /** Résout des empreintes (ex. trends.fixedFingerprints) vers des enregistrements projet. */
  resolveFingerprintsForApplication(appId: string, fingerprints: string[]): Observable<FindingItem[]> {
    if (!fingerprints.length) {
      return of([]);
    }
    let params = new HttpParams();
    for (const fp of fingerprints) {
      const t = fp?.trim();
      if (t) params = params.append('fp', t);
    }
    return this.http.get<FindingItem[]>(`${BASE}api/findings/by-application/${appId}/fingerprints`, {
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

  ingestPipeline(pipelineId: number): Observable<any> {
    return this.http.post(`${BASE}api/findings/ingest/pipeline/${pipelineId}`, null, {
      headers: this.authHeaders()
    });
  }

  getDetail(findingId: string, paramsIn: { envId?: string; appId?: string }): Observable<FindingDetailResponse> {
    let params = new HttpParams();
    if (paramsIn.envId) params = params.set('envId', paramsIn.envId);
    if (paramsIn.appId) params = params.set('appId', paramsIn.appId);
    return this.http.get<FindingDetailResponse>(`${BASE}api/findings/detail/${findingId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  postFindingChat(
    findingId: string,
    envId: string,
    appId: string | null,
    body: { messages: { role: string; content: string }[]; remediationSummary?: string }
  ): Observable<{ reply: string }> {
    let params = new HttpParams().set('envId', envId);
    if (appId) params = params.set('appId', appId);
    return this.http.post<{ reply: string }>(`${BASE}api/findings/detail/${findingId}/ai-chat`, body, {
      headers: this.authHeaders().set('Content-Type', 'application/json'),
      params
    });
  }

  requestAiRemediation(
    findingId: string,
    envId: string,
    appId: string | null,
    body?: { codeSnippet?: string }
  ): Observable<FindingAiRemediationResponse> {
    let params = new HttpParams().set('envId', envId);
    if (appId) params = params.set('appId', appId);
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

