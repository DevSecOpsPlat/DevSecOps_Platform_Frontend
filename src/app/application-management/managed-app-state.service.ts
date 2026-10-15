import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApplicationManagementService } from '../services/application-management/application-management.service';
import { ManagedApp } from '../models/application-management/application-management.models';

/**
 * Cache partagé pour le dashboard application managée
 * (layout sidebar + vues enfants sans rechargement inutile).
 */
@Injectable({ providedIn: 'root' })
export class ManagedAppStateService {
  private readonly app$ = new BehaviorSubject<ManagedApp | null>(null);
  private loadedId: string | null = null;

  constructor(private api: ApplicationManagementService) {}

  get snapshot(): ManagedApp | null {
    return this.app$.value;
  }

  watch(): Observable<ManagedApp | null> {
    return this.app$.asObservable();
  }

  load(appId: string, force = false): Observable<ManagedApp> {
    if (!force && this.loadedId === appId && this.app$.value) {
      return of(this.app$.value);
    }
    return this.api.get(appId).pipe(
      tap((app) => {
        this.loadedId = appId;
        this.app$.next(app);
      })
    );
  }

  patch(app: ManagedApp): void {
    this.loadedId = app.id;
    this.app$.next(app);
  }

  clear(): void {
    this.loadedId = null;
    this.app$.next(null);
  }
}
