export interface DeployRequest {
  gitRepositoryUrl: string;
  branch: string;
  sessionDurationHours: number;
  githubToken?: string;
}
