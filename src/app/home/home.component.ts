import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

interface Capability {
  icon: string;
  title: string;
  text: string;
}

interface Scanner {
  name: string;
  kind: string;
}

/**
 * Page d'accueil : présentation orientée usage (déployer et analyser, deux actions
 * indépendantes), sans détail d'implémentation interne. Animations CSS déclenchées à
 * l'apparition des sections (IntersectionObserver).
 */
@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly scanners: Scanner[] = [
    { name: 'Gitleaks', kind: 'Secrets' },
    { name: 'Semgrep', kind: 'Code' },
    { name: 'SonarQube', kind: 'Qualité' },
    { name: 'Trivy', kind: 'Dépendances' },
    { name: 'Grype', kind: 'Image' },
    { name: 'Syft', kind: 'Inventaire' },
    { name: 'Hadolint', kind: 'Dockerfile' },
    { name: 'Checkov', kind: 'Configuration' },
    { name: 'OWASP ZAP', kind: 'Application' }
  ];

  readonly capabilities: Capability[] = [
    {
      icon: '🚀',
      title: 'Déployer pour tester',
      text: 'Mettez une version en ligne dans un environnement qui lui est propre, puis laissez-le se supprimer automatiquement.'
    },
    {
      icon: '🛡',
      title: 'Analyser la sécurité',
      text: 'Lancez une analyse quand vous le souhaitez : code, dépendances, secrets et configuration, avec un verdict clair.'
    },
    {
      icon: '✦',
      title: 'Corriger plus vite',
      text: 'Chaque vulnérabilité est expliquée en français, avec un plan de correction concret.'
    },
    {
      icon: '◉',
      title: 'Suivre en direct',
      text: 'Disponibilité, consommation et alertes de vos environnements en cours d\'exécution.'
    }
  ];

  readonly pillars: Capability[] = [
    {
      icon: '⚖',
      title: 'Des règles explicites',
      text: 'Une faille critique ou un secret exposé rend le déploiement non recommandé : la décision est lisible par tous.'
    },
    {
      icon: '🧭',
      title: 'Une traçabilité complète',
      text: 'Analyses, verdicts et déploiements restent consultables pour chaque application et chaque service.'
    },
    {
      icon: '◫',
      title: 'Des tests cloisonnés',
      text: 'Chaque environnement de test fonctionne à part, sans impact sur les autres équipes, et s\'arrête de lui-même.'
    }
  ];

  private observer?: IntersectionObserver;

  constructor(
    public authService: AuthService,
    private router: Router,
    private host: ElementRef<HTMLElement>,
    private zone: NgZone
  ) {}

  ngOnInit(): void {
    // Les administrateurs ont leur propre page d'accueil.
    this.authService.isLoggedIn$.subscribe(isLoggedIn => {
      if (isLoggedIn && this.authService.hasRole('ROLE_ADMIN')) {
        this.router.navigate(['/admin-home']);
      }
    });
  }

  ngAfterViewInit(): void {
    const targets = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      targets.forEach(t => t.classList.add('is-visible'));
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).classList.add('is-visible');
          this.observer?.unobserve(entry.target);
        }
      }, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
      targets.forEach(t => this.observer!.observe(t));
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
