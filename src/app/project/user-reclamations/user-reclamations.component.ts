import { Component, OnInit } from '@angular/core';
import { ComplaintDto, ComplaintService } from '../../services/complaints/complaint.service';

@Component({
  selector: 'app-user-reclamations',
  templateUrl: './user-reclamations.component.html',
  styleUrls: ['./user-reclamations.component.css']
})
export class UserReclamationsComponent implements OnInit {
  list: ComplaintDto[] = [];
  loading = true;
  error: string | null = null;

  subject = '';
  message = '';
  submitting = false;

  /** Brouillon de réponse par id de réclamation. */
  replyDrafts: Record<string, string> = {};
  sendingReplyId: string | null = null;
  closingId: string | null = null;

  constructor(private complaintService: ComplaintService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.complaintService.getMine().subscribe({
      next: rows => {
        this.list = rows;
        this.loading = false;
      },
      error: err => {
        this.loading = false;
        this.error = err.error?.message || err.message || 'Impossible de charger vos réclamations.';
      }
    });
  }

  submit(): void {
    const s = this.subject.trim();
    const m = this.message.trim();
    if (!s || !m) {
      this.error = 'Renseignez le sujet et le message.';
      return;
    }
    this.error = null;
    this.submitting = true;
    this.complaintService.create(s, m).subscribe({
      next: () => {
        this.subject = '';
        this.message = '';
        this.submitting = false;
        this.load();
      },
      error: err => {
        this.submitting = false;
        this.error = err.error?.message || err.message || 'Envoi impossible.';
      }
    });
  }

  sendReply(c: ComplaintDto): void {
    if (c.status !== 'OPEN' || this.sendingReplyId) {
      return;
    }
    const text = (this.replyDrafts[c.id] ?? '').trim();
    if (!text) {
      this.error = 'Saisissez un message.';
      return;
    }
    this.error = null;
    this.sendingReplyId = c.id;
    this.complaintService.addMessage(c.id, text).subscribe({
      next: () => {
        this.replyDrafts[c.id] = '';
        this.sendingReplyId = null;
        this.load();
      },
      error: err => {
        this.sendingReplyId = null;
        this.error = err.error?.message || err.message || 'Envoi impossible.';
      }
    });
  }

  closeThread(c: ComplaintDto): void {
    if (c.status !== 'OPEN' || this.closingId) {
      return;
    }
    this.error = null;
    this.closingId = c.id;
    this.complaintService.closeMine(c.id).subscribe({
      next: () => {
        this.closingId = null;
        this.load();
      },
      error: err => {
        this.closingId = null;
        this.error = err.error?.message || err.message || 'Clôture impossible.';
      }
    });
  }

  statusLabel(status: string): string {
    if (status === 'OPEN') {
      return 'En cours';
    }
    if (status === 'CLOSED') {
      return 'Clôturée';
    }
    return status;
  }
}
