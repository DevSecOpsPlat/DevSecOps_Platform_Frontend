export interface PipelineJobInfo {
  id: number;
  name: string;
  status: string;
  stage: string;
  duration?: number;
  webUrl?: string;
}

export interface PipelineScanResponse {
  pipelineId: number | null;
  status: string;
  webUrl: string | null;
  jobStatusCount: Record<string, number>;
  jobs: PipelineJobInfo[];
  securityReports: Record<string, any>;
  hasValidGitLabId?: boolean;
}

