// src/app/pipes/time-ago.pipe.ts
import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'timeAgo'
})
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '—';
    
    try {
      const date = new Date(value);
      const now = new Date();
      const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
      
      if (seconds < 0) return 'Dans le futur';
      if (seconds < 30) return 'À l\'instant';
      if (seconds < 60) return `Il y a ${seconds} secondes`;
      
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `Il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
      
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return `Il y a ${hours} heure${hours > 1 ? 's' : ''}`;
      
      const days = Math.floor(hours / 24);
      if (days < 7) return `Il y a ${days} jour${days > 1 ? 's' : ''}`;
      
      return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch (e) {
      return 'Date invalide';
    }
  }
}