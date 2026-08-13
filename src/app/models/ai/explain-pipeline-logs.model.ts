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
}

export interface ExplainPipelineLogsResponse {
  answer: string;
  summary: string;
  probableCauses: string[];
  suggestedActions: string[];
}
