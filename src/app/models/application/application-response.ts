export interface ApplicationResponse {
  id: string;
  name: string;
  description?: string;
  gitRepositoryUrl: string;
  dockerfilePath?: string;
  createdAt: string;
  createdByUsername: string;
  hasGithubToken: boolean;
}

