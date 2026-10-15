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
  /** Obligatoire FRONTEND/BACKEND (≥1024). Absent / undefined pour WORKER. */
  exposedPort?: number;
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
  /** Durcissement conteneur optionnel (runAsNonRoot + readOnlyRootFilesystem) — désactivé par défaut. */
  hardenedSecurityContext?: boolean;
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
  /** Branche Git (env éphémère lié). */
  gitBranch?: string | null;
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
  /** Origine : pod | k8s-event | … */
  kind?: string | null;
  reason?: string | null;
  object?: string | null;
  count?: number | null;
  lastTimestamp?: string | null;
  type?: string;
  status?: string;
  createdAt?: string;
  id?: string;
  /** Namespace d'origine — présent sur l'historique cross-environnements. */
  namespace?: string | null;
  deploymentId?: string | null;
}

export interface DeploymentAlertsResponse {
  live: DeploymentMonitorAlert[];
  history: DeploymentMonitorAlert[];
  liveCount: number;
  historyCount: number;
  health?: DeploymentMonitoringResponse['health'];
  summary?: DeploymentMonitoringResponse['summary'];
  appUrl?: string | null;
  events?: MonitoringEvent[];
  liveError?: string;
}

/** Temps-machine cumulé (approximatif) — proxy de coût, pas une facturation exacte. */
export interface MachineTimeUsage {
  totalHours: number;
  deploymentCount: number;
  byDeployment: Array<{
    deploymentId: string;
    namespace: string;
    status: string;
    readyAt: string;
    stillRunning: boolean;
    hours: number;
  }>;
}

/** Historique des alertes appli, tous environnements, filtré par date/namespace. */
export interface AppAlertsHistoryResponse {
  history: DeploymentMonitorAlert[];
  historyCount: number;
  /** Namespaces distincts trouvés dans la plage — alimente le filtre environnement. */
  namespaces: string[];
  from?: string | null;
  to?: string | null;
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
  networkPolicy?: NetworkPolicyInfo;
  clusterCapacity?: ClusterCapacityInfo;
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

/** Isolation réseau du namespace (NetworkPolicy "default-isolation") — active par défaut au déploiement, relue ici pour la vérifier après coup plutôt que de la supposer. */
export interface NetworkPolicyInfo {
  active: boolean;
  name?: string;
  policyTypes?: string[];
  ingressRuleCount?: number;
  message?: string;
}

/** Capacité réelle du/des nœud(s) K8s — allocatable moins l'utilisation de tous les namespaces. */
export interface ClusterCapacityInfo {
  enabled: boolean;
  allocatableCpuCores?: number;
  allocatableMemoryBytes?: number;
  usedCpuCores?: number;
  usedMemoryBytes?: number;
  /** Agrégat (somme de tous les nœuds) — informatif, pas fiable pour "est-ce que ça va tenir ?". */
  availableCpuCores?: number;
  availableMemoryBytes?: number;
  /** Le nœud le plus disponible — c'est ce chiffre qui répond à "un pod peut-il être planifié ?". */
  maxAvailableCpuCores?: number;
  maxAvailableMemoryBytes?: number;
  /** Disque réel du nœud (équivalent df), lu via le nœud kubelet — pas une valeur de quota. */
  allocatableDiskBytes?: number;
  usedDiskBytes?: number;
  availableDiskBytes?: number;
  maxAvailableDiskBytes?: number;
  nodeCount?: number;
  nodes?: NodeCapacityInfo[];
  message?: string;
}

export interface NodeCapacityInfo {
  name: string;
  ready: boolean;
  /** Conditions K8s au-delà de Ready — cause fréquente de scheduling bloqué (ex. §8 du 18 août 2026). */
  diskPressure?: boolean;
  memoryPressure?: boolean;
  pidPressure?: boolean;
  allocatableCpuCores: number;
  allocatableMemoryBytes: number;
  /** Somme des requests planifiées (réservé) — pas l'usage réel, voir real*UsageCores/Bytes. */
  usedCpuCores: number;
  usedMemoryBytes: number;
  availableCpuCores: number;
  availableMemoryBytes: number;
  /** Usage RÉEL (kubelet /stats/summary) — ce qui tourne vraiment, distinct des requests ci-dessus. */
  realCpuUsageCores?: number;
  realMemoryUsageBytes?: number;
  allocatableDiskBytes?: number;
  usedDiskBytes?: number;
  availableDiskBytes?: number;
  podCount?: number;
  podCapacity?: number;
  role?: 'control-plane' | 'worker';
  createdAt?: string;
  kubeletVersion?: string;
  osImage?: string;
  architecture?: string;
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

/** Corps de requête déploiement managé. */
export interface ManagedDeployRequest {
  branch?: string;
  sessionDurationHours?: number;
  serviceIds?: string[];
}

/** Aperçu infos / warnings avant déploiement. */
export interface DeployPreview {
  infos: string[];
  warnings: string[];
  blockingErrors: string[];
  requiresConfirmation: boolean;
  ttlHours: number;
  selectedServiceCount: number;
  selectedDatabaseCount: number;
  resolvedServiceIds: string[];
  /** Empreinte ressources demandée vs quota namespace. */
  quotaEnabled?: boolean;
  requestedCpuMillicores?: number;
  requestedMemoryBytes?: number;
  quotaCpuMillicores?: number;
  quotaMemoryBytes?: number;

