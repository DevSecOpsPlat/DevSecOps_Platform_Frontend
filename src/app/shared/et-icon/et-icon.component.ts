import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';

/** Icônes au trait de la plateforme (même épaisseur, couleur = couleur du texte). */
export type EtIconName =
  | 'refresh' | 'search' | 'rocket' | 'grid' | 'branch' | 'server' | 'shield' | 'shield-check'
  | 'copy' | 'check' | 'x' | 'external' | 'clock' | 'link-off' | 'globe' | 'commit' | 'alert'
  | 'chart' | 'chevron-down' | 'activity';

@Component({
  selector: 'et-icon',
  standalone: true,
  imports: [NgSwitch, NgSwitchCase, NgSwitchDefault],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: inline-flex; flex-shrink: 0; line-height: 0; }'],
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         [attr.stroke-width]="stroke" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"
         [ngSwitch]="name">
      <ng-container *ngSwitchCase="'refresh'"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></ng-container>
      <ng-container *ngSwitchCase="'search'"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></ng-container>
      <ng-container *ngSwitchCase="'rocket'">
        <path d="M5 15c-1.4 1.2-2 5-2 5s3.8-.6 5-2c.7-.8.7-2.1-.1-2.9a2.1 2.1 0 0 0-2.9-.1z"/>
        <path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/>
        <path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0"/><path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>
      </ng-container>
      <ng-container *ngSwitchCase="'grid'">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>
      </ng-container>
      <ng-container *ngSwitchCase="'branch'">
        <path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
      </ng-container>
      <ng-container *ngSwitchCase="'server'">
        <rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/>
        <path d="M7 7.5h.01M7 16.5h.01"/>
      </ng-container>
      <ng-container *ngSwitchCase="'shield'"><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/></ng-container>
      <ng-container *ngSwitchCase="'shield-check'">
        <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/><path d="m9 12 2 2 4-4"/>
      </ng-container>
      <ng-container *ngSwitchCase="'copy'"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></ng-container>
      <ng-container *ngSwitchCase="'check'"><path d="m5 12.5 4.5 4.5L19 7.5"/></ng-container>
      <ng-container *ngSwitchCase="'x'"><path d="M6 6l12 12M18 6 6 18"/></ng-container>
      <ng-container *ngSwitchCase="'external'">
        <path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>
      </ng-container>
      <ng-container *ngSwitchCase="'clock'"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></ng-container>
      <ng-container *ngSwitchCase="'link-off'">
        <path d="M10 14l-1 1a3.5 3.5 0 0 1-5-5l2-2"/><path d="M14 10l1-1a3.5 3.5 0 0 1 5 5l-2 2"/><path d="M4 4l16 16"/>
      </ng-container>
      <ng-container *ngSwitchCase="'globe'">
        <circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>
      </ng-container>
      <ng-container *ngSwitchCase="'commit'"><circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/></ng-container>
      <ng-container *ngSwitchCase="'alert'"><path d="M12 4 21 20H3L12 4z"/><path d="M12 10v4M12 17h.01"/></ng-container>
      <ng-container *ngSwitchCase="'chart'"><path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/></ng-container>
      <ng-container *ngSwitchCase="'chevron-down'"><path d="m6 9 6 6 6-6"/></ng-container>
      <ng-container *ngSwitchDefault><path d="M3 12h4l3-8 4 16 3-8h4"/></ng-container>
    </svg>
  `
})
export class EtIconComponent {
  @Input() name: EtIconName = 'activity';
  @Input() size = 16;
  @Input() stroke = 1.8;
}
