import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AppDatabaseModel,
  AppServiceModel,
  DeployPreview
} from '../../models/application-management/application-management.models';
import { isHardBlocked, verdictLabelFr, verdictTone, VerdictTone } from '../shared/verdict.util';

export interface ProjectDeployParams {
  branch: string;
  sessionDurationHours: number;
  serviceIds: string[];
  /** Optionnel — hostname Ingress (ex. demo.example.com). Vide = nip.io par défaut. */
  customHostname?: string | null;
}

/**
 * Modale de déploiement projet : TTL, branche, domaine optionnel, services, infos / warnings.
 */
@Component({
  selector: 'app-project-deploy-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-deploy-modal.component.html',
  styleUrls: ['../shared/app-management.shared.css', './project-deploy-modal.component.css']
})
export class ProjectDeployModalComponent implements OnChanges {
  @Input() services: AppServiceModel[] = [];
  @Input() databases: AppDatabaseModel[] = [];
  @Input() defaultBranch = 'main';
  @Input() defaultTtlHours = 4;
  @Input() defaultCustomHostname = '';
  @Input() preview: DeployPreview | null = null;
  @Input() previewLoading = false;
  @Input() running = false;
  @Input() error: string | null = null;
  /** Verdict agrégé de l'application (Quality Gate) — purement informatif ici, voir `verdictNoticeTone`. */
  @Input() verdict: string | null = null;

  @Output() cancel = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<ProjectDeployParams>();
  @Output() selectionChange = new EventEmitter<{
    branch: string;
    sessionDurationHours: number;
    serviceIds: string[];
  }>();

