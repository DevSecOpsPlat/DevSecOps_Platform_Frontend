import { PipelineJobInfo } from './pipeline-scan-response';

export interface PipelineListItem {
  environmentId: string;
  environmentName: string;
  gitBranch: string;
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
