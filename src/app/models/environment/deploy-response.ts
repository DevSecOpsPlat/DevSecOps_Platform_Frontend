export interface DeployResponse {
  environmentId: string;
  environmentName: string;
  gitlabPipelineId: number;
  pipelineStatus: string;
  pipelineWebUrl: string;
  message: string;
}
