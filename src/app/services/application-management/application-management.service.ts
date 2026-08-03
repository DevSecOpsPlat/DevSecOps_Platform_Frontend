import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';
import {
  AppDatabaseModel,
  AppDeployment,
  AppServiceModel,
  ClusterPruneResult,
  DeployPreview,
  DeploymentLogsResponse,
  DeploymentMonitoringResponse,
  DeploymentMonitorAlert,
  DeploymentAlertsResponse,
  DeploymentPodsResponse,
  MetricsHistoryResponse,
  EnvVar,
  ManagedApp,
  RuntimeSyncResult
} from '../../models/application-management/application-management.models';
import { PipelineScanResponse } from '../../models/pipeline/pipeline-scan-response';

const BASE = environment.BASE_URL;
const API = BASE + 'api/managed-applications';
const SCAN_API = BASE + 'api/applications';

/**
 * Appels API du module de gestion des applications managées.
 * Service dédié : n'étend pas et ne modifie pas ApplicationService existant.
 */
@Injectable({ providedIn: 'root' })
export class ApplicationManagementService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private headers(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  // ---------- Applications ----------

  list(): Observable<ManagedApp[]> {
    return this.http.get<ManagedApp[]>(API, { headers: this.headers() });
  }

  /** Services scannés sans projet parent (legacy). */
  listOrphanServices(): Observable<Array<{
    id: string;
    name: string;
    description: string | null;
    gitRepositoryUrl: string | null;
  }>> {
    return this.http.get<Array<{
      id: string;
      name: string;
      description: string | null;
      gitRepositoryUrl: string | null;
    }>>(`${SCAN_API}/orphans`, { headers: this.headers() });
  }

  get(id: string): Observable<ManagedApp> {
    return this.http.get<ManagedApp>(`${API}/${id}`, { headers: this.headers() });
  }

  create(body: { name: string; description?: string }): Observable<ManagedApp> {
    return this.http.post<ManagedApp>(API, body, { headers: this.headers() });
  }

  update(id: string, body: { name: string; description?: string; customHostname?: string | null }): Observable<ManagedApp> {
    return this.http.put<ManagedApp>(`${API}/${id}`, body, { headers: this.headers() });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/${id}`, { headers: this.headers() });
  }

  // ---------- Services ----------

  addService(appId: string, body: AppServiceModel): Observable<AppServiceModel> {
    return this.http.post<AppServiceModel>(`${API}/${appId}/services`, body, { headers: this.headers() });
  }

  updateService(appId: string, serviceId: string, body: AppServiceModel): Observable<AppServiceModel> {
    return this.http.put<AppServiceModel>(`${API}/${appId}/services/${serviceId}`, body, { headers: this.headers() });
  }

  deleteService(appId: string, serviceId: string): Observable<ClusterPruneResult> {
    return this.http.delete<ClusterPruneResult>(`${API}/${appId}/services/${serviceId}`, { headers: this.headers() });
  }

  // ---------- Databases ----------

  addDatabase(appId: string, body: AppDatabaseModel): Observable<AppDatabaseModel> {
    return this.http.post<AppDatabaseModel>(`${API}/${appId}/databases`, body, { headers: this.headers() });
  }

  updateDatabase(appId: string, dbId: string, body: AppDatabaseModel): Observable<AppDatabaseModel> {
    return this.http.put<AppDatabaseModel>(`${API}/${appId}/databases/${dbId}`, body, { headers: this.headers() });
  }

  deleteDatabase(appId: string, dbId: string): Observable<ClusterPruneResult> {
    return this.http.delete<ClusterPruneResult>(`${API}/${appId}/databases/${dbId}`, { headers: this.headers() });
  }

  // ---------- Env vars (CRUD dédié) ----------

  listEnvVars(appId: string, serviceId: string): Observable<EnvVar[]> {
    return this.http.get<EnvVar[]>(`${API}/${appId}/services/${serviceId}/env-vars`, { headers: this.headers() });
  }

  addEnvVar(appId: string, serviceId: string, body: EnvVar): Observable<EnvVar> {
    return this.http.post<EnvVar>(`${API}/${appId}/services/${serviceId}/env-vars`, body, { headers: this.headers() });
  }

  updateEnvVar(appId: string, serviceId: string, envVarId: string, body: EnvVar): Observable<EnvVar> {
    return this.http.put<EnvVar>(`${API}/${appId}/services/${serviceId}/env-vars/${envVarId}`, body, { headers: this.headers() });
  }

  deleteEnvVar(appId: string, serviceId: string, envVarId: string): Observable<void> {
    return this.http.delete<void>(`${API}/${appId}/services/${serviceId}/env-vars/${envVarId}`, { headers: this.headers() });
  }

  // ---------- Déploiements ----------

  deploy(
    appId: string,
    body?: { sessionDurationHours?: number; branch?: string; serviceIds?: string[] }
  ): Observable<AppDeployment> {
    return this.http.post<AppDeployment>(`${API}/${appId}/deploy`, body ?? {}, { headers: this.headers() });
  }

  /** Aperçu infos / warnings avant déploiement (sélection services + TTL). */
  previewDeploy(
    appId: string,
    body?: { sessionDurationHours?: number; branch?: string; serviceIds?: string[] }
  ): Observable<DeployPreview> {
    return this.http.post<DeployPreview>(
      `${API}/${appId}/deploy/preview`,
      body ?? {},
      { headers: this.headers() }
    );
  }

  /** Déclenche un scan sécurité sur un service (AppService UUID). */
  scanService(serviceId: string, branch?: string): Observable<{ gitlabPipelineId?: number; pipelineStatus?: string; message?: string }> {
    const body = branch ? { branch } : {};
    return this.http.post<{ gitlabPipelineId?: number; pipelineStatus?: string; message?: string }>(
      `${SCAN_API}/${serviceId}/scan`,
      body,
      { headers: this.headers() }
    );
  }

  listDeployments(appId: string): Observable<AppDeployment[]> {
    return this.http.get<AppDeployment[]>(`${API}/${appId}/deployments`, { headers: this.headers() });
  }

  getDeployment(appId: string, deploymentId: string): Observable<AppDeployment> {
    return this.http.get<AppDeployment>(`${API}/${appId}/deployments/${deploymentId}`, { headers: this.headers() });
  }

  teardownDeployment(appId: string, deploymentId: string): Observable<AppDeployment> {
    return this.http.delete<AppDeployment>(`${API}/${appId}/deployments/${deploymentId}`, { headers: this.headers() });
  }

  /** Prolonge le TTL (1–24 h, plafond 72 h depuis Ready). */
  extendDeploymentTtl(
    appId: string,
    deploymentId: string,
    additionalHours: number
  ): Observable<AppDeployment> {
    return this.http.post<AppDeployment>(
      `${API}/${appId}/deployments/${deploymentId}/extend-ttl`,
      { additionalHours },
      { headers: this.headers() }
    );
  }

  listDeploymentPods(appId: string, deploymentId: string): Observable<DeploymentPodsResponse> {
    return this.http.get<DeploymentPodsResponse>(
      `${API}/${appId}/deployments/${deploymentId}/pods`,
      { headers: this.headers() }
    );
  }

  getDeploymentMonitoring(appId: string, deploymentId: string): Observable<DeploymentMonitoringResponse> {
    return this.http.get<DeploymentMonitoringResponse>(
      `${API}/${appId}/deployments/${deploymentId}/monitoring`,
      { headers: this.headers() }
    );
  }

  /** Alertes live + historique 24 h (CrashLoop, OOM, health…). */
  getDeploymentAlerts(appId: string, deploymentId: string): Observable<DeploymentAlertsResponse> {
    return this.http.get<DeploymentAlertsResponse>(
      `${API}/${appId}/deployments/${deploymentId}/alerts`,
      { headers: this.headers() }
    );
  }

  getMetricsHistory(
    appId: string,
    deploymentId: string,
    from?: string,
    to?: string
  ): Observable<MetricsHistoryResponse> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return this.http.get<MetricsHistoryResponse>(
      `${API}/${appId}/deployments/${deploymentId}/metrics/history`,
      { headers: this.headers(), params }
    );
  }

  getDeploymentLogs(
    appId: string,
    deploymentId: string,
    workload: string,
    tailLines = 300
  ): Observable<DeploymentLogsResponse> {
    return this.http.get<DeploymentLogsResponse>(
      `${API}/${appId}/deployments/${deploymentId}/logs`,
      { headers: this.headers(), params: { workload, tailLines: String(tailLines) } }
    );
  }

  /** Pipeline GitLab CI lié au déploiement (jobs + statut). */
  getDeploymentCiPipeline(appId: string, deploymentId: string): Observable<PipelineScanResponse> {
    return this.http.get<PipelineScanResponse>(
      `${API}/${appId}/deployments/${deploymentId}/ci-pipeline`,
      { headers: this.headers() }
    );
  }

  /** Logs texte d'un job CI du pipeline de déploiement. */
  getDeploymentCiJobLogs(appId: string, deploymentId: string, jobId: number): Observable<string> {
    return this.http.get(
      `${API}/${appId}/deployments/${deploymentId}/ci-jobs/${jobId}/logs`,
      { headers: this.headers(), responseType: 'text' }
    );
  }

  /** Applique les env vars du service sur le cluster RUNNING (sans rebuild). */
  syncServiceRuntime(appId: string, serviceId: string): Observable<RuntimeSyncResult> {
    return this.http.post<RuntimeSyncResult>(
      `${API}/${appId}/services/${serviceId}/sync-runtime`,
      {},
      { headers: this.headers() }
    );
  }

  /** Rebuild CI d'un seul service dans le namespace RUNNING (même déploiement). */
  rebuildService(appId: string, serviceId: string): Observable<AppDeployment> {
    return this.http.post<AppDeployment>(
      `${API}/${appId}/services/${serviceId}/rebuild`,
      {},
      { headers: this.headers() }
    );
  }

  revealSecret(
    appId: string,
    deploymentId: string,
    body: { type: 'GIT_TOKEN' | 'DB_PASSWORD' | 'ENV_VAR'; targetId: string }
  ): Observable<{ value: string }> {
    return this.http.post<{ value: string }>(
      `${API}/${appId}/deployments/${deploymentId}/reveal-secret`,
      body,
      { headers: this.headers() }
    );
  }
}
