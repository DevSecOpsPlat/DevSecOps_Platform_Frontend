import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ApplicationResponse } from '../../models/application/application-response';
import { DeploymentHistoryItem } from '../../models/deployment/deployment-history-item';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

@Injectable({
  providedIn: 'root'
})
export class ApplicationService {

  private deploymentsCache = new Map<string, {data: DeploymentHistoryItem[], timestamp: number}>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  constructor(
    private http: HttpClient, 
    private userService: UserService
  ) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  getMyApplications(): Observable<ApplicationResponse[]> {
    return this.http.get<any[]>(BASE + 'api/applications', { headers: this.authHeaders() }).pipe(
      map(items => (items ?? []).map(x => this.convertApplication(x)))
    );
  }

  getApplicationById(id: string): Observable<ApplicationResponse> {
    return this.http.get<any>(BASE + `api/applications/${id}`, { headers: this.authHeaders() }).pipe(
      map(x => this.convertApplication(x))
    );
  }

  /**
   * Récupère l'historique des déploiements
   * @param appId - ID de l'application
   * @param branch - Filtre optionnel par branche
   */
  getDeploymentHistory(appId: string, branch?: string): Observable<DeploymentHistoryItem[]>;

  /**
   * Récupère l'historique des déploiements avec pagination
   * @param appId - ID de l'application
   * @param page - Numéro de page
   * @param size - Taille de la page
   */
  getDeploymentHistory(appId: string, page: number, size: number): Observable<DeploymentHistoryItem[]>;

  /**
   * Récupère l'historique des déploiements avec options avancées
   * @param appId - ID de l'application
   * @param options - Options (branch, page, size)
   */
  getDeploymentHistory(
    appId: string, 
    options?: { branch?: string; page?: number; size?: number }
  ): Observable<DeploymentHistoryItem[]>;

  // Implémentation unique
  getDeploymentHistory(
    appId: string, 
    param2?: string | number | { branch?: string; page?: number; size?: number },
    param3?: number
  ): Observable<DeploymentHistoryItem[]> {
    
    // Normaliser les paramètres
    let branch: string | undefined;
    let page: number | undefined;
    let size: number | undefined;
    
    if (typeof param2 === 'string') {
      // Cas 1: getDeploymentHistory(appId, branch)
      branch = param2;
    } else if (typeof param2 === 'number' && typeof param3 === 'number') {
      // Cas 2: getDeploymentHistory(appId, page, size)
      page = param2;
      size = param3;
    } else if (param2 && typeof param2 === 'object') {
      // Cas 3: getDeploymentHistory(appId, options)
      branch = param2.branch;
      page = param2.page;
      size = param2.size;
    }
    
    // Créer une clé de cache unique
    const cacheKey = `${appId}-${branch || ''}-${page || 0}-${size || 10}`;
    
    // Vérifier le cache
    const cached = this.deploymentsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return of(cached.data);
    }
    
    // Construire l'URL avec les paramètres
    let url = `${BASE}api/applications/${appId}/deployments`;
    const params: string[] = [];
    
    if (branch) {
      params.push(`branch=${encodeURIComponent(branch)}`);
    }
    
    if (page !== undefined && size !== undefined) {
      params.push(`page=${page}`);
      params.push(`size=${size}`);
    }
    
    if (params.length > 0) {
      url += `?${params.join('&')}`;
    }
    
    // Faire l'appel API
    return this.http.get<any[]>(url, { headers: this.authHeaders() }).pipe(
      map(items => items.map(item => this.convertDeploymentItem(item))),
      tap(data => {
        // Mettre en cache
        this.deploymentsCache.set(cacheKey, {data, timestamp: Date.now()});
      })
    );
  }

  private convertDeploymentItem(item: any): DeploymentHistoryItem {
    return {
      environmentId: item.environmentId,
      environmentName: item.environmentName,
      gitBranch: item.gitBranch,
      pipelineId: item.pipelineId,
      pipelineStatus: item.pipelineStatus,
      environmentStatus: item.environmentStatus,
      ttlHours: item.ttlHours,
      shortSha: item.shortSha,
      commitMessage: item.commitMessage,
      createdAt: this.convertDateArray(item.createdAt),
      expiresAt: this.convertDateArray(item.expiresAt),
      finishedAt: item.finishedAt ? this.convertDateArray(item.finishedAt) : null,
      triggeredByUsername: item.triggeredByUsername
    };
  }

  private convertDateArray(dateArray: any[] | null | string): string {
    if (!dateArray) return new Date().toISOString();
    
    // Si c'est déjà une string, la retourner
    if (typeof dateArray === 'string') return dateArray;
    
    // Si c'est un tableau [année, mois, jour, heure, minute, seconde]
    if (Array.isArray(dateArray) && dateArray.length >= 6) {
      const [year, month, day, hour, minute, second] = dateArray;
      // Attention: mois est 0-indexé en JS, donc month - 1
      const date = new Date(year, month - 1, day, hour, minute, second);
      return date.toISOString();
    }
    
    return new Date().toISOString();
  }

  private convertApplication(item: any): ApplicationResponse {
    return {
      id: item.id,
      name: item.name,
      description: item.description,
      gitRepositoryUrl: item.gitRepositoryUrl,
      dockerfilePath: item.dockerfilePath,
      createdAt: this.convertDateArray(item.createdAt),
      createdByUsername: item.createdByUsername,
      hasGithubToken: !!item.hasGithubToken
    };
  }
  
  
}