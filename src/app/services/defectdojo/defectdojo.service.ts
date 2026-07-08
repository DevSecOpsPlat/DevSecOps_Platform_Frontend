import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';
import { FindingAiRemediationResponse } from '../../models/finding/finding-ai-remediation.model';

const BASE = environment.BASE_URL;

export type DefectDojoMetricCategory =
  | 'open'
  | 'closed'
  | 'verified'
  | 'risk_accepted'
  | 'false_positive'
  | 'out_of_scope'
  | 'total'
  | 'inactive';

export interface DefectDojoDeployRecommendation {
  status: 'RECOMMANDE' | 'NON_RECOMMANDE' | 'INCONNU';
  deployRecommended: boolean;
  criticalCount: number;
  highCount: number;
  criticalThreshold: number;
  reason: string;
  source: string;
}

export interface DefectDojoMetricCard {
  key: DefectDojoMetricCategory;
  label: string;
  total: number;
  bySeverity: Record<string, number>;
}

export interface DefectDojoFindingItem {
  id: number;
  title: string;
  description?: string;
  severity: string;
  status: string;
  active: boolean;
  verified: boolean;
  mitigated: boolean;
  falsePositive?: boolean;
  outOfScope?: boolean;
  riskAccepted?: boolean;
  underReview?: boolean;
  cwe?: string;
  cvssScore?: number;
  cve?: string;
  filePath?: string;
  line?: number;
  componentName?: string;
  scanType?: string;
  testId?: number;
  testTitle?: string;
  toolName?: string;
  mitigation?: string;
  created?: string;
  mitigatedDate?: string;
  url?: string;
}

export type DefectDojoFindingStatusAction =
  | 'VERIFY'
  | 'UNVERIFY'
  | 'FALSE_POSITIVE'
  | 'OUT_OF_SCOPE'
  | 'UNDER_REVIEW'
  | 'REACTIVATE'
  | 'CLOSE'
  | 'REOPEN'
  | 'ACCEPT_RISK'
  | 'UNACCEPT_RISK';

export interface DefectDojoFindingDetail extends DefectDojoFindingItem {
  falsePositive?: boolean;
  outOfScope?: boolean;
  riskAccepted?: boolean;
  lineEnd?: number;
  impact?: string;
  references?: string;
  branch?: string;
  engagementName?: string;
  productName?: string;
  codeSnippet?: string;
  codeContextSource?: string;
  codeContextHint?: string;
  applicationId?: string;
}

