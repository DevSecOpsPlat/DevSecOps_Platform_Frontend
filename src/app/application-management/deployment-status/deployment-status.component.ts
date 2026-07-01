import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { ApplicationManagementService } from '../../services/application-management/application-management.service';
import {
  AppDatabaseModel,
  AppDeployment,
  SECRET_MASK
} from '../../models/application-management/application-management.models';

interface StateEntry {
  name: string;
  status: string;
  wave: number;
  internalHost: string;
  externalUrl?: string | null;
}

@Component({
  selector: 'app-managed-deployment-status',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './deployment-status.component.html',
  styleUrls: ['../shared/app-management.shared.css']
})
export class DeploymentStatusComponent implements OnChanges, OnDestroy {
  @Input() appId!: string;
  @Input() deployment!: AppDeployment;

  /** Copie locale (mise à jour par le polling). */
  dep!: AppDeployment;

  /** Mots de passe révélés (id base → mot de passe en clair). */
  revealed: Record<string, string> = {};
  revealing: Record<string, boolean> = {};

  private poll?: Subscription;

  constructor(private api: ApplicationManagementService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['deployment'] && this.deployment) {
      this.dep = this.deployment;
      this.setupPolling();
    }
  }

  ngOnDestroy(): void {
    this.poll?.unsubscribe();
  }

  private setupPolling(): void {
    this.poll?.unsubscribe();
    if (!this.dep || !this.appId) return;
    if (this.dep.status !== 'DEPLOYING' && this.dep.status !== 'PENDING') return;

    // Poll toutes les 5s tant que le déploiement est en cours.
    this.poll = interval(5000)
      .pipe(switchMap(() => this.api.getDeployment(this.appId, this.dep.id)))
      .subscribe({
        next: (updated) => {
          this.dep = updated;
          if (updated.status !== 'DEPLOYING' && updated.status !== 'PENDING') {
            this.poll?.unsubscribe();
          }
        },
        error: () => {}
      });
  }

  private entries(section: 'services' | 'databases'): StateEntry[] {
    const state = this.dep?.servicesState?.[section];
    if (!state) return [];
    return Object.keys(state).map((name) => ({
      name,
      status: state[name]?.status || 'NotReady',
      wave: state[name]?.wave ?? 0,
      internalHost: state[name]?.internalHost || '',
      externalUrl: state[name]?.externalUrl || null
    }));
  }

  get serviceEntries(): StateEntry[] {
    return this.entries('services');
  }

  get databaseEntries(): StateEntry[] {
    return this.entries('databases');
  }

  statusClass(status: string): string {
    return status === 'Ready' ? 'status-running' : 'status-pending';
  }

  displayUrl(db: AppDatabaseModel): string {
    const masked = db.generatedConnectionUrl || '';
    const pwd = db.id ? this.revealed[db.id] : undefined;
    if (pwd && masked.includes(SECRET_MASK)) {
      return masked.replace(SECRET_MASK, pwd);
    }
    return masked;
  }

  isRevealable(db: AppDatabaseModel): boolean {
    return !!db.generatedConnectionUrl && db.generatedConnectionUrl.includes(SECRET_MASK) && !!db.hasRootPassword;
  }

  toggleReveal(db: AppDatabaseModel): void {
    if (!db.id) return;
    if (this.revealed[db.id]) {
      delete this.revealed[db.id];
      return;
    }
    this.revealing[db.id] = true;
    this.api.revealSecret(this.appId, this.dep.id, { type: 'DB_PASSWORD', targetId: db.id }).subscribe({
      next: (res) => {
        this.revealed[db.id!] = res.value;
        this.revealing[db.id!] = false;
      },
      error: () => {
        this.revealing[db.id!] = false;
      }
    });
  }

  copy(text: string): void {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }
}
