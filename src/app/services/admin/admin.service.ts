import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { UserService } from '../user/user.service';
import { ClusterCapacityInfo, DeploymentMonitoringResponse } from '../../models/application-management/application-management.models';

/** Miroir de DataProtectionService.getProtectionSummary() (backend). */
export interface DataProtectionSummary {
  inTransit: {
    protocol: string;
    description: string;
    termination: string;
    hstsEnabled: boolean;
    requireHttpsEnforced: boolean;
    headers: string[];
  };
  atRest: {
    algorithm: string;
    keySource: string;
    productionKeyConfigured: boolean;
    encryptedFields: { table: string; column: string; label: string }[];
    databaseNote: string;
  };
  ephemeralSecrets: {
    otpEmailCodes: string;
    jwtAccessToken: string;
  };
  complianceNote: string;
}

export interface AdminCreateUserPayload {
  username: string;
  email: string;
  role?: 'ROLE_TESTER';
}

export interface AdminCreateUserResponse {
  id: string;
  username: string;
  email: string;
  roles: string[];
  accountStatus: string;
  activationEmailSent?: boolean;
  message?: string;
  activationLink?: string;
}

export interface AdminPipelineCounts {
  success: number;
  failed: number;
  running: number;
  pending: number;
  canceled: number;
  skipped: number;
  total?: number;
}

export interface AdminEnvironmentStatusBreakdown {
  pending: number;
  building: number;
  running: number;
  failed: number;
  destroyed: number;
  expired: number;
  total?: number;
}

export interface AdminAppServiceSummary {
  id: string;
  name: string;
  role?: string | null;
  gitRepositoryUrl: string;
  gitBranch?: string | null;
}

/**
 * Une ligne "Application" : soit une vraie application multi-services (`standalone: false`,
 * `services.length` peut être > 1), soit un service autonome sans application parente
 * (`standalone: true`, `services.length === 1`) — cf. docs/audit-dashboard-admin.md §0.
 */
export interface AdminUserApplicationDetail {
  id: string;
  name: string;
  description?: string | null;
  gitRepositoryUrl: string;
  createdAt: string | number[];
  linkedEnvironmentsCount: number;
  pipelineCounts: AdminPipelineCounts;
  standalone: boolean;
  services: AdminAppServiceSummary[];
  databasesCount: number;
}

export interface AdminUserEnvironmentDetail {
  id: string;
  applicationId: string;
  applicationName: string;
  environmentName: string;
  /** Namespace K8s réel — permet d'appeler getMonitoringNamespaceDetail(namespace) directement. */
  namespace?: string | null;
  gitBranch: string;
  status: string;
  url?: string | null;
  ttlHours: number;
  createdAt: string | number[];
  expiresAt: string | number[];
  gitlabPipelineId?: number | null;
  pipelineStatus?: string | null;
  pipelineStartedAt?: string | number[] | null;
  pipelineFinishedAt?: string | number[] | null;
}

export interface AdminUserMetrics {
  id: string;
  username: string;
  email: string;
  roles: string[];
  accountStatus: string;
  createdAt: string | number[];
  updatedAt?: string | number[] | null;
  lastLoginAt?: string | number[] | null;
  lastPasswordChangedAt?: string | number[] | null;
  recentFailedAttempts?: number;
  activeEnvironmentsCount: number;
  pipelinesCount: number;
  applicationsCount: number;
  pipelineCounts: AdminPipelineCounts;
  environmentStatusBreakdown: AdminEnvironmentStatusBreakdown;
  applications: AdminUserApplicationDetail[];
  environments: AdminUserEnvironmentDetail[];
}

/**
 * Un événement du fil d'activité admin fusionné (pipelines + alertes + activité de compte) —
 * miroir de AdminActivityEvent (backend). `kind`/`eventType` sont bruts : les libellés affichés
 * sont construits côté frontend (cf. admin-activity-timeline).
 */
export interface AdminActivityEvent {
  id: string;
  kind: 'PIPELINE' | 'ALERT' | 'ACCOUNT';
  eventType: string;
  message?: string | null;
  actorUsername?: string | null;
  applicationId?: string | null;
  applicationName?: string | null;
  environmentId?: string | null;
  environmentName?: string | null;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  occurredAt: string | number[];
}

