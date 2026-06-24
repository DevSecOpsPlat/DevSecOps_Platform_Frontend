import { Component, OnInit } from '@angular/core';
import { ComplaintDto, ComplaintService } from '../../services/complaints/complaint.service';

@Component({
  selector: 'app-admin-reclamations',
  templateUrl: './admin-reclamations.component.html',
  styleUrls: ['../admin-route-page.css', './admin-reclamations.component.css']
})
export class AdminReclamationsComponent implements OnInit {
  list: ComplaintDto[] = [];
  loading = true;
  error: string | null = null;

  filterStatus: '' | 'OPEN' | 'CLOSED' = '';

  threadTarget: ComplaintDto | null = null;
  replyText = '';
  submitting = false;
  closing = false;

  constructor(private complaintService: ComplaintService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    const q = this.filterStatus || undefined;
    this.complaintService.listAll(q).subscribe({
      next: rows => {
        this.list = rows;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Chargement impossible.';
      }
    });
  }

  setFilter(f: '' | 'OPEN' | 'CLOSED'): void {
    this.filterStatus = f;
    this.load();
  }

  firstMessagePreview(c: ComplaintDto): string {
    const first = c.messages?.[0];
    return first?.body ?? '';
  }

  openThread(c: ComplaintDto): void {
    this.error = null;
    this.threadTarget = c;
    this.replyText = '';
  }

  cancelThread(): void {
    this.threadTarget = null;
    this.replyText = '';
    this.closing = false;
  }

  sendReply(): void {
    if (!this.threadTarget || this.submitting || this.closing) {
      return;
    }
    if (this.threadTarget.status !== 'OPEN') {
      this.error = 'Cette réclamation est fermée ; vous ne pouvez plus envoyer de message.';
      return;
    }
    const t = this.replyText.trim();
    if (!t) {
      this.error = 'Saisissez un message.';
      return;
    }
    this.error = null;
    this.submitting = true;
    this.complaintService.adminAddMessage(this.threadTarget.id, t).subscribe({
      next: updated => {
        this.submitting = false;
        this.replyText = '';
        this.threadTarget = updated;
        this.load();
      },
      error: err => {
        this.submitting = false;
        this.error = err.error?.message || err.message || 'Envoi impossible.';
      }
    });
  }

  closeThread(): void {
    if (!this.threadTarget || this.submitting || this.closing) {
      return;
    }
    this.error = null;
    this.closing = true;
    this.complaintService.adminClose(this.threadTarget.id).subscribe({
      next: updated => {
        this.closing = false;
        this.threadTarget = updated;
        this.load();
      },
      error: err => {
        this.closing = false;
        this.error = err.error?.message || err.message || 'Clôture impossible.';
      }
    });
  }
}
