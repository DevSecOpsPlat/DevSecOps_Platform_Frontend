import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-admin-observability',
  templateUrl: './admin-observability.component.html',
  styleUrls: ['../admin-route-page.css', './admin-observability.component.css']
})
export class AdminObservabilityComponent implements OnInit {
  readonly sonarOrgUrl = environment.adminObservability?.sonarCloudOrgUrl ?? 'https://sonarcloud.io';
  readonly sonarProjectsUrl = environment.adminObservability?.sonarCloudProjectsUrl ?? this.sonarOrgUrl;

  grafanaUrl: SafeResourceUrl | null = null;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    const raw = environment.adminObservability?.grafanaEmbedUrl?.trim();
    if (raw) {
      this.grafanaUrl = this.sanitizer.bypassSecurityTrustResourceUrl(raw);
    }
  }
}
