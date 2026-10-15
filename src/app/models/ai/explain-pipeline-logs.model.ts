/** Un tour de conversation (rôle + contenu) — pour le fil de discussion du chat pipeline. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ExplainPipelineLogsRequest {
  /** Optionnel — pas requis pour une question factuelle (URL, statut…). */
  logs?: string;
  jobName?: string;
  stageName?: string;
  jobStatus?: string;
  pipelineKind?: string;
  stagesOverview?: string;
  projectHint?: string;
  /** Namespace, URLs, services, statut déploiement, etc. */
  projectContext?: string;
  userQuestion?: string;
  /** Tours précédents de la conversation (sans le dernier message, qui reste dans userQuestion). */
  history?: ChatTurn[];
}

export interface ExplainPipelineLogsResponse {
  answer: string;
  summary: string;
  probableCauses: string[];
  suggestedActions: string[];
}