export interface AdminUserActivityEntry {
  id: string;
  action: string;
  detail?: string | null;
  performedBy?: string | null;
  createdAt: string | number[];
}

export interface AdminComplaintMessage {
  id: string;
  authorUsername?: string | null;
  fromAdmin: boolean;
  body: string;
  createdAt?: string | null;
}

export interface AdminComplaintThread {
  id: string;
  authorUsername?: string | null;
  authorEmail?: string | null;
  subject: string;
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  messages: AdminComplaintMessage[];
}

export interface AdminLoginDayStats {
  date: string;
  success: number;
  failed: number;
}

export interface AdminSecurityAttempt {
  attemptedAt: string | number[];
  ipAddress?: string | null;
}

export interface AdminSecurityAlert {
  userId: string;
  username: string;
  email: string;
  failedCount: number;
  attempts: AdminSecurityAttempt[];
}

export interface AdminUsersDashboardStats {
  totalFailedAttempts: number;
  loginStatsLast30Days: AdminLoginDayStats[];
  securityAlerts: AdminSecurityAlert[];
  failedAttemptsDetail: AdminFailedLoginEntry[];
}

export interface AdminFailedLoginEntry {
  userId: string;
  username: string;
  email: string;
  attemptedAt: string | number[];
  ipAddress?: string | null;
}

const BASE = environment.BASE_URL + 'api/admin/';

@Injectable({
  providedIn: 'root'
})
export class AdminService {

  constructor(private http: HttpClient, private userService: UserService) {}

  private authHeaders(): HttpHeaders {
    const token = this.userService.getToken();
    return new HttpHeaders({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    });
  }

  createUser(payload: AdminCreateUserPayload): Observable<AdminCreateUserResponse> {
    return this.http.post<AdminCreateUserResponse>(BASE + 'users', payload, { headers: this.authHeaders() });
  }

  getAllUsersWithMetrics(): Observable<AdminUserMetrics[]> {
    return this.http.get<AdminUserMetrics[]>(BASE + 'users', { headers: this.authHeaders() });
  }

  getUsersDashboardStats(): Observable<AdminUsersDashboardStats> {
    return this.http.get<AdminUsersDashboardStats>(BASE + 'users/dashboard-stats', { headers: this.authHeaders() });
  }

  getUserById(id: string): Observable<AdminUserMetrics> {
    return this.http.get<AdminUserMetrics>(BASE + `users/${id}`, { headers: this.authHeaders() });
  }

  getUserActivity(id: string): Observable<AdminUserActivityEntry[]> {
    return this.http.get<AdminUserActivityEntry[]>(BASE + `users/${id}/activity`, { headers: this.authHeaders() });
  }

  getUserComplaints(id: string): Observable<AdminComplaintThread[]> {
    return this.http.get<AdminComplaintThread[]>(BASE + `users/${id}/complaints`, { headers: this.authHeaders() });
  }

  resetUserPassword(id: string, newPassword: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>(
      BASE + `users/${id}/password`,
      { newPassword },
      { headers: this.authHeaders() }
    );
  }

  updateUserEmail(id: string, email: string): Observable<AdminUserMetrics> {
    return this.http.patch<AdminUserMetrics>(
      BASE + `users/${id}/email`,
      { email },
      { headers: this.authHeaders() }
    );
  }

  setUserStatus(id: string, active: boolean): Observable<AdminUserMetrics> {
    return this.http.patch<AdminUserMetrics>(
      BASE + `users/${id}/status`,
      { active },
      { headers: this.authHeaders() }
    );
  }

  deleteUser(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(BASE + `users/${id}`, { headers: this.authHeaders() });
  }

  /* ——— Alertes sécurité ——— */

  getAlerts(status?: string, type?: string): Observable<AdminAlert[]> {
    const params: string[] = [];
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    if (type) params.push(`type=${encodeURIComponent(type)}`);
    const q = params.length ? '?' + params.join('&') : '';
    return this.http.get<AdminAlert[]>(BASE + 'alerts' + q, { headers: this.authHeaders() });
  }

