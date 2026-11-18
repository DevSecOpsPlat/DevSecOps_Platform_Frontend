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

  /**
   * Variante streamée (Server-Sent Events) : le texte arrive au fil de l'eau au lieu d'attendre
   * la réponse complète — HttpClient ne gère pas bien le streaming POST, on utilise fetch() direct.
   * Événements du flux : "mode" ({deep:boolean}, une fois avant la réponse — pour afficher ce que
   * l'IA est en train de faire), "chunk" ({t:string}) répétés, puis "done" ou "error" ({message:string}).
   */
  streamExplainPipelineLogs(
    request: ExplainPipelineLogsRequest,
    onMode: (deep: boolean) => void,
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (message: string) => void
  ): void {
    const token = this.userService.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
    let received = false;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      onDone();
    };
    const fail = (message: string) => {
      if (finished) return;
      finished = true;
      onError(message);
    };
    // Flux coupé (proxy, réseau) : la même question via l'appel classique plutôt qu'un message d'erreur.
    // Si une partie de la réponse est déjà affichée, on la garde telle quelle.
    const recover = () => {
      if (finished) return;
      if (received) {
        done();
        return;
      }
      fetch(BASE + 'api/ai/explain-pipeline-logs', { method: 'POST', headers, body: JSON.stringify(request) })
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((r: ExplainPipelineLogsResponse) => {
          const text = (r?.answer || r?.summary || '').trim();
          if (!text) throw new Error('réponse vide');
          onChunk(text);
          done();
        })
        .catch(() => fail('L\'assistant n\'a pas pu répondre. Réessayez dans un instant.'));
    };
    fetch(BASE + 'api/ai/explain-pipeline-logs/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify(request)
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        recover();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          recover();
          return;
        }
        const { value, done: streamDone } = chunk;
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          let eventName = 'message';
          let data = '';
          for (const line of evt.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          if (eventName === 'mode') {
            try { onMode(!!(JSON.parse(data) as { deep: boolean }).deep); } catch { /* ignore */ }
          } else if (eventName === 'chunk') {
            try {
              const t = (JSON.parse(data) as { t: string }).t || '';
              if (t) received = true;
              onChunk(t);
            } catch { /* ignore */ }
          } else if (eventName === 'done') {
            done();
            return;
          } else if (eventName === 'error') {
            try { fail((JSON.parse(data) as { message: string }).message || 'Erreur IA.'); }
            catch { fail('Erreur IA.'); }
            return;
          }
        }
      }
      // Fin de flux sans « done » : réponse partielle conservée, ou nouvel essai sans flux si rien n'est arrivé.
      if (received) done();
      else recover();
    }).catch(() => recover());
  }
}
