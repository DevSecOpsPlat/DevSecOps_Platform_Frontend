import { Component } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-monitoring',
  templateUrl: './monitoring.component.html',
  styleUrls: ['./monitoring.component.css']
})
export class MonitoringComponent {
  readonly grafanaUrl: SafeResourceUrl;

  constructor(private sanitizer: DomSanitizer) {
    this.grafanaUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
      // Use ingress DNS to avoid NodePort + easier cookie/same-origin hardening later
      'http://grafana.local/?orgId=1&from=now-6h&to=now&timezone=browser'
    );
  }
}

