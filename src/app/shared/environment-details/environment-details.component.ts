// environment-details.component.ts
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EnvironmentSummaryResponse } from 'src/app/models/environment/environment-summary-response';
import { FormatService } from 'src/app/models/environment/format.service';
import { EnvironmentService } from 'src/app/services/environment/environment.service';
import { ToastService } from 'src/app/services/ui/toast.service';

@Component({
  selector: 'app-environment-details',
  templateUrl: './environment-details.component.html',
  styleUrls: ['./environment-details.component.css']
})
export class EnvironmentDetailsComponent implements OnInit {
  envId: string = '';
  environment: EnvironmentSummaryResponse | null = null;
  loading = true;
  error: string | null = null;
  appId: string | null = null;
  redirectTimer: any;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private environmentService: EnvironmentService,
    private toastService: ToastService,
    public format: FormatService
  ) {}

  ngOnInit(): void {
    this.envId = this.route.snapshot.paramMap.get('envId') || '';
    this.appId = this.route.snapshot.queryParamMap.get('appId');
    
    if (this.envId) {
      this.loadEnvironment();
    } else {
      this.error = 'ID environnement invalide';
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    if (this.redirectTimer) {
      clearTimeout(this.redirectTimer);
    }
  }

  loadEnvironment(): void {
    this.loading = true;
    this.error = null;
    
    this.environmentService.getEnvironmentById(this.envId).subscribe({
      next: env => {
        this.environment = env;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        
        if (err.status === 404) {
          this.handleNotFound();
        } else {
          this.error = err.error?.message || 'Erreur lors du chargement';
          console.error('Erreur:', err);
        }
      }
    });
  }

  private handleNotFound(): void {
    this.error = "Cet environnement n'existe plus";

    // Tenter de récupérer le dernier environnement existant pour l'utilisateur
    this.environmentService.getLatestEnvironment().subscribe({
      next: latest => {
        if (latest && latest.id) {
          if (this.toastService) {
            this.toastService.push(
              'info',
              'Environnement introuvable',
              'Redirection vers le dernier environnement disponible...',
              3000
            );
          }

          const queryParams: any = {};
          if (this.appId) {
            queryParams.appId = this.appId;
          }

          this.router.navigate(['/environment', latest.id], {
            queryParams
          });
        } else {
          this.redirectToEnvironmentsList();
        }
      },
      error: err => {
        if (err.status === 404) {
          // Aucun environnement pour l'utilisateur
          this.redirectToEnvironmentsList();
        } else {
          this.redirectToEnvironmentsList();
        }
      }
    });
  }

  private redirectToEnvironmentsList(): void {
    if (this.toastService) {
      this.toastService.push(
        'info',
        'Environnement introuvable',
        'Redirection vers la liste des environnements...',
        3000
      );
    }

    this.redirectTimer = setTimeout(() => {
      if (this.appId) {
        this.router.navigate(['/project', this.appId, 'deployments']);
      } else {
        this.router.navigate(['/environments']);
      }
    }, 3000);
  }

  getStatusClass(): string {
    if (!this.environment) return '';
    const status = this.environment.status.toUpperCase();
    
    switch(status) {
      case 'RUNNING': return 'status-running';
      case 'BUILDING': return 'status-building';
      case 'PENDING': return 'status-pending';
      case 'FAILED': return 'status-failed';
      case 'DESTROYED': return 'status-destroyed';
      case 'EXPIRED': return 'status-expired';
      default: return 'status-default';
    }
  }

  getCreatedAt(): string {
    if (!this.environment?.createdAt) return 'Date non disponible';
    return this.format.formatDate(this.environment.createdAt);
  }

  getCreatedAtTimeAgo(): string {
    if (!this.environment?.createdAt) return '';
    return this.format.formatTimeAgo(this.environment.createdAt);
  }

  getExpiresAt(): string {
    if (!this.environment?.expiresAt) return 'Non défini';
    return this.format.formatDate(this.environment.expiresAt);
  }

  getTimeRemaining(): string {
    if (!this.environment?.expiresAt) return '—';
    return this.format.getTimeRemaining(this.environment.expiresAt);
  }

  isExpired(): boolean {
    if (!this.environment) return false;
    
    // Vérifier par le statut
    if (this.environment.status === 'EXPIRED' || this.environment.status === 'DESTROYED') {
      return true;
    }
    
    // Vérifier par la date d'expiration
    if (this.environment.expiresAt) {
      return new Date(this.environment.expiresAt) < new Date();
    }
    
    return false;
  }

  goBack(): void {
    if (this.appId) {
      this.router.navigate(['/project', this.appId, 'deployments']);
    } else {
      this.router.navigate(['/environments']);
    }
  }

  viewPipeline(): void {
    if (this.environment?.latestPipelineId) {
      this.router.navigate(['/pipeline', this.envId], {
        queryParams: { appId: this.appId }
      });
    }
  }

  copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      alert('ID copié dans le presse-papier');
    });
  }
}