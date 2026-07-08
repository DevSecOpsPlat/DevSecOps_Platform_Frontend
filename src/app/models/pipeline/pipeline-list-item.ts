import { PipelineJobInfo } from './pipeline-scan-response';

export interface PipelineListItem {
  applicationId?: string | null;
  serviceName?: string | null;
  environmentId?: string | null;
  environmentName?: string | null;
  gitBranch: string;
  executionKind?: 'SCAN' | 'DEPLOY' | string;
  pipelineId: number | null;
  pipelineStatus: string;
  createdAt: string;
  finishedAt: string | null;
  createdByUsername: string | null;
  status?: string;
  webUrl?: string;
  ref?: string;
  shortSha?: string;
  duration?: number;
  jobs?: PipelineJobInfo[];
}
