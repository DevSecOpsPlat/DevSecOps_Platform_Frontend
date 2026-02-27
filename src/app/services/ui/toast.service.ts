import { Injectable } from '@angular/core';

export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  messages: ToastMessage[] = [];
  private counter = 0;

  push(type: ToastMessage['type'], title: string, message: string, timeoutMs = 4000): void {
    const id = ++this.counter;
    const toast: ToastMessage = { id, type, title, message };
    this.messages.push(toast);
    setTimeout(() => this.dismiss(id), timeoutMs);
  }

  dismiss(id: number): void {
    this.messages = this.messages.filter(t => t.id !== id);
  }
}

