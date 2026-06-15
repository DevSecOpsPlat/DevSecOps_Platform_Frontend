import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AdminService,
  AdminComplaintThread,
  AdminPipelineCounts,
  AdminUserActivityEntry,
  AdminUserEnvironmentDetail,
  AdminUserMetrics
} from '../../services/admin/admin.service';

@Component({
  selector: 'app-admin-user-detail',
  templateUrl: './admin-user-detail.component.html',
  styleUrls: ['../admin-route-page.css', './admin-user-detail.component.css']
})
export class AdminUserDetailComponent implements OnInit {
  loading = false;
  error: string | null = null;
  user: AdminUserMetrics | null = null;

  activity: AdminUserActivityEntry[] = [];
  activityLoading = false;
  activityError: string | null = null;

  complaints: AdminComplaintThread[] = [];
  complaintsLoading = false;
  complaintsError: string | null = null;
  expandedComplaintId: string | null = null;

  /* Sections repliables (les environnements sont repliés par défaut : listes longues). */
  showApplications = true;
  showEnvironments = false;

  /** Bannière de confirmation après une action admin. */
  actionSuccess: string | null = null;
  actionError: string | null = null;

  /* --- Modal : réinitialisation du mot de passe --- */
  showResetModal = false;
  resetNewPassword = '';
  resetConfirmPassword = '';
  showResetPwd = false;
  resetSaving = false;
  resetError: string | null = null;
  resetSuccess: string | null = null;

  /* --- Modal : modification de l'e-mail --- */
  showEmailModal = false;
  emailValue = '';
  emailSaving = false;
  emailError: string | null = null;

  /* --- Modal : activation / désactivation --- */
  showStatusModal = false;
  statusSaving = false;
  statusError: string | null = null;

  /* --- Modal : suppression --- */
  showDeleteModal = false;
  deleteConfirmText = '';
  deleteSaving = false;
  deleteError: string | null = null;

  private userId = '';

