import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AnalyzeArtifactRequest,
  AnalyzeArtifactResponse
} from '../../models/ai/analyze-artifact.model';
import {
  ExplainPipelineLogsRequest,
  ExplainPipelineLogsResponse
} from '../../models/ai/explain-pipeline-logs.model';
import { UserService } from '../user/user.service';

const BASE = environment.BASE_URL;

@Injectable({
  providedIn: 'root'
})
export class AiAnalysisService {

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
   * Envoie le contenu d'un artifact (rapport de scan) à l'API IA pour obtenir
   * les vulnérabilités avec description, emplacement et remédiation.
   */
  analyzeArtifact(request: AnalyzeArtifactRequest): Observable<AnalyzeArtifactResponse> {
    return this.http.post<AnalyzeArtifactResponse>(
      BASE + 'api/ai/analyze-artifact',
      request,
      { headers: this.authHeaders() }
    );
  }

  /**
   * Explique les logs d'un job CI (causes + actions) sans suggérer d'accès cluster.
   */
  explainPipelineLogs(request: ExplainPipelineLogsRequest): Observable<ExplainPipelineLogsResponse> {
    return this.http.post<ExplainPipelineLogsResponse>(
      BASE + 'api/ai/explain-pipeline-logs',
      request,
      { headers: this.authHeaders() }
    );
  }
}