  branch = 'main';
  sessionDurationHours = 4;
  customHostname = '';
  selectedIds = new Set<string>();
  persistenceConfirmed = false;
  nodeCapacityConfirmed = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['services'] && this.services?.length) {
      this.selectedIds = new Set(
        this.services.filter(s => !!s.id).map(s => s.id as string)
      );
      const firstBranch = this.services.find(s => s.gitBranch)?.gitBranch;
      this.branch = (this.defaultBranch || firstBranch || 'main').trim() || 'main';
      this.sessionDurationHours = this.normalizeTtl(this.defaultTtlHours);
      this.customHostname = (this.defaultCustomHostname || '').trim();
      this.persistenceConfirmed = false;
      this.nodeCapacityConfirmed = false;
      this.emitSelection();
    }
    if (changes['defaultBranch'] && !changes['services']) {
      this.branch = (this.defaultBranch || 'main').trim() || 'main';
    }
    if (changes['defaultTtlHours'] && !changes['services']) {
      this.sessionDurationHours = this.normalizeTtl(this.defaultTtlHours);
    }
    if (changes['defaultCustomHostname'] && !changes['services']) {
      this.customHostname = (this.defaultCustomHostname || '').trim();
    }
  }

  /** BDs liées aux services cochés — incluses automatiquement (pas de sélection séparée). */
  get includedDatabases(): AppDatabaseModel[] {
    const dbIds = new Set(
      this.services
        .filter(s => !!s.id && this.selectedIds.has(s.id) && !!s.dependsOnDatabaseId)
        .map(s => s.dependsOnDatabaseId as string)
    );
    return (this.databases || []).filter(d => !!d.id && dbIds.has(d.id));
  }

  isSelected(id: string | undefined): boolean {
    return !!id && this.selectedIds.has(id);
  }

  toggleService(id: string | undefined): void {
    if (!id) return;
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.persistenceConfirmed = false;
    this.nodeCapacityConfirmed = false;
    this.emitSelection();
  }

  selectAll(): void {
    this.selectedIds = new Set(this.services.filter(s => !!s.id).map(s => s.id as string));
    this.persistenceConfirmed = false;
    this.nodeCapacityConfirmed = false;
    this.emitSelection();
  }

  selectNone(): void {
    this.selectedIds = new Set();
    this.persistenceConfirmed = false;
    this.nodeCapacityConfirmed = false;
    this.emitSelection();
  }

  onTtlOrBranchChange(): void {
    this.emitSelection();
  }

  get selectedCount(): number {
    return this.selectedIds.size;
  }

  get canConfirm(): boolean {
    return this.disabledReason == null;
  }

  /**
   * Pourquoi le bouton "Déployer" est grisé, en clair — jamais à cause du verdict de sécurité
   * (voir `verdictNoticeTone` ci-dessous, purement informatif). Sans ce texte, un utilisateur qui
   * voit le bouton inactif n'a aucun moyen de savoir laquelle de ces conditions structurelles
   * (rien à voir avec la sécurité) en est la cause (retour utilisateur du 4 septembre 2026).
   */
  get disabledReason(): string | null {
    if (this.running) return null; // bouton déjà en cours d'action, pas "bloqué"
    if (this.previewLoading) return 'Analyse de la sélection en cours…';
    if (this.selectedCount === 0) return 'Sélectionnez au moins un service.';
    if (this.preview?.blockingErrors?.length) return this.preview.blockingErrors[0];
    if (this.preview?.requiresConfirmation && !this.persistenceConfirmed) {
      return 'Cochez la case ci-dessus pour confirmer le déploiement sans persistance des données.';
    }
    if (this.nodeOverCapacity && !this.nodeCapacityConfirmed) {
      return 'Cochez la case ci-dessus pour confirmer malgré la capacité insuffisante du nœud.';
    }
    return null;
  }

  onConfirm(): void {
    if (!this.canConfirm) return;
    const host = (this.customHostname || '').trim();
    this.confirm.emit({
      branch: (this.branch || '').trim() || this.defaultBranch || 'main',
      sessionDurationHours: this.normalizeTtl(this.sessionDurationHours),
      serviceIds: Array.from(this.selectedIds),
      customHostname: host || null
    });
  }

  roleClass(role: string): string {
    return 'role-' + (role || '').toLowerCase();
  }

  /**
   * Rappel explicite, au moment même où l'utilisateur clique "Déployer", que le verdict de
   * sécurité n'est aujourd'hui pas un gate bloquant côté plateforme (voir chapitre 6 du rapport,
   * "Une limite assumée : la détection ne vaut pas blocage") — jusqu'ici cette limite n'était ni
   * documentée pour l'utilisateur, ni visible dans l'interface à l'instant de la décision.
   */
  get verdictNoticeTone(): VerdictTone {
    return verdictTone(this.verdict);
  }

  get verdictNoticeLabel(): string {
    return verdictLabelFr(this.verdict);
  }

  get verdictIsBlockedLooking(): boolean {
    return isHardBlocked(this.verdict);
  }

  /** Empreinte ressources demandée (services cochés) vs quota namespace. */
  get quotaCpuPct(): number {
    const req = this.preview?.requestedCpuMillicores;
    const hard = this.preview?.quotaCpuMillicores;
    if (!req || !hard) return 0;
    return Math.min(100, Math.round((req / hard) * 100));
  }

  get quotaMemPct(): number {
    const req = this.preview?.requestedMemoryBytes;
    const hard = this.preview?.quotaMemoryBytes;
    if (!req || !hard) return 0;
    return Math.min(100, Math.round((req / hard) * 100));
  }

  get quotaOverCapacity(): boolean {
    const p = this.preview;
    if (!p?.quotaEnabled) return false;
    return (!!p.quotaCpuMillicores && (p.requestedCpuMillicores || 0) > p.quotaCpuMillicores)
      || (!!p.quotaMemoryBytes && (p.requestedMemoryBytes || 0) > p.quotaMemoryBytes);
  }

  /** Capacité réelle du nœud K8s : ce qui reste réellement disponible, tous namespaces confondus. */
  get nodeOverCapacity(): boolean {
    const p = this.preview;
    if (!p?.nodeCapacityEnabled) return false;
    return (p.requestedCpuMillicores || 0) > (p.nodeAvailableCpuMillicores || 0)
      || (p.requestedMemoryBytes || 0) > (p.nodeAvailableMemoryBytes || 0);
  }

  /**
   * Position (%) sur la barre où se trouve la limite réelle du nœud, quand elle est PLUS
   * restrictive que le quota namespace — ex. 4.00 cores de quota mais seulement 2.90 cores libres
   * sur le nœud : la barre affichait un plein jusqu'à 4.00 comme si c'était sûr, sans jamais
   * indiquer que la vraie limite est plus basse (retour utilisateur du 18 août 2026).
   * Retourne null si le nœud n'est pas la contrainte la plus stricte — pas de repère à afficher.
   */
  get nodeCpuMarkerPct(): number | null {
    const p = this.preview;
    if (!p?.nodeCapacityEnabled || !p.quotaCpuMillicores || p.nodeAvailableCpuMillicores == null) return null;
    if (p.nodeAvailableCpuMillicores >= p.quotaCpuMillicores) return null;
    return Math.max(0, Math.min(100, Math.round((p.nodeAvailableCpuMillicores / p.quotaCpuMillicores) * 100)));
  }

  get nodeMemMarkerPct(): number | null {
    const p = this.preview;
    if (!p?.nodeCapacityEnabled || !p.quotaMemoryBytes || p.nodeAvailableMemoryBytes == null) return null;
    if (p.nodeAvailableMemoryBytes >= p.quotaMemoryBytes) return null;
    return Math.max(0, Math.min(100, Math.round((p.nodeAvailableMemoryBytes / p.quotaMemoryBytes) * 100)));
  }

  formatMillicores(m: number | null | undefined): string {
    if (m == null || !Number.isFinite(m)) return '—';
    if (m < 1000) return m + 'm';
    return (m / 1000).toFixed(2) + ' cores';
  }

  formatBytes(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes)) return '—';
    const gi = bytes / (1024 * 1024 * 1024);
    if (gi >= 1) return gi.toFixed(2) + ' Gi';
    return (bytes / (1024 * 1024)).toFixed(0) + ' Mi';
  }

  private emitSelection(): void {
    this.selectionChange.emit({
      branch: (this.branch || '').trim() || this.defaultBranch || 'main',
      sessionDurationHours: this.normalizeTtl(this.sessionDurationHours),
      serviceIds: Array.from(this.selectedIds)
    });
  }

  private normalizeTtl(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 4;
    }
    return Math.max(1, Math.min(Math.floor(parsed), 72));
  }
}
