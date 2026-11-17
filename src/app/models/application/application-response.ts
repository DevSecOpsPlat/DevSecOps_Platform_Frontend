export interface ApplicationResponse {
  id: string;
  name: string;
  description?: string;
  gitRepositoryUrl: string;
  dockerfilePath?: string;
  /** Branche de travail du service (scan / déploiement par défaut). */
  gitBranch?: string;
  createdAt: string;
  createdByUsername: string;
  hasGithubToken: boolean;
}

