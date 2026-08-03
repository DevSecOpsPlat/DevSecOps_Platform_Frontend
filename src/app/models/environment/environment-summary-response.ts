export interface EnvironmentSummaryResponse {
  id: string;
  environmentName: string;
  gitRepositoryUrl: string;
  gitBranch: string;
  ttlHours: number;
  status: string;
  previewUrl?: string | null;
  statusReason?: string | null;
  terminatedAt?: string | null;
  createdAt: string;
  expiresAt: string;
  latestPipelineId?: number;
  latestPipelineStatus?: string;
}