export interface DefectDojoFindingsPage {
  content: DefectDojoFindingItem[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
  category: string;
}

export interface DefectDojoScanSnapshot {
  testId: number;
  scanType: string;
  label: string;
  date?: string;
  timestamp?: string;
  totalOpen: number;
  bySeverity: Record<string, number>;
}

export interface DefectDojoTimeSeriesPoint {
  period: string;
  bySeverity: Record<string, number>;
}

export interface DefectDojoWeekStatusPoint {
  week: string;
  opened: number;
  closed: number;
  riskAccepted: number;
}

export interface DefectDojoWeeklyActivityPoint {
  week: string;
  dayOfWeek: number;
  dayLabel: string;
  count: number;
}

export interface DefectDojoDetailedMetrics {
  openDayToDayBySeverity: DefectDojoTimeSeriesPoint[];
  openHourToHourBySeverity: DefectDojoTimeSeriesPoint[];
  weekToWeekStatus: DefectDojoWeekStatusPoint[];
  weekToWeekBySeverity: DefectDojoTimeSeriesPoint[];
  findingAgeBuckets: Record<string, number>;
  openFindingsForAge: number;
  weeklyActivity: DefectDojoWeeklyActivityPoint[];
  openCwe: Record<string, number>;
  totalCwe: Record<string, number>;
}

export interface DefectDojoDashboardCharts {
  openCount: number;
  closedCount: number;
  totalCount: number;
  bySeverity: Record<string, number>;
  byTool: Record<string, number>;
  byAnalysisType: Record<string, number>;
  byStatus: Record<string, number>;
  scanSnapshots: DefectDojoScanSnapshot[];
  detailedMetrics?: DefectDojoDetailedMetrics;
  lastScanDate?: string;
}

export interface DefectDojoDashboard2Response {
  configured: boolean;
  message?: string;
  scope: 'global' | 'branch' | 'environment' | 'pipeline' | 'scan';
  environmentTag?: string | null;
  pipelineTag?: string | null;
  applicationName?: string;
  productName?: string;
  productId?: number;
  productUrl?: string;
  selectedBranch?: string | null;
  engagementId?: number;
  engagementName?: string;
  bySeverity?: Record<string, number>;
  byTool?: Record<string, number>;
  byStatus?: Record<string, number>;
  totalOpen?: number;
  totalClosed?: number;
  securityScore?: {
    grade: string;
    score: number;
    summary: string;
  };
  topRecurrent?: {
    identifier: string;
    label: string;
    count: number;
    severity: string;
    type: string;
  }[];
  trendPoints?: {
    label: string;
    date?: string;
    openStock: number;
    newFindings: number;
    resolved: number;
  }[];
  branches?: string[];
  engagements?: { id?: number; name?: string; branchTag?: string; activeFindings?: number }[];
  charts?: DefectDojoDashboardCharts;
  defectDojoBaseUrl?: string;
}

export interface DefectDojoDashboardResponse {
  configured: boolean;
  message?: string;
  productName?: string;
  productId?: number;
  engagementName?: string;
  engagementId?: number;
  branch?: string;
  engagementStatus?: string;
  bySeverity?: Record<string, number>;
  byStatus?: Record<string, number>;
  totalActive?: number;
  totalMitigated?: number;
  totalFindings?: number;
  metricCards?: DefectDojoMetricCard[];
  charts?: DefectDojoDashboardCharts;
  availableEngagements?: { id?: number; name?: string; branchTag?: string; activeFindings?: number }[];
  deployRecommendation?: DefectDojoDeployRecommendation;
  defectDojoBaseUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class DefectDojoService {
  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getDashboard(
    applicationId: string,
    branch?: string,
    tags?: string,
    includeCharts = true
  ): Observable<DefectDojoDashboardResponse> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch?.trim()) params = params.set('branch', branch.trim());
    if (tags?.trim()) params = params.set('tags', tags.trim());
    if (!includeCharts) params = params.set('includeCharts', 'false');
    return this.http.get<DefectDojoDashboardResponse>(BASE + 'api/defectdojo/dashboard', {
      headers: this.authHeaders(),
      params
    });
  }

