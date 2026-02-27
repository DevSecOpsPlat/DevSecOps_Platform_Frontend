import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'envirotest-theme';
  private themeSubject = new BehaviorSubject<Theme>(this.loadInitial());
  theme$ = this.themeSubject.asObservable();

  private loadInitial(): Theme {
    const stored = localStorage.getItem(this.STORAGE_KEY) as Theme | null;
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  get current(): Theme {
    return this.themeSubject.value;
  }

  toggle(): void {
    const next: Theme = this.current === 'dark' ? 'light' : 'dark';
    this.set(next);
  }

  set(theme: Theme): void {
    this.themeSubject.next(theme);
    localStorage.setItem(this.STORAGE_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  init(): void {
    document.documentElement.setAttribute('data-theme', this.current);
  }
}
