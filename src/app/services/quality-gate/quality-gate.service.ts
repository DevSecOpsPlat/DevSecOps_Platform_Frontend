import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

export interface HardGateViolation {
  id: string;
  label: string;
  message: string;
  status: 'VIOLATED' | 'INDETERMINATE' | string;
}

export interface QualityGateStage {
  name: string;
  toolLabel?: string;
  status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED' | 'RUNNING' | string;
  statusLabel?: string;
  message?: string;
  blocking?: boolean;
  metrics?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export interface QualityGateToolMetric {
  id: string;
  label: string;
  type: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  source?: string;
  stageStatus?: string;
  stageName?: string;
  stageLabel?: string;
  /** false si le job GitLab n'a pas produit de rapport fiable. */
  evaluable?: boolean;
}

export interface QualityGateEnvironmentOption {
  environmentId: string;
  environmentName: string;
  branch: string;
  status?: string;
  pipelineId?: string | null;
  pipelineStatus?: string | null;
  evaluatedAt?: string | null;
  snapshotSavedAt?: string | null;
  snapshotId?: string | null;
  snapshotSource?: string | null;
  verdict?: string | null;
  hasSnapshot?: boolean;
}

export interface ScoreBreakdownItem {
  id: string;
  category: string;
  label: string;
  impact: number;
  capScore?: number | null;
  detail?: string;
}

export interface SecurityScore {
  score: number;
  grade: string;
  derivedVerdict: string;
  breakdown: ScoreBreakdownItem[];
  rawScoreBeforeCaps?: number;
  appliedCaps?: string[];
}

export interface SoftwareQualityDimension {
  dimension: string;
  issues: number;
  rating: string;
  ratingValue: number;
  bySeverity?: Record<string, number>;
}

export interface SonarAvailability {
  available: boolean;
  projectKey?: string;
  requestedBranch?: string;
  resolvedBranch?: string;
  message?: string;
  dashboardUrl?: string;
}

export interface SonarQubeMetrics {
  bugs?: number;
  vulnerabilities?: number;
  codeSmells?: number;
  openIssues?: number;
  coverage?: number;
  duplications?: number;
  hotspots?: number;
  ncloc?: number;
  status?: string;
  failedConditions?: number;
  conditions?: Array<Record<string, unknown>>;
  bySeverity?: Record<string, number>;
  securityRating?: string;
  reliabilityRating?: string;
  maintainabilityRating?: string;
  openSecurity?: number;
  openReliability?: number;
  openMaintainability?: number;
  branch?: string;
  softwareQuality?: SoftwareQualityDimension[];
  softwareQualitySeverity?: Record<string, number>;
}

export interface QualityGateResult {
  applicationId: string;
  branch?: string | null;
  pipelineId?: string | null;
  environmentId?: string | null;
  evaluatedAt?: string | null;
  pipelineStatus?: string | null;
  pipelineWebUrl?: string | null;
  stages: QualityGateStage[];
  toolMetrics?: QualityGateToolMetric[];
  metrics: {
    totalVulnerabilities?: number;
    ncloc?: number;
    bySeverity?: Record<string, number>;
    failedStages?: number;
    blockingStages?: number;
    warningStages?: number;
    secrets?: number;
    sonarQube?: SonarQubeMetrics;
    defectDojoAvailable?: boolean;
    metricsFromSecurityValidation?: boolean;
    pipelineFinished?: boolean;
    sonarJobFailed?: boolean;
    securityValidationFailed?: boolean;
    securityValidationGitlabFailed?: boolean;
    securityValidationSucceeded?: boolean;
    recommendationReliable?: boolean;
    failedScanJobs?: string[];
    ddCritical?: number;
    sonarCritical?: number;
    combinedCritical?: number;
  };
  thresholds?: Record<string, unknown>;
  verdict: 'RECOMMENDED' | 'WITH_WARNINGS' | 'NOT_RECOMMENDED' | 'INDETERMINE' | 'UNKNOWN' | string;
  ciVerdict?: string;
  verdictSource?: string;
  hardGateViolations?: HardGateViolation[];
  hardGateIndeterminate?: HardGateViolation[];
  hardGateSummary?: string | null;
  defectDojoAvailable?: boolean;
  metricsFromSecurityValidation?: boolean;
  pipelineFinished?: boolean;
  indeterminateSources?: string[];
  incompleteRecommendationMessage?: string | null;
  recommendationReliable?: boolean;
  reliabilityMessage?: string | null;
  failedScanJobs?: string[];
  securityScore?: SecurityScore;
  softwareQuality?: SoftwareQualityDimension[];
  softwareQualitySeverity?: Record<string, number>;
  sonarAvailability?: SonarAvailability;
  availableBranches?: string[];
  summary: string;
  detailedRecommendations: string[];
  verdictExplanation?: string[];
  practicalAdvice?: string[];
  scoringNote?: string;
  trendNote?: string | null;
  source?: string;
  snapshotId?: string | null;
  snapshotRecordSource?: string | null;
  fromSnapshot?: boolean;
  canCaptureSnapshot?: boolean;
  ncloc?: number | null;
  nclocSource?: string | null;
  aiInsight?: string | null;
}

@Injectable({ providedIn: 'root' })
export class QualityGateService {
  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getQualityGate(
    applicationId: string,
    branch?: string | null,
    environmentId?: string | null,
    refresh = false
  ): Observable<QualityGateResult> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch && branch !== '__global__') {
      params = params.set('branch', branch);
    }
    if (environmentId) {
      params = params.set('environmentId', environmentId);
    }
    if (refresh) {
      params = params.set('refresh', 'true');
    }
    return this.http.get<QualityGateResult>(BASE + 'api/quality-gate', {
      headers: this.authHeaders(),
      params
    });
  }

  refreshSnapshot(applicationId: string, environmentId: string): Observable<QualityGateResult> {
    return this.http.post<QualityGateResult>(
      BASE + 'api/quality-gate/snapshots/capture',
      {},
      {
        headers: this.authHeaders(),
        params: { applicationId, environmentId }
      }
    );
  }

  listEnvironments(applicationId: string, branch?: string | null): Observable<QualityGateEnvironmentOption[]> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch && branch !== '__global__') {
      params = params.set('branch', branch);
    }
    return this.http.get<QualityGateEnvironmentOption[]>(BASE + 'api/quality-gate/environments', {
      headers: this.authHeaders(),
      params
    });
  }

  listBranches(applicationId: string): Observable<string[]> {
    return this.http.get<string[]>(BASE + 'api/quality-gate/branches', {
      headers: this.authHeaders(),
      params: { applicationId }
    });
  }

  backfillSnapshots(applicationId: string): Observable<{ status: string; created: number }> {
    return this.http.post<{ status: string; created: number }>(
      BASE + 'api/quality-gate/snapshots/backfill',
      {},
      { headers: this.authHeaders(), params: { applicationId } }
    );
  }

  generateAiInsight(
    applicationId: string,
    branch?: string | null,
    environmentId?: string | null
  ): Observable<{ insight: string; message?: string }> {
    let params = new HttpParams().set('applicationId', applicationId);
    if (branch && branch !== '__global__') {
      params = params.set('branch', branch);
    }
    if (environmentId) {
      params = params.set('environmentId', environmentId);
    }
    return this.http.post<{ insight: string; message?: string }>(
      BASE + 'api/quality-gate/ai-insight',
      {},
      { headers: this.authHeaders(), params }
    );
  }
}
