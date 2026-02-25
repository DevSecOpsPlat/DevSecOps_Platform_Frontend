import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-project-logs',
  templateUrl: './project-logs.component.html',
  styleUrls: ['./project-logs.component.css']
})
export class ProjectLogsComponent implements AfterViewInit {
  @ViewChild('logContainer') logContainer?: ElementRef<HTMLDivElement>;

  appId = this.route.parent?.snapshot.paramMap.get('appId');
  following = true;

  // Placeholder helper to give the logs pane some realistic content.
  readonly placeholderLogs: string[] = [
    '[clone] Fetching source from Git repository...',
    '[clone] Checking out commit...',
    '[build] Installing dependencies...',
    '[build] Running npm run build...',
    '[scan] Running security scan (Trivy)...',
    '[deploy] Pushing Docker image and applying Kubernetes manifests...',
    '[deploy] Environment available at preview URL.'
  ];

  constructor(private route: ActivatedRoute) {}

  ngAfterViewInit(): void {
    this.scrollToBottom();
  }

  toggleFollow(): void {
    this.following = !this.following;
    if (this.following) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom(): void {
    if (!this.logContainer) return;
    const el = this.logContainer.nativeElement;
    queueMicrotask(() => {
      el.scrollTop = el.scrollHeight;
    });
  }
}
