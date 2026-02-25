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
  hasValidGitLabId?: boolean;
  ref: 'main';
  triggeredBy: 'admin';
  durationSeconds: 125;
}

