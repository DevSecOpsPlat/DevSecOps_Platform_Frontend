// models/activity.models.ts
export interface ActivityItem {
  id: string;
  type: 'deployment' | 'pipeline' | 'environment' | 'security';
  title: string;
  description: string;
  timestamp: string | number | Date;
  status: string;
  icon: string;
  link?: string;
  metadata?: {
    branch?: string;
    environment?: string;
    duration?: number;
    triggeredBy?: string;
    /** URL publique de l’app (ex. preview nip.io) quand l’environnement est actif. */
    previewUrl?: string | null;
  };
}