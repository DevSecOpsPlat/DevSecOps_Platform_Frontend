// src/app/services/security/security.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { UserService } from '../user/user.service';
import { DashboardVulnerabilityItem } from 'src/app/models/dashboard/dashboard.models';

const BASE = environment.BASE_URL;

@Injectable({
  providedIn: 'root'
})
export class SecurityService {

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

  /**
   * Récupère les vulnérabilités récentes
   * @param limit Nombre maximum de vulnérabilités à retourner
   * @param appId Optionnel - filtre par application
   */
  getRecentVulnerabilities(limit: number = 5, appId?: string): Observable<DashboardVulnerabilityItem[]> {
    // Construction de l'URL avec paramètres optionnels
    let url = `${BASE}api/security/vulnerabilities/recent?limit=${limit}`;
    if (appId) {
      url += `&appId=${appId}`;
    }
    
    return this.http.get<any[]>(url, { headers: this.authHeaders() }).pipe(
      map(response => this.mapVulnerabilities(response)),
      catchError(error => {
        console.error('Erreur chargement vulnérabilités:', error);
        // Retourner des données mockées en cas d'erreur (pour le développement)
        return of(this.getMockVulnerabilities(limit));
      })
    );
  }

  /**
   * Récupère toutes les vulnérabilités avec pagination
   */
  getVulnerabilities(page: number = 0, size: number = 20): Observable<any> {
    return this.http.get(`${BASE}api/security/vulnerabilities?page=${page}&size=${size}`, {
      headers: this.authHeaders()
    });
  }

  /**
   * Récupère une vulnérabilité par son ID
   */
  getVulnerabilityById(id: string): Observable<any> {
    return this.http.get(`${BASE}api/security/vulnerabilities/${id}`, {
      headers: this.authHeaders()
    });
  }

  /**
   * Récupère les statistiques de sécurité
   */
  getSecuritySummary(appId?: string): Observable<any> {
    let url = `${BASE}api/security/summary`;
    if (appId) {
      url += `?appId=${appId}`;
    }
    return this.http.get(url, { headers: this.authHeaders() });
  }

  /**
   * Mappe la réponse API vers notre modèle DashboardVulnerabilityItem
   */
  private mapVulnerabilities(response: any[]): DashboardVulnerabilityItem[] {
    if (!response || !Array.isArray(response)) {
      return [];
    }
    
    return response.map(item => ({
      id: item.id || String(Math.random()),
      title: item.title || item.name || 'Vulnérabilité inconnue',
      severity: this.mapSeverity(item.severity),
      component: item.component || item.package || 'N/A',
      version: item.version || '?',
      fixedVersion: item.fixedVersion || item.patchedVersion || null,
      description: item.description || null,
      score: item.score || item.cvss || null,
      createdAt: item.createdAt || item.discoveredAt || new Date().toISOString()
    }));
  }

  /**
   * Mappe les sévérités vers un format standard
   */
  private mapSeverity(severity: string): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO' {
    const s = (severity || '').toUpperCase();
    if (s.includes('CRITICAL')) return 'CRITICAL';
    if (s.includes('HIGH')) return 'HIGH';
    if (s.includes('MEDIUM')) return 'MEDIUM';
    if (s.includes('LOW')) return 'LOW';
    return 'INFO';
  }

  /**
   * Données mockées pour le développement (quand l'API n'est pas disponible)
   */
  private getMockVulnerabilities(limit: number): DashboardVulnerabilityItem[] {
    const mockData: DashboardVulnerabilityItem[] = [
      {
        id: '1',
        title: 'Prototype Pollution in lodash',
        severity: 'HIGH',
        component: 'lodash',
        version: '4.17.20',
        fixedVersion: '4.17.21',
        description: 'A vulnerability in versions prior to 4.17.21 allows prototype pollution.',
        score: 7.4,
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString()
      },
      {
        id: '2',
        title: 'Cross-site scripting in express',
        severity: 'MEDIUM',
        component: 'express',
        version: '4.17.1',
        fixedVersion: '4.18.0',
        description: 'Express before 4.18.0 is vulnerable to XSS via the response.redirect() method.',
        score: 5.2,
        createdAt: new Date(Date.now() - 5 * 86400000).toISOString()
      },
      {
        id: '3',
        title: 'Command injection in child_process',
        severity: 'CRITICAL',
        component: 'node',
        version: '14.15.0',
        fixedVersion: '14.18.0',
        description: 'A command injection vulnerability exists in the child_process module.',
        score: 9.1,
        createdAt: new Date(Date.now() - 1 * 86400000).toISOString()
      },
      {
        id: '4',
        title: 'Regular Expression Denial of Service',
        severity: 'LOW',
        component: 'moment',
        version: '2.29.1',
        fixedVersion: '2.29.2',
        description: 'Moment.js is vulnerable to ReDoS in the `string` parsing function.',
        score: 3.7,
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString()
      }
    ];
    
    return mockData.slice(0, limit);
  }
}