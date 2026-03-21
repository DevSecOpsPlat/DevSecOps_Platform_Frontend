import { Component } from '@angular/core';

interface AiFix {
  id: string;
  cve: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  library: string;
  versionRange: string;
  suggestion: string;
  detectedAt: string;
  scanId: number;
}

@Component({
  selector: 'app-security-ai-fixes',
  templateUrl: './security-ai-fixes.component.html',
  styleUrls: ['./security-ai-fixes.component.css']
})
export class SecurityAiFixesComponent {
  fixes: AiFix[] = [
    {
      id: '1',
      cve: 'CVE-2024-1234',
      severity: 'high',
      library: 'axios',
      versionRange: '< 1.6.0',
      suggestion: 'Mettre à jour axios vers 1.6.0 ou supérieur pour corriger une vulnérabilité SSRF.',
      detectedAt: 'il y a 2 minutes',
      scanId: 124
    },
    {
      id: '2',
      cve: 'CVE-2024-5678',
      severity: 'medium',
      library: 'express',
      versionRange: '< 4.18.0',
      suggestion: 'Mettre à jour express vers 4.18.0 pour corriger une vulnérabilité d’injection de headers.',
      detectedAt: 'il y a 1 heure',
      scanId: 123
    }
  ];
}