  getAlertsPage(
    page = 0,
    size = 20,
    status?: string,
    type?: string,
    ip?: string,
    from?: string,
    to?: string
  ): Observable<AdminAlertPage> {
    const params: string[] = [`page=${page}`, `size=${size}`];
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    if (type) params.push(`type=${encodeURIComponent(type)}`);
    if (ip?.trim()) params.push(`ip=${encodeURIComponent(ip.trim())}`);
    if (from) params.push(`from=${encodeURIComponent(from)}`);
    if (to) params.push(`to=${encodeURIComponent(to)}`);
    return this.http.get<AdminAlertPage>(BASE + 'alerts?' + params.join('&'), { headers: this.authHeaders() });
  }

  getSecurityDashboard(): Observable<AdminSecurityDashboard> {
    return this.http.get<AdminSecurityDashboard>(BASE + 'alerts/dashboard', { headers: this.authHeaders() });
  }

  getAlertById(id: string): Observable<AdminAlert> {
    return this.http.get<AdminAlert>(BASE + `alerts/${id}`, { headers: this.authHeaders() });
  }

  getAlertStats(): Observable<AdminAlertStats> {
    return this.http.get<AdminAlertStats>(BASE + 'alerts/stats', { headers: this.authHeaders() });
  }

  getUnreadAlertCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(BASE + 'alerts/unread-count', { headers: this.authHeaders() });
  }

  markAlertRead(id: string): Observable<AdminAlert> {
    return this.http.patch<AdminAlert>(BASE + `alerts/${id}/read`, {}, { headers: this.authHeaders() });
  }

  deleteAlert(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(BASE + `alerts/${id}`, { headers: this.authHeaders() });
  }

  getBlockedIps(): Observable<BlockedIpEntry[]> {
    return this.http.get<BlockedIpEntry[]>(BASE + 'security/blocked-ips', { headers: this.authHeaders() });
  }

  unblockIp(ip: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      BASE + `security/blocked-ips/${encodeURIComponent(ip)}`,
      { headers: this.authHeaders() }
    );
  }

  blockIp(ip: string, reason?: string, minutes?: number): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      BASE + 'security/blocked-ips',
      { ip, reason, minutes },
      { headers: this.authHeaders() }
    );
  }

  /** Résumé chiffrement transit/repos + secrets jamais persistés (DataProtectionService). */
  getDataProtection(): Observable<DataProtectionSummary> {
    return this.http.get<DataProtectionSummary>(BASE + 'security/data-protection', { headers: this.authHeaders() });
  }

  getAuditLog(
    page = 0,
    size = 50,
    userId?: string,
    action?: string,
    search?: string,
    from?: string,
    to?: string,
    severity?: string,
    performedBy?: string,
    timeFrom?: string,
    timeTo?: string,
    loginOutcome?: string
  ): Observable<AdminAuditPage> {
    const params: string[] = [`page=${page}`, `size=${size}`];
    if (userId) params.push(`userId=${encodeURIComponent(userId)}`);
    if (action) params.push(`action=${encodeURIComponent(action)}`);
    if (search?.trim()) params.push(`search=${encodeURIComponent(search.trim())}`);
    if (from) params.push(`from=${encodeURIComponent(from)}`);
    if (to) params.push(`to=${encodeURIComponent(to)}`);
    if (severity) params.push(`severity=${encodeURIComponent(severity)}`);
    if (performedBy?.trim()) params.push(`performedBy=${encodeURIComponent(performedBy.trim())}`);
    if (timeFrom) params.push(`timeFrom=${encodeURIComponent(timeFrom)}`);
    if (timeTo) params.push(`timeTo=${encodeURIComponent(timeTo)}`);
    if (loginOutcome) params.push(`loginOutcome=${encodeURIComponent(loginOutcome)}`);
    return this.http.get<AdminAuditPage>(BASE + 'audit-log?' + params.join('&'), { headers: this.authHeaders() });
  }

  getAuditDashboard(): Observable<AdminAuditDashboard> {
    return this.http.get<AdminAuditDashboard>(BASE + 'audit-log/dashboard', { headers: this.authHeaders() });
  }

  getAuditTopUsers(limit = 5): Observable<AdminAuditTopUser[]> {
    return this.http.get<AdminAuditTopUser[]>(BASE + `audit-log/top-users?limit=${limit}`, { headers: this.authHeaders() });
  }

  getAuditLoginComparison(hours = 24): Observable<AdminAuditLoginHourPoint[]> {
    return this.http.get<AdminAuditLoginHourPoint[]>(BASE + `audit-log/login-comparison?hours=${hours}`, { headers: this.authHeaders() });
  }

  getAuditAdminVsUsers(): Observable<AdminAuditAdminVsUsers> {
    return this.http.get<AdminAuditAdminVsUsers>(BASE + 'audit-log/admin-vs-users', { headers: this.authHeaders() });
  }

  getAuditSuspiciousIps(): Observable<AdminAuditSuspiciousIp[]> {
    return this.http.get<AdminAuditSuspiciousIp[]>(BASE + 'audit-log/suspicious-ips', { headers: this.authHeaders() });
  }

  getAuditStats(): Observable<AdminAuditStats> {
    return this.http.get<AdminAuditStats>(BASE + 'audit-log/stats', { headers: this.authHeaders() });
  }

  getAuditAnalytics(): Observable<AdminAuditAnalytics> {
    return this.http.get<AdminAuditAnalytics>(BASE + 'audit-log/analytics', { headers: this.authHeaders() });
  }

  // ---------- Monitoring cluster-wide (console admin, 18 août 2026) ----------

  /** Capacité de tous les nœuds du cluster (CPU/MEM/disque) — même donnée que le garde-fou de déploiement. */
  getMonitoringNodes(): Observable<ClusterCapacityInfo> {
    return this.http.get<ClusterCapacityInfo>(BASE + 'monitoring/nodes', { headers: this.authHeaders() });
  }

  /** Résumé (une ligne par environnement RUNNING, tous utilisateurs) — pods, alertes, propriétaire. */
  getMonitoringNamespaces(): Observable<AdminNamespaceSummary[]> {
    return this.http.get<AdminNamespaceSummary[]>(BASE + 'monitoring/namespaces', { headers: this.authHeaders() });
  }

  /** Détail complet d'un namespace (au clic depuis le résumé) — même forme que le monitoring utilisateur. */
  getMonitoringNamespaceDetail(namespace: string): Observable<DeploymentMonitoringResponse & { appName?: string; ownerUsername?: string }> {
    return this.http.get<DeploymentMonitoringResponse & { appName?: string; ownerUsername?: string }>(
      BASE + `monitoring/namespaces/${encodeURIComponent(namespace)}`,
      { headers: this.authHeaders() }
    );
  }

  // ---------- Fil d'activité admin (refonte dashboard, Phase 1) ----------

  /** Événements récents fusionnés (pipelines + alertes + activité de compte), globaux ou filtrés
   * par application/environnement/utilisateur — alimente admin-activity-timeline. */
  getActivity(opts?: { limit?: number; applicationId?: string; environmentId?: string; userId?: string }): Observable<AdminActivityEvent[]> {
    let params = '';
    if (opts) {
      const parts: string[] = [];
      if (opts.limit != null) parts.push(`limit=${opts.limit}`);
      if (opts.applicationId) parts.push(`applicationId=${encodeURIComponent(opts.applicationId)}`);
      if (opts.environmentId) parts.push(`environmentId=${encodeURIComponent(opts.environmentId)}`);
      if (opts.userId) parts.push(`userId=${encodeURIComponent(opts.userId)}`);
      if (parts.length) params = '?' + parts.join('&');
    }
    return this.http.get<AdminActivityEvent[]>(BASE + 'activity' + params, { headers: this.authHeaders() });
  }
}

