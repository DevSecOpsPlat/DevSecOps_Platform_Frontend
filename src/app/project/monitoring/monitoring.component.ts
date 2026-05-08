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
  'http://localhost/grafana/d/rYdddlPWk/node-exporter-full' +
  '?orgId=1' +
  '&from=now-24h' +
  '&to=now' +
  '&timezone=browser' +
  '&var-ds_prometheus=prometheus' +
  '&var-job=node-exporter' +
  '&var-nodename=master' +
  '&var-node=192.168.130.138:9100' +
  '&refresh=1m'
);
  }
}

