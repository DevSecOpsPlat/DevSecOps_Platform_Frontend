export interface PipelineJobInfo {
  id: number;
  name: string;
  status: string;
  stage: string;
  duration?: number;
  webUrl?: string;
    ref?: string;
  triggeredBy?: string;
  durationSeconds?: number;
 
}

export interface PipelineScanResponse {
  pipelineId: number | null;
  status: string;
  webUrl: string | null;
  jobStatusCount: Record<string, number>;
  jobs: PipelineJobInfo[];
  securityReports: Record<string, any>;
  /** "gitlab" = données en direct, "database" = affichage depuis la BDD (GitLab indisponible) */
  dataSource?: 'gitlab' | 'database';
  hasValidGitLabId?: boolean;
  ref?: string;
  triggeredBy?: string;
  durationSeconds?: number;
}

