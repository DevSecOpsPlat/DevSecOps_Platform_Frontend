import { Injectable } from '@angular/core';
import { 
  getEnvironmentStatusIcon as getEnvIcon, 
  getEnvironmentStatusDescription as getEnvDesc,
  getPipelineStatusIcon as getPipeIcon 
} from 'src/app/models/environment/status-types';

@Injectable({
  providedIn: 'root'
})
export class FormatService {
  
  // Délégation aux fonctions importées
  getEnvironmentStatusIcon = getEnvIcon;
  getEnvironmentStatusDescription = getEnvDesc;
  getPipelineStatusIcon = getPipeIcon;
  
  formatTimeAgo(iso: string | null): string {
    if (!iso) return '—';
    
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'À l\'instant';
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours} h`;
    if (diffDays < 7) return `Il y a ${diffDays} j`;
    
    return date.toLocaleDateString('fr-FR');
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatDuration(seconds: number | undefined): string {
    if (!seconds) return '—';
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  getTimeRemaining(expiresAt: string | null): string {
    if (!expiresAt) return '—';
    
    const now = new Date();
    const expiry = new Date(expiresAt);
    
    if (now > expiry) return 'Expiré';
    
    const diffMs = expiry.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    
    if (diffHours > 0) {
      return `${diffHours}h ${diffMins}m`;
    }
    return `${diffMins} min`;
  }
}