  /** Capacité réelle du nœud K8s (allocatable - déjà utilisé par tous les namespaces). */
  nodeCapacityEnabled?: boolean;
  nodeAvailableCpuMillicores?: number;
  nodeAllocatableCpuMillicores?: number;
  nodeAvailableMemoryBytes?: number;
  nodeAllocatableMemoryBytes?: number;
}

/** Stats légères affichées sur une carte service. */
export interface ServiceCardStats {
  scanCount: number;
  deployCount: number;
  lastScanAt: string | null;
  loading: boolean;
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

/** Posture sécurité application (dernier lot COMPLETE + rollup DefectDojo). */
export interface SecurityPostureResponse {
  managedApplicationId: string;
  hasCompleteBatch: boolean;
  /** PENDING | RUNNING | PARTIAL | COMPLETE | FAILED */
  batchStatus?: string;
  batchId?: string;
  batchFinishedAt?: string;
  batchCreatedAt?: string;
  verdict?: string;
  securityScore?: number | null;
  grade?: string | null;
  gitlabPipelineId?: number;
  expectedServiceCount?: number;
  finishedServiceCount?: number;
  obsolete: boolean;
  obsoleteServices?: ObsoleteServicePosture[];
  message?: string;
  bySeverity?: Record<string, number>;
  topBlockingFindings?: TopBlockingFinding[];
  dimensioningService?: DimensioningServicePosture | null;
  services?: ServicePostureSummary[];
  qualityGates?: QualityGateItem[];
}

export interface QualityGateItem {
  id: string;
  label: string;
  /** PASS | FAIL | UNKNOWN | WARN */
  status: string;
  message?: string;
  scope?: string;
}

export interface ObsoleteServicePosture {
  serviceId: string;
  serviceName?: string;
  gitBranch?: string;
  scannedCommitSha?: string;
  headCommitSha?: string;
}

export interface TopBlockingFinding {
  findingId: number;
  title?: string;
  severity?: string;
  serviceId?: string;
  serviceName?: string;
  scanType?: string;
  filePath?: string;
  cve?: string;
}

export interface DimensioningServicePosture {
  serviceId?: string;
  serviceName?: string;
  serviceRole?: string;
  publiclyExposed?: boolean;
  securityScore?: number;
  grade?: string;
  adjustedScoreForSelection?: number;
}

export interface ServicePostureSummary {
  serviceId: string;
  serviceName?: string;
  serviceRole?: string;
  verdict?: string;
  securityScore?: number | null;
  grade?: string | null;
  bySeverity?: Record<string, number>;
  hardGateViolated?: boolean;
  indeterminate?: boolean;
  hardGateIds?: string[];
  indeterminateSources?: string[];
}

export interface ScanBatchServiceState {
  pipelineExecutionId?: string;
  serviceId?: string;
  serviceName?: string;
  serviceRole?: string;
  gitBranch?: string;
  commitSha?: string;
  status?: string;
  finished?: boolean;
  qualityGateJson?: Record<string, unknown>;
  /** Checklist déjà calculée côté backend -- ne plus la réimplémenter côté frontend. */
  qualityGates?: QualityGateItem[];
}

export interface ScanBatchState {
  batchId: string;
  id?: string;
  managedApplicationId?: string;
  status: string;
  gitlabPipelineId?: number | null;
  triggeredByUserId?: string | null;
  verdict?: string;
  securityScore?: number | null;
  grade?: string | null;
  expectedServiceCount?: number;
  finishedServiceCount?: number;
  createdAt?: string;
  finishedAt?: string;
  services?: ScanBatchServiceState[];
  verdictPayload?: Record<string, unknown>;
  /** Checklist app-level déjà calculée côté backend (voir ManagedAppScanService.extractQualityGates). */
  qualityGates?: QualityGateItem[];
}
