import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';
import {
  AppDatabaseModel,
  AppDeployment,
  AppServiceModel,
  EnvVar,
  ManagedApp
} from '../../models/application-management/application-management.models';

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

  get(id: string): Observable<ManagedApp> {
    return this.http.get<ManagedApp>(`${API}/${id}`, { headers: this.headers() });
  }

  create(body: { name: string; description?: string }): Observable<ManagedApp> {
    return this.http.post<ManagedApp>(API, body, { headers: this.headers() });
  }

  update(id: string, body: { name: string; description?: string }): Observable<ManagedApp> {
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

  deleteService(appId: string, serviceId: string): Observable<void> {
    return this.http.delete<void>(`${API}/${appId}/services/${serviceId}`, { headers: this.headers() });
  }

  // ---------- Databases ----------

  addDatabase(appId: string, body: AppDatabaseModel): Observable<AppDatabaseModel> {
    return this.http.post<AppDatabaseModel>(`${API}/${appId}/databases`, body, { headers: this.headers() });
  }

  updateDatabase(appId: string, dbId: string, body: AppDatabaseModel): Observable<AppDatabaseModel> {
    return this.http.put<AppDatabaseModel>(`${API}/${appId}/databases/${dbId}`, body, { headers: this.headers() });
  }

  deleteDatabase(appId: string, dbId: string): Observable<void> {
    return this.http.delete<void>(`${API}/${appId}/databases/${dbId}`, { headers: this.headers() });
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

  deploy(appId: string): Observable<AppDeployment> {
    return this.http.post<AppDeployment>(`${API}/${appId}/deploy`, {}, { headers: this.headers() });
  }

  /** Déploie un seul service (avec sa base dépendante si déclarée). */
  deployService(appId: string, serviceId: string): Observable<AppDeployment> {
    return this.http.post<AppDeployment>(
      `${API}/${appId}/services/${serviceId}/deploy`,
      {},
      { headers: this.headers() }
    );
  }

  /**
   * Liste des services "orphelins" (sans projet parent) — filet de migration pour
   * les apps legacy scannées avant l'introduction des projets.
   */
  listOrphanServices(): Observable<Array<{
    id: string;
    name: string;
    description: string | null;
    gitRepositoryUrl: string | null;
  }>> {
    return this.http.get<any>(`${SCAN_API}/orphans`, { headers: this.headers() });
  }

  /**
   * Retourne le projet parent d'un service (ou null si orphelin), utilisé par l'UI pour
   * afficher ou non un bouton "Déployer ce service" (ex : dashboard vulnérabilités).
   */
  getDeployContext(applicationId: string): Observable<{
    applicationId: string;
    managedApplicationId: string | null;
    canDeploySingle: boolean;
    serviceName: string;
  }> {
    return this.http.get<any>(`${SCAN_API}/${applicationId}/deploy-context`, { headers: this.headers() });
  }

  /**
   * Déclenche un scan sur un service — repo/token lus côté serveur depuis l'entité,
   * aucune ressaisie. {@code applicationId} = `applications.id` (id du service).
   */
  scanService(
    applicationId: string,
    body?: { sessionDurationHours?: number; branch?: string }
  ): Observable<{
    environmentId: string;
    applicationId: string;
    environmentName: string;
    gitlabPipelineId: number | null;
    pipelineStatus: string;
    pipelineWebUrl: string;
    message: string;
  }> {
    return this.http.post<any>(
      `${SCAN_API}/${applicationId}/scan`,
      body ?? {},
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