export interface AdminNamespaceSummary {
  namespace: string;
  deploymentId: string;
  createdAt?: string;
  appId?: string;
  appName?: string;
  ownerUsername?: string | null;
  /** RUNNING mais plus le dernier déploiement de son appli — invisible dans le portail utilisateur. */
  orphaned: boolean;
  podsReady: number;
  podsTotal: number;
  warningEventCount: number;
  nodes: string[];
  message?: string;
}

export interface AdminAlert {
  id: string;
  type: string;
  message: string;
  status: 'NON_LUE' | 'LUE';
  relatedUserId?: string | null;
  relatedUsername?: string | null;
  ipAddress?: string | null;
  detailsJson?: string | null;
  createdAt: string | number[];
}

export interface AdminAlertPage {
  items: AdminAlert[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface AdminSecurityDashboard {
  kpis: {
    alertsTotal: number;
    blockedIpsActive: number;
    bruteForceTotal: number;
    honeypotTotal: number;
    rateLimitTotal: number;
    xssSqlTotal: number;
    ddosLikeTotal: number;
  };
  kpiPanels: AdminKpiPanel[];
  blockedIps: AdminBlockedIpDetail[];
  hourlyTrend: { hour: string; count: number; tooltip: string }[];
  typeDistribution: { type: string; label: string; count: number; tooltip: string }[];
  topIps: { ip: string; count: number; tooltip: string; lastActivity: string }[];
}

export interface AdminKpiPanel {
  key: string;
  title: string;
  hoverDescription: string;
  count: number;
  countHint: string;
  items: AdminKpiPanelItem[];
}

export interface AdminKpiPanelItem {
  line1: string;
  line2: string;
  line3: string;
  ip?: string | null;
  occurredAt: string | number[];
}

export interface AdminBlockedIpDetail {
  ip: string;
  reason: string;
  source: string;
  currentlyActive: boolean;
  blockedUntil: string | number[];
  createdAt: string | number[];
}

export interface AdminAlertStats {
  unreadCount: number;
  totalCount: number;
  countByType: Record<string, number>;
}

export interface BlockedIpEntry {
  ip: string;
  reason: string;
  blockedUntil: string | number[];
  createdAt?: string | number[];
  source?: string;
  currentlyActive?: boolean;
}

export interface AdminAuditEntry {
  id: string;
  createdAt: string | number[];
  username?: string | null;
  userId?: string | null;
  action: string;
  details?: string | null;
  performedBy?: string | null;
  ipAddress?: string | null;
}

export interface AdminAuditPage {
  items: AdminAuditEntry[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface AdminAuditStats {
  totalCount: number;
  countByAction: Record<string, number>;
}

export interface AdminAuditDayCount {
  date: string;
  count: number;
}

export interface AdminAuditTopActor {
  username: string;
  count: number;
}

export interface AdminAuditAnalytics {
  totalCount: number;
  dailyTrend: AdminAuditDayCount[];
  monthlyTrend: AdminAuditDayCount[];
  allTimeTrend: AdminAuditDayCount[];
  topAdmins: AdminAuditTopActor[];
}

export interface AdminAuditDashboard {
  enhancedKpis: AdminAuditEnhancedKpis;
  topUsers: AdminAuditTopUser[];
  loginComparison: AdminAuditLoginHourPoint[];
  adminVsUsers: AdminAuditAdminVsUsers;
  suspiciousIps: AdminAuditSuspiciousIp[];
  kpiPanels: AdminKpiPanel[];
}

export interface AdminAuditEnhancedKpis {
  loginSuccessRatePercent: number;
  loginSuccessTooltip: string;
  activeUsers24h: number;
  activeUsersTooltip: string;
  adminActionsCount: number;
  adminActionsTooltip: string;
  suspiciousIpsCount: number;
  suspiciousIpsTooltip: string;
}

export interface AdminAuditTopUser {
  username: string;
  count: number;
  tooltip: string;
  lastAction: string;
  lastActionAt: string | number[];
}

export interface AdminAuditLoginHourPoint {
  hour: string;
  success: number;
  failed: number;
  tooltip: string;
}

export interface AdminAuditAdminVsUsers {
  adminActions: number;
  userActions: number;
  adminPercent: number;
  adminTooltip: string;
  userTooltip: string;
}

export interface AdminAuditSuspiciousIp {
  ip: string;
  failureCount: number;
  tooltip: string;
  lastFailureAt: string | number[];
}
