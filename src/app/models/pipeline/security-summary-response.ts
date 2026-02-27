export interface SecuritySummaryResponse {
  environmentId: string;
  environmentName: string;

  pipelineId: number | null;
  pipelineStatus: string;

  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