  /** Graphiques du centre de sécurité — chargement différé après le résumé KPI. */
  getDashboardCharts(applicationId: string, branch?: string, tags?: string): Observable<DefectDojoDashboardCharts> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch?.trim()) params = params.set('branch', branch.trim());
    if (tags?.trim()) params = params.set('tags', tags.trim());
    return this.http.get<DefectDojoDashboardCharts>(BASE + 'api/defectdojo/dashboard/charts', {
      headers: this.authHeaders(),
      params
    });
  }

  /** Dashboard sécurité v2 — vue globale si branch omis ou __all__. */
  getDashboard2(
    applicationId: string,
    branch?: string,
    options?: { pipelineId?: number | string; environmentId?: string; scanOnly?: boolean }
  ): Observable<DefectDojoDashboard2Response> {
    let params = new HttpParams().set('applicationId', applicationId);
    const b = this.normalizeDashboardBranch(branch);
    if (b) params = params.set('branch', b);
    if (options?.pipelineId != null && String(options.pipelineId).trim()) {
      params = params.set('pipelineId', String(options.pipelineId).trim());
    }
    if (options?.environmentId?.trim()) {
      params = params.set('environmentId', options.environmentId.trim());
    }
    const scanOnly = options?.scanOnly !== false;
    params = params.set('scanOnly', String(scanOnly));
    return this.http.get<DefectDojoDashboard2Response>(BASE + 'api/defectdojo/dashboard2', {
      headers: this.authHeaders(),
      params
    });
  }

  /** Graphiques dashboard2 — optionnel (inclus dans getDashboard2). */
  getDashboard2Charts(applicationId: string, branch?: string): Observable<DefectDojoDashboardCharts> {
    let params = new HttpParams().set('applicationId', applicationId);
    const b = this.normalizeDashboardBranch(branch);
    if (b) {
      params = params.set('branch', b);
    }
    return this.http.get<DefectDojoDashboardCharts>(BASE + 'api/defectdojo/dashboard2/charts', {
      headers: this.authHeaders(),
      params
    });
  }

  private normalizeDashboardBranch(branch?: string): string | undefined {
    const b = branch?.trim();
    if (!b || b === '__all__' || b.toLowerCase() === 'all' || b === '*' || b.toLowerCase() === 'global') {
      return undefined;
    }
    return b;
  }

  getFindings(
    applicationId: string,
    branch: string | undefined,
    category: DefectDojoMetricCategory,
    page = 0,
    size = 25,
    severity?: string,
    tags?: string,
    dateFrom?: string,
    dateTo?: string,
    testId?: number
  ): Observable<DefectDojoFindingsPage> {
    let params = new HttpParams()
      .set('applicationId', applicationId)
      .set('category', category)
      .set('page', String(page))
      .set('size', String(size));
    if (branch?.trim()) params = params.set('branch', branch.trim());
    if (severity?.trim()) params = params.set('severity', severity.trim());
    if (tags?.trim()) params = params.set('tags', tags.trim());
    if (dateFrom?.trim()) params = params.set('dateFrom', dateFrom.trim());
    if (dateTo?.trim()) params = params.set('dateTo', dateTo.trim());
    if (testId != null) params = params.set('testId', String(testId));
    return this.http.get<DefectDojoFindingsPage>(BASE + 'api/defectdojo/findings', {
      headers: this.authHeaders(),
      params
    });
  }

  updateFindingStatus(
    applicationId: string,
    findingId: number,
    action: DefectDojoFindingStatusAction,
    branch?: string
  ): Observable<DefectDojoFindingDetail> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch?.trim()) params = params.set('branch', branch.trim());
    return this.http.post<DefectDojoFindingDetail>(
      BASE + `api/defectdojo/findings/${findingId}/status`,
      { action },
      { headers: this.authHeaders(), params }
    );
  }

  deleteFinding(applicationId: string, findingId: number, branch?: string): Observable<void> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch?.trim()) params = params.set('branch', branch.trim());
    return this.http.delete<void>(BASE + `api/defectdojo/findings/${findingId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  getEnvironmentOpenCounts(applicationId: string): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(BASE + 'api/defectdojo/environment-counts', {
      headers: this.authHeaders(),
      params: { applicationId }
    });
  }

  /** Tag DefectDojo pour filtrer par pipeline GitLab (exécution CI). */
  pipelineTag(pipelineId: number | string): string {
    return `pipeline-${pipelineId}`;
  }

  /** Tag DefectDojo des imports scan (exclut les pipelines deploy). */
  scanKindTag(): string {
    return 'scan';
  }

  /** Tag DefectDojo legacy environnement éphémère. */
  environmentTag(environmentId: string): string {
    return `env-${environmentId}`;
  }

  getFindingDetail(applicationId: string, findingId: number, branch?: string): Observable<DefectDojoFindingDetail> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch?.trim()) params = params.set('branch', branch.trim());
    return this.http.get<DefectDojoFindingDetail>(BASE + `api/defectdojo/findings/${findingId}`, {
      headers: this.authHeaders(),
      params
    });
  }

  requestAiRemediation(
    applicationId: string,
    findingId: number,
    branch: string | undefined,
    body?: { codeSnippet?: string; deepAnalysis?: boolean }
  ): Observable<FindingAiRemediationResponse> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch?.trim()) params = params.set('branch', branch.trim());
    return this.http.post<FindingAiRemediationResponse>(
      BASE + `api/defectdojo/findings/${findingId}/ai-remediation`,
      body ?? {},
      { headers: this.authHeaders(), params }
    );
  }

  pollAiRemediationJob(jobId: string): Observable<FindingAiRemediationResponse> {
    return this.http.get<FindingAiRemediationResponse>(
      BASE + `api/defectdojo/ai-remediation/jobs/${encodeURIComponent(jobId)}`,
      { headers: this.authHeaders() }
    );
  }

  postFindingChat(
    applicationId: string,
    findingId: number,
    branch: string | undefined,
    body: { messages: { role: string; content: string }[]; remediationSummary?: string }
  ): Observable<{ reply: string }> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch?.trim()) params = params.set('branch', branch.trim());
    return this.http.post<{ reply: string }>(
      BASE + `api/defectdojo/findings/${findingId}/ai-chat`,
      body,
      { headers: this.authHeaders(), params }
    );
  }

  getBranches(applicationId: string): Observable<string[]> {
    return this.http.get<string[]>(BASE + 'api/defectdojo/branches', {
      headers: this.authHeaders(),
      params: { applicationId }
    });
  }
}
