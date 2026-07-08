import { PipelineJobInfo } from "../pipeline/pipeline-scan-response";
export interface DeploymentHistoryItem {
  environmentId: string;
  environmentName: string;
  gitBranch: string;
  pipelineId: number | null;
  pipelineStatus: string;
  environmentStatus: string;
  statusReason?: string | null;
  terminatedAt?: string | null;
  /** URL publique après déploiement (uniquement si RUNNING) */
  deploymentUrl?: string | null;
  ttlHours: number;      
  expiresAt: string;  
  shortSha?: string | null;
  commitMessage?: string | null;
  createdAt: string;
  finishedAt: string | null;
  triggeredByUsername: string | null;
  jobs?: PipelineJobInfo[]; 
}

