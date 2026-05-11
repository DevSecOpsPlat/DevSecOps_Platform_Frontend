// src/app/models/dashboard/dashboard.models.ts


export interface ActivityItem {
  id: string;
  type: 'deployment' | 'environment' | 'pipeline';
  title: string;
  description: string;
  timestamp: string;
  status: string;
  icon: string;
  link?: string;
  /** URL publique pour visiter l’app (environnement RUNNING avec preview). */
  previewUrl?: string | null;
}

export interface DashboardPipelineItem {
  id: number | null;
  name: string;
  branch: string;
  status: string;
  createdAt: string;
  environmentId: string;
  environmentName: string;
  triggeredBy?: string;
}

export interface DashboardEnvironmentItem {
  id: string;
  name: string;
  appName: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  branch: string;
  timeRemaining?: string;
}

export interface DashboardVulnerabilityItem {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  component: string;
  version: string;
  fixedVersion?: string;
  description?: string;
  score?: number;
  createdAt: string;
}