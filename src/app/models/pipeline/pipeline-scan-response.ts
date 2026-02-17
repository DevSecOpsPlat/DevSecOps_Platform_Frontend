export interface PipelineJobInfo {
  id: number;
  name: string;
  status: string;
  stage: string;
  duration?: number;
  webUrl?: string;
}

export interface PipelineScanResponse {
  pipelineId: number;
  status: string;
  webUrl: string;
  jobStatusCount: Record<string, number>;
  jobs: PipelineJobInfo[];
  securityReports: Record<string, any>;
}

