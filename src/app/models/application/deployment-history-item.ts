export interface DeploymentHistoryItem {
  environmentId: string;
  environmentName: string;
  gitBranch: string;
  pipelineId: number | null;
  pipelineStatus: string;
  shortSha?: string | null;
  commitMessage?: string | null;
  createdAt: string;
  finishedAt: string | null;
  triggeredByUsername: string | null;
}

