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
}

export interface ManagedApp {
  id: string;
  name: string;
  slug: string;
  description?: string;
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
