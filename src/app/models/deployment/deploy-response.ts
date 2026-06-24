export interface DeployResponse {
  environmentId: string;
  applicationId?: string;
  environmentName: string;
  gitlabPipelineId: number;
  pipelineStatus: string;
  pipelineWebUrl: string;
  message: string;
}
