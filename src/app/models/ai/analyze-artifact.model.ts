export interface AnalyzeArtifactRequest {
  artifactContent: string;
  artifactSource?: string;
}

export interface VulnerabilityItem {
  title: string;
  severity: string;
  location: string;
  description: string;
  remediation: string;
}

export interface AnalyzeArtifactResponse {
  summary: string;
  vulnerabilities: VulnerabilityItem[];
}
