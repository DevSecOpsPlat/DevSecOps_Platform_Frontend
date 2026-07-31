// Modèles du module de gestion des applications managées (services + bases + déploiement K8s).
// N'altère aucun modèle existant.

export type AppServiceRole = 'FRONTEND' | 'BACKEND' | 'WORKER';
export type DbFamily = 'SQL' | 'NOSQL';
export type DbEngine =
  | 'MARIADB'
  | 'POSTGRES'
  | 'MYSQL'
  | 'MONGODB'
  | 'REDIS'
  | 'CASSANDRA';
export type AppDeploymentStatus =
  | 'PENDING'
  | 'DEPLOYING'
  | 'RUNNING'
  | 'FAILED'
  | 'STOPPED';

/** Valeur de masquage renvoyée par le backend pour les secrets. */
export const SECRET_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022';

export interface EnvVar {
  id?: string;
  varKey: string;
  varValue?: string;
  isSecret: boolean;
}

export interface AppServiceModel {
  id?: string;
  name: string;
  role: AppServiceRole;
  gitRepositoryUrl: string;
  gitToken?: string;
  hasGitToken?: boolean;
  gitBranch?: string;
  dockerfilePath?: string;
  buildContext?: string;
  exposedPort: number;
  dependsOnServiceId?: string | null;
  dependsOnDatabaseId?: string | null;
  dbUrlEnvVar?: string;
  replicas?: number;
    healthCheckPath?: string;
  /** Chemin métier interne (ex. /projet). Public: /api → réécrit vers ce chemin. */
  contextPath?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
  envVars?: EnvVar[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AppDatabaseModel {
  id?: string;
  name: string;
  dbFamily: DbFamily;
  engine: DbEngine;
  version: string;
  dbName: string;
  rootUser: string;
  rootPassword?: string;
  hasRootPassword?: boolean;
  exposedPort?: number;
  storageSize?: string;
  generatedConnectionUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppDeployment {
  id: string;
  namespace: string;
  status: AppDeploymentStatus;
  gitlabPipelineId?: number;
  deployedAt?: string;
  servicesState?: any;
  createdAt?: string;
  updatedAt?: string;
  databases?: AppDatabaseModel[];
  /** TTL heures (env éphémère). */
  ttlHours?: number | null;
  /** Expiration serveur (ISO). */
  expiresAt?: string | null;
  /** Ready serveur (début TTL). */
  readyAt?: string | null;
  /** Horloge serveur pour sync countdown. */
  serverTime?: string | null;
  /** Secondes restantes (serveur). */
  remainingSeconds?: number | null;
}

/** Résultat sync env → cluster RUNNING (sans rebuild CI). */
export interface RuntimeSyncResult {
  synced: boolean;
  namespaces?: string[];
  restartedServices?: string[];
  message?: string;
}

/** Résultat nettoyage cluster après suppression service/base. */
export interface ClusterPruneResult {
  pruned: boolean;
  namespaces?: string[];
  removedResources?: string[];
  message?: string;
}

export interface DeploymentPodInfo {
  name: string;
  workload?: string | null;
  phase: string;
  ready: boolean;
  restarts: number;
  reason?: string | null;
  node?: string | null;
  startTime?: string | null;
  createdAt?: string | null;
  cpuRequest?: string | null;
  cpuLimit?: string | null;
  memoryRequest?: string | null;
  memoryLimit?: string | null;
  cpuUsage?: string | null;
  memoryUsage?: string | null;
  cpuUsageCores?: number | null;
  /** Millicores précis (ex: 1.37) — pour charts même si très petit. */
  cpuUsageMillicores?: number | null;
  memoryUsageBytes?: number | null;
  networkRxBytes?: number | null;
  networkTxBytes?: number | null;
  networkRx?: string | null;
  networkTx?: string | null;
  fsUsedBytes?: number | null;
  fsCapacityBytes?: number | null;
  fsUsed?: string | null;
  fsCapacity?: string | null;
}

export interface DeploymentMonitorAlert {
  severity: 'error' | 'warn' | string;
  pod?: string | null;
  workload?: string | null;
  message: string;
  source?: 'live' | 'history' | string;
  type?: string;
  status?: string;
  createdAt?: string;
  id?: string;
}

export interface DeploymentAlertsResponse {
  live: DeploymentMonitorAlert[];
  history: DeploymentMonitorAlert[];
  liveCount: number;
  historyCount: number;
  health?: DeploymentMonitoringResponse['health'];
  summary?: DeploymentMonitoringResponse['summary'];
  liveError?: string;
}

export interface MonitoringWorkload {
  kind: string;
  name: string;
  desired: number;
  ready: number;
  available?: number;
  updated?: number;
  healthy: boolean;
}

export interface MonitoringServiceInfo {
  name: string;
  type: string;
  clusterIP?: string | null;
  ports: string[];
}

export interface MonitoringEvent {
  type?: string | null;
  reason?: string | null;
  message?: string | null;
  count?: number | null;
  object?: string | null;
  lastTimestamp?: string | null;
}

export interface DeploymentMonitoringResponse {
  namespace: string;
  deploymentId: string;
  status: AppDeploymentStatus;
  checkedAt?: string;
  applicationName?: string;
  applicationSlug?: string;
  expiresAt?: string | null;
  appUrl?: string | null;
  pods: DeploymentPodInfo[];
  workloads?: MonitoringWorkload[];
  services?: MonitoringServiceInfo[];
  events?: MonitoringEvent[];
  alerts: DeploymentMonitorAlert[];
  quota?: DeploymentQuotaInfo;
  summary?: {
    totalPods: number;
    readyPods: number;
    alertCount: number;
    metricsAvailable: boolean;
    workloadCount?: number;
    serviceCount?: number;
    totalCpuCores?: number;
    totalCpuMillicores?: number;
    totalMemoryBytes?: number;
    totalMemoryMi?: number;
    totalNetworkRxBytes?: number;
    totalNetworkTxBytes?: number;
    totalFsUsedBytes?: number;
    totalNetworkRx?: string;
    totalNetworkTx?: string;
    totalFsUsed?: string;
  };
  health?: {
    checked: boolean;
    ok?: boolean | null;
    url?: string | null;
    statusCode?: number | null;
    probedUrl?: string | null;
    message?: string;
  };
  message?: string;
}

export interface DeploymentQuotaInfo {
  enabled: boolean;
  name?: string;
  hard?: Record<string, string>;
  used?: Record<string, string>;
  pctAllocated?: { cpu?: number | null; memory?: number | null };
  pctActualVsHard?: { cpu?: number | null; memory?: number | null };
  hardCpu?: number | null;
  hardMemoryBytes?: number | null;
  usedCpu?: number | null;
  usedMemoryBytes?: number | null;
  usage?: { cpuCores?: number | null; memoryBytes?: number | null };
  message?: string;
}

export interface MetricsHistoryPoint {
  t: string;
  cpuMilli?: number | null;
  memBytes?: number | null;
  memMi?: number | null;
  netRx?: number | null;
  netTx?: number | null;
  fsUsed?: number | null;
  readyPods?: number | null;
  totalPods?: number | null;
}

export interface MetricsHistoryResponse {
  deploymentId: string;
  applicationId: string;
  from: string;
  to: string;
  retentionDays: number;
  points: MetricsHistoryPoint[];
  count: number;
}

export interface DeploymentPodsResponse {
  namespace: string;
  deploymentId: string;
  status: AppDeploymentStatus;
  pods: DeploymentPodInfo[];
}

export interface DeploymentLogsResponse {
  namespace: string;
  pod: string;
  workload: string;
  tailLines: number;
  logs: string;
}

export interface ManagedApp {
  id: string;
  name: string;
  slug: string;
  description?: string;
  /** Hostname Ingress custom (ex. demo.example.com). */
  customHostname?: string | null;
  createdByUsername?: string;
  createdAt?: string;
  updatedAt?: string;
  services: AppServiceModel[];
  databases: AppDatabaseModel[];
  lastDeployment?: AppDeployment | null;
  warnings?: string[];
}

/** Ports par défaut par moteur (pré-remplissage du formulaire). */
export const DEFAULT_DB_PORTS: Record<DbEngine, number> = {
  MARIADB: 3306,
  MYSQL: 3306,
  POSTGRES: 5432,
  MONGODB: 27017,
  REDIS: 6379,
  CASSANDRA: 9042
};

/** Moteurs disponibles selon la famille (select dynamique). */
export const ENGINES_BY_FAMILY: Record<DbFamily, DbEngine[]> = {
  SQL: ['MARIADB', 'POSTGRES', 'MYSQL'],
  NOSQL: ['MONGODB', 'REDIS', 'CASSANDRA']
};