  constructor(
    private adminService: AdminService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      this.userId = params.get('id') ?? '';
      if (this.userId) {
        this.load();
      }
    });
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.adminService.getUserById(this.userId).subscribe({
      next: user => {
        this.user = user;
        this.loading = false;
        this.loadActivity();
        this.loadComplaints();
      },
      error: err => {
        this.loading = false;
        this.error = err?.error?.message || 'Utilisateur introuvable.';
      }
    });
  }

  loadActivity(): void {
    this.activityLoading = true;
    this.activityError = null;
    this.adminService.getUserActivity(this.userId).subscribe({
      next: entries => {
        this.activity = entries ?? [];
        this.activityLoading = false;
      },
      error: err => {
        this.activityLoading = false;
        this.activityError = err?.error?.message || 'Impossible de charger le journal d\'activité.';
      }
    });
  }

  loadComplaints(): void {
    this.complaintsLoading = true;
    this.complaintsError = null;
    this.adminService.getUserComplaints(this.userId).subscribe({
      next: threads => {
        this.complaints = threads ?? [];
        this.complaintsLoading = false;
      },
      error: err => {
        this.complaintsLoading = false;
        this.complaintsError = err?.error?.message || 'Impossible de charger les discussions.';
      }
    });
  }

  backToList(): void {
    this.router.navigate(['/admin/users']);
  }

  toggleApplications(): void {
    this.showApplications = !this.showApplications;
  }

  toggleEnvironments(): void {
    this.showEnvironments = !this.showEnvironments;
  }

  toggleComplaint(id: string): void {
    this.expandedComplaintId = this.expandedComplaintId === id ? null : id;
  }

  complaintStatusLabel(status: string | null | undefined): string {
    const map: Record<string, string> = {
      OPEN: 'Ouverte',
      CLOSED: 'Fermée'
    };
    return map[(status || '').toUpperCase()] || status || '—';
  }

  formatIso(value: string | null | undefined): string {
    if (!value) {
      return '—';
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleString('fr-FR');
  }

  /* --- Graphiques --- */

  /** % de pipelines réussis sur les pipelines terminés (réussis + échoués). */
  get pipelineSuccessRate(): number {
    const c = this.user?.pipelineCounts;
    if (!c) {
      return 0;
    }
    const done = (c.success || 0) + (c.failed || 0);
    return done === 0 ? 0 : Math.round(((c.success || 0) / done) * 100);
  }

  /** Périmètre du donut SVG (rayon 42). */
  readonly donutCircumference = 2 * Math.PI * 42;

  get donutDash(): string {
    const filled = (this.pipelineSuccessRate / 100) * this.donutCircumference;
    return `${filled} ${this.donutCircumference - filled}`;
  }

  /** Répartition des environnements par statut (barres horizontales). */
  get envBars(): { label: string; count: number; pct: number; accent: boolean }[] {
    const b = this.user?.environmentStatusBreakdown;
    if (!b) {
      return [];
    }
    const total = Math.max(1, this.envBreakdownTotal(this.user!));
    const rows = [
      { label: 'Actifs', count: b.running || 0, accent: true },
      { label: 'En attente', count: b.pending || 0, accent: false },
      { label: 'Construction', count: b.building || 0, accent: false },
      { label: 'Échec', count: b.failed || 0, accent: false },
      { label: 'Détruits', count: b.destroyed || 0, accent: false },
      { label: 'Expirés', count: b.expired || 0, accent: false }
    ];
    return rows
      .filter(r => r.count > 0)
      .map(r => ({ ...r, pct: Math.round((r.count / total) * 100) }));
  }

  /* ===== Statut ===== */

  get isActive(): boolean {
    return (this.user?.accountStatus || '').toUpperCase() === 'ACTIVE';
  }

  get statusLower(): string {
    return (this.user?.accountStatus || 'unknown').toLowerCase();
  }

  get statusLabelText(): string {
    return this.isActive ? 'Actif' : 'Désactivé';
  }

  openStatusModal(): void {
    this.statusError = null;
    this.statusSaving = false;
    this.showStatusModal = true;
  }

  closeStatusModal(): void {
    this.showStatusModal = false;
  }

  confirmStatusChange(): void {
    if (!this.user || this.statusSaving) {
      return;
    }
    const targetActive = !this.isActive;
    this.statusSaving = true;
    this.statusError = null;
    this.adminService.setUserStatus(this.user.id, targetActive).subscribe({
      next: updated => {
        this.user = updated;
        this.statusSaving = false;
        this.showStatusModal = false;
        this.flashSuccess(targetActive
          ? 'Compte réactivé : l\'utilisateur peut de nouveau se connecter.'
          : 'Compte désactivé : l\'utilisateur ne peut plus se connecter.');
        this.loadActivity();
      },
      error: err => {
        this.statusSaving = false;
        this.statusError = err?.error?.message || 'Modification du statut impossible.';
      }
    });
  }

  /* ===== Suppression ===== */

  openDeleteModal(): void {
    this.deleteConfirmText = '';
    this.deleteError = null;
    this.deleteSaving = false;
    this.showDeleteModal = true;
  }

  closeDeleteModal(): void {
    this.showDeleteModal = false;
  }

  get canConfirmDelete(): boolean {
    const expected = (this.user?.username ?? '').trim();
    return !this.deleteSaving
      && expected.length > 0
      && this.deleteConfirmText.trim() === expected;
  }

  confirmDelete(): void {
    if (!this.user || !this.canConfirmDelete) {
      return;
    }
    this.deleteSaving = true;
    this.deleteError = null;
    this.adminService.deleteUser(this.user.id).subscribe({
      next: () => {
        this.deleteSaving = false;
        this.showDeleteModal = false;
        this.router.navigate(['/admin/users'], {
          queryParams: { deleted: this.user?.username }
        });
      },
      error: err => {
        this.deleteSaving = false;
        this.deleteError = err?.error?.message || 'Suppression impossible.';
      }
    });
  }

  /* ===== E-mail ===== */

  openEmailModal(): void {
    this.emailValue = this.user?.email ?? '';
    this.emailError = null;
    this.emailSaving = false;
    this.showEmailModal = true;
  }

  closeEmailModal(): void {
    this.showEmailModal = false;
  }

  get emailInvalid(): boolean {
    const v = this.emailValue.trim();
    return v.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  get canSubmitEmail(): boolean {
    const v = this.emailValue.trim();
    return !this.emailSaving && v.length > 0 && !this.emailInvalid && v.toLowerCase() !== (this.user?.email || '').toLowerCase();
  }

  submitEmail(): void {
    if (!this.user || !this.canSubmitEmail) {
      return;
    }
    this.emailSaving = true;
    this.emailError = null;
    this.adminService.updateUserEmail(this.user.id, this.emailValue.trim()).subscribe({
      next: updated => {
        this.user = updated;
        this.emailSaving = false;
        this.showEmailModal = false;
        this.flashSuccess('Adresse e-mail mise à jour.');
        this.loadActivity();
      },
      error: err => {
        this.emailSaving = false;
        this.emailError = err?.error?.message || 'Modification de l\'e-mail impossible.';
      }
    });
  }

  /* ===== Mot de passe ===== */

  openResetModal(): void {
    this.resetNewPassword = '';
    this.resetConfirmPassword = '';
    this.showResetPwd = false;
    this.resetError = null;
    this.resetSuccess = null;
    this.resetSaving = false;
    this.showResetModal = true;
  }

  closeResetModal(): void {
    this.showResetModal = false;
    if (this.resetSuccess) {
      this.loadActivity();
    }
  }

  get resetPasswordsMismatch(): boolean {
    return this.resetConfirmPassword.length > 0 && this.resetNewPassword !== this.resetConfirmPassword;
  }

  get resetPasswordTooShort(): boolean {
    return this.resetNewPassword.length > 0 && this.resetNewPassword.length < 8;
  }

  get canSubmitReset(): boolean {
    return (
      !this.resetSaving &&
      this.resetNewPassword.length >= 8 &&
      this.resetNewPassword === this.resetConfirmPassword
    );
  }

  generatePassword(): void {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '@#$%&*!?';
    const all = upper + lower + digits + symbols;
    const pick = (set: string) => set[Math.floor(Math.random() * set.length)];

    let pwd = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
    for (let i = pwd.length; i < 12; i++) {
      pwd += pick(all);
    }
    pwd = pwd.split('').sort(() => Math.random() - 0.5).join('');

    this.resetNewPassword = pwd;
    this.resetConfirmPassword = pwd;
    this.showResetPwd = true;
  }

  submitReset(): void {
    if (!this.user || !this.canSubmitReset) {
      return;
    }
    this.resetSaving = true;
    this.resetError = null;
    this.resetSuccess = null;

    this.adminService.resetUserPassword(this.user.id, this.resetNewPassword).subscribe({
      next: res => {
        this.resetSaving = false;
        this.resetSuccess = res?.message || 'Mot de passe réinitialisé avec succès.';
      },
      error: err => {
        this.resetSaving = false;
        this.resetError = err?.error?.message || 'Réinitialisation impossible.';
      }
    });
  }

  /* ===== Affichage ===== */

  private flashSuccess(message: string): void {
    this.actionSuccess = message;
    this.actionError = null;
    setTimeout(() => (this.actionSuccess = null), 6000);
  }

  activityLabel(entry: AdminUserActivityEntry): string {
    const map: Record<string, string> = {
      ACCOUNT_CREATED: 'Compte créé',
      EMAIL_CHANGED: 'E-mail modifié par l\'utilisateur',
      PASSWORD_CHANGED: 'Mot de passe modifié par l\'utilisateur',
      ADMIN_EMAIL_CHANGED: 'E-mail modifié par l\'admin',
      ADMIN_PASSWORD_RESET: 'Mot de passe réinitialisé par l\'admin',
      ACCOUNT_DISABLED: 'Compte désactivé',
      ACCOUNT_ENABLED: 'Compte réactivé'
    };
    return map[entry.action] || entry.action;
  }

  activityKind(entry: AdminUserActivityEntry): string {
    switch (entry.action) {
      case 'ACCOUNT_CREATED':
      case 'ACCOUNT_ENABLED':
        return 'ok';
      case 'ACCOUNT_DISABLED':
        return 'bad';
      case 'ADMIN_PASSWORD_RESET':
      case 'ADMIN_EMAIL_CHANGED':
        return 'admin';
      default:
        return 'user';
    }
  }

  formatDt(value: string | number[] | null | undefined): string {
    if (value == null) {
      return '—';
    }
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? value : d.toLocaleString('fr-FR');
    }
    if (Array.isArray(value) && value.length >= 3) {
      const [year, month, day, h = 0, min = 0, s = 0] = value;
      return new Date(year, month - 1, day, h, min, s).toLocaleString('fr-FR');
    }
    return '—';
  }

  pipelineTotal(c: AdminPipelineCounts | undefined): number {
    if (!c) {
      return 0;
    }
    if (typeof c.total === 'number') {
      return c.total;
    }
    return (c.success || 0) + (c.failed || 0) + (c.running || 0) + (c.pending || 0) + (c.canceled || 0) + (c.skipped || 0);
  }

  envBreakdownTotal(u: AdminUserMetrics): number {
    const b = u.environmentStatusBreakdown;
    if (!b) {
      return 0;
    }
    if (typeof b.total === 'number') {
      return b.total;
    }
    return (b.pending || 0) + (b.building || 0) + (b.running || 0) + (b.failed || 0) + (b.destroyed || 0) + (b.expired || 0);
  }

  envStatusLabel(env: AdminUserEnvironmentDetail): string {
    const map: Record<string, string> = {
      PENDING: 'En attente',
      BUILDING: 'Construction',
      RUNNING: 'Actif',
      FAILED: 'Échec',
      DESTROYED: 'Détruit',
      EXPIRED: 'Expiré'
    };
    return map[env.status] || env.status;
  }

  pipelineStatusLabel(status: string | null | undefined): string {
    if (!status) {
      return '—';
    }
    const map: Record<string, string> = {
      SUCCESS: 'Réussi',
      FAILED: 'Échec',
      RUNNING: 'En cours',
      PENDING: 'En attente',
      CANCELED: 'Annulé',
      SKIPPED: 'Ignoré'
    };
    return map[status] || status;
  }
}
