import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-deploy-success-modal',
  templateUrl: './deploy-success-modal.component.html',
  styleUrls: ['./deploy-success-modal.component.css']
})
export class DeploySuccessModalComponent {

  @Input() visible = false;
  @Input() environmentId = '';
  @Input() applicationId = '';
  @Input() pipelineWebUrl = '';
  @Input() environmentName = '';

  @Output() close = new EventEmitter<void>();

  constructor(private router: Router) {}

  trackProgress(): void {
    if (this.environmentId) {
      localStorage.setItem('envirotest-last-pipeline-env', this.environmentId);
      if (this.applicationId) {
        this.router.navigate(
          ['/pipeline', this.environmentId],
          { queryParams: { appId: this.applicationId } }
        );
      } else {
        this.router.navigate(['/pipeline', this.environmentId]);
      }
    } else if (this.applicationId) {
      this.router.navigate(['/project', this.applicationId, 'overview']);
    }
    this.close.emit();
  }

  openGitLab(): void {
    if (this.pipelineWebUrl) {
      window.open(this.pipelineWebUrl, '_blank');
    }
    this.close.emit();
  }

  onBackdropClick(): void {
    this.close.emit();
  }
}
