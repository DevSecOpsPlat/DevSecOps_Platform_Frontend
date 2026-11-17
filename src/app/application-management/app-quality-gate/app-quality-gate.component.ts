import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import {
  QualityGateItem,
  SecurityPostureResponse,
  ServicePostureSummary,
  TopBlockingFinding
} from '../../models/application-management/application-management.models';
import { VerdictTone, verdictLabelFr, verdictTone } from '../shared/verdict.util';

type ConditionStatus = 'ok' | 'violated' | 'warn' | 'indeterminate';

interface AppCondition {
  id: string;
  label: string;
  status: ConditionStatus;
  detail?: string;
  scope?: string;
}

/**
 * Quality Gate de l'application complète — même présentation que la page Quality Gate d'un
 * service (résultat, jauge, barème A→E, conditions, chiffres clés), alimentée par la posture
 * agrégée du lot de scan : verdict le plus sévère des services, score du service le plus faible.
 */
@Component({
  selector: 'app-app-quality-gate',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app-quality-gate.component.html',
  styleUrls: [
    '../../project/quality-gate/quality-gate.component.css',
    './app-quality-gate.component.css'
  ]
})
export class AppQualityGateComponent implements OnChanges, OnDestroy {
  @Input() posture: SecurityPostureResponse | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
  /** Le lot affiché est encore en cours (PENDING / RUNNING). */
  @Input() running = false;
  /** Un scan de l'application est déjà en cours de lancement. */
  @Input() scanRunning = false;
  @Input() appName = '';

  @Output() scan = new EventEmitter<void>();
  @Output() retry = new EventEmitter<void>();
  @Output() deploy = new EventEmitter<void>();
  @Output() openServiceQualityGate = new EventEmitter<string>();
  @Output() openServiceDojo = new EventEmitter<string>();
  @Output() openFinding = new EventEmitter<TopBlockingFinding>();

  animatedScore = 0;
  private rafId: number | null = null;

  readonly gradeScale: Array<{ grade: string; min: number; label: string }> = [
    { grade: 'A', min: 90, label: 'Excellent' },
    { grade: 'B', min: 75, label: 'Bon' },
    { grade: 'C', min: 60, label: 'Moyen' },
    { grade: 'D', min: 40, label: 'Faible' },
    { grade: 'E', min: 0, label: 'Critique' }
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['posture'] || changes['running']) {
      this.animateScoreTo(this.hasScore ? (this.posture!.securityScore as number) : 0);
    }
  }

  ngOnDestroy(): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
  }

  // ── États ────────────────────────────────────────────────────────────────

  get batchStatus(): string {
    return (this.posture?.batchStatus || '').toUpperCase();
  }

  get hasBatch(): boolean {
    return !!this.posture?.batchId;
  }

  get isFailedBatch(): boolean {
    return this.batchStatus === 'FAILED';
  }

  get isPartialBatch(): boolean {
    return this.batchStatus === 'PARTIAL';
  }

  /** Un résultat exploitable est affiché (lot terminé, complet ou partiel). */
  get showResult(): boolean {
    return !!this.posture && this.hasBatch && !this.running && !this.isFailedBatch;
  }

  get hasScore(): boolean {
    return this.posture?.securityScore != null;
  }

  get tone(): VerdictTone {
    return verdictTone(this.posture?.verdict);
  }

  // ── Résultat ─────────────────────────────────────────────────────────────

  verdictLabel(verdict: string | null | undefined): string {
    return verdictLabelFr(verdict);
  }

  verdictClass(verdict: string | null | undefined): string {
    switch (verdictTone(verdict)) {
      case 'ok': return 'qg-verdict--ok';
      case 'warn': return 'qg-verdict--warn';
      case 'bad': return 'qg-verdict--fail';
      default: return 'qg-verdict--indeterminate';
    }
  }

  verdictEmoji(verdict: string | null | undefined): string {
    switch (verdictTone(verdict)) {
      case 'ok': return '✓';
      case 'warn': return '⚠';
      case 'bad': return '✕';
      default: return '⊘';
    }
  }

  pillClass(verdict: string | null | undefined): string {
    return 'aqg-pill--' + verdictTone(verdict);
  }

  toneOf(verdict: string | null | undefined): VerdictTone {
    return verdictTone(verdict);
  }

  get services(): ServicePostureSummary[] {
    return this.posture?.services || [];
  }

  get blockedServices(): ServicePostureSummary[] {
    return this.services.filter(s => verdictTone(s.verdict) === 'bad');
  }

  get weakestServiceName(): string | null {
    const dim = this.posture?.dimensioningService;
    if (dim?.serviceName) return dim.serviceName;
    const scored = this.services.filter(s => s.securityScore != null);
    if (!scored.length) return null;
    const min = scored.reduce((a, b) => ((b.securityScore as number) < (a.securityScore as number) ? b : a));
    return min.serviceName || null;
  }

  get heroSummary(): string {
    const p = this.posture;
    if (!p) return '';
    const n = this.services.length || p.expectedServiceCount || 0;
    const parts: string[] = [];
    switch (this.tone) {
      case 'bad': {
        const names = this.blockedServices.map(s => `« ${s.serviceName || 'service'} »`).join(', ');
        parts.push(this.blockedServices.length
          ? `${this.blockedServices.length} service${this.blockedServices.length > 1 ? 's' : ''} sur ${n} bloque${this.blockedServices.length > 1 ? 'nt' : ''} le déploiement : ${names}.`
          : 'Au moins une condition de déploiement est violée.');
        break;
      }
      case 'warn':
        parts.push('Déploiement possible, sous surveillance : des vulnérabilités restent à corriger avant une mise en production.');
        break;
      case 'ok':
        parts.push(`Les ${n} service${n > 1 ? 's' : ''} respectent les conditions de déploiement.`);
        break;
      default:
        parts.push(this.isPartialBatch
          ? (p.message || 'Tous les services n\'ont pas pu être analysés dans ce lot.')
          : 'Au moins un service n\'a pas pu être évalué entièrement (outil indisponible).');
    }
    const weakest = this.weakestServiceName;
    if (this.hasScore && weakest) {
      parts.push(`Le score de l'application est celui de son service le plus faible, « ${weakest} ».`);
    }
    return parts.join(' ');
  }

  get noScoreMessage(): string {
    if (this.isPartialBatch) return 'Score indisponible : le lot est incomplet.';
    return 'Score indisponible : aucun service n\'a de score calculé pour ce lot.';
  }

  get scoreGrade(): string {
    return this.posture?.grade || this.gradeFor(this.posture?.securityScore ?? null);
  }

  gradeFor(score: number | null | undefined): string {
    if (score == null) return '—';
    const g = this.gradeScale.find(x => score >= x.min);
    return g ? g.grade : 'E';
  }

  ratingClass(grade?: string | null): string {
    return grade ? `qg-rating--${grade.toLowerCase()}` : '';
  }

  isCurrentGrade(grade: string): boolean {
    return this.scoreGrade === grade;
  }

  get scaleMarkerLeft(): number {
    return Math.max(0, Math.min(100, this.animatedScore));
  }

  get scoreArcOffset(): number {
    const circumference = 2 * Math.PI * 54;
    return circumference * (1 - Math.max(0, Math.min(100, this.animatedScore)) / 100);
  }

  get scoreArcColor(): string {
    return this.scoreColor(this.animatedScore);
  }

  scoreColor(score: number | null | undefined): string {
    const s = score ?? 0;
    if (s >= 75) return '#22C55E';
    if (s >= 60) return '#EAB308';
    if (s >= 40) return '#F97316';
    return '#EF4444';
  }

  // ── Conditions ───────────────────────────────────────────────────────────

  get conditions(): AppCondition[] {
    return (this.posture?.qualityGates || []).map((g: QualityGateItem) => ({
      id: g.id,
      label: g.label,
      status: this.conditionStatus(g.status),
      detail: g.message,
      scope: g.scope
    }));
  }

  private conditionStatus(status: string | null | undefined): ConditionStatus {
    switch ((status || '').toUpperCase()) {
      case 'PASS': return 'ok';
      case 'FAIL': return 'violated';
      case 'WARN': return 'warn';
      default: return 'indeterminate';
    }
  }

  get conditionsSummary(): string {
    const list = this.conditions;
    if (!list.length) return '';
    const ok = list.filter(c => c.status === 'ok').length;
    return `${ok}/${list.length} respectée${ok > 1 ? 's' : ''}`;
  }

  get violatedCount(): number {
    return this.conditions.filter(c => c.status === 'violated').length;
  }

  conditionIcon(status: ConditionStatus): string {
    switch (status) {
      case 'ok': return '✓';
      case 'violated': return '✕';
      case 'warn': return '!';
      default: return '⊘';
    }
  }

  conditionState(status: ConditionStatus): string {
    switch (status) {
      case 'ok': return 'Respectée';
      case 'violated': return 'Violée';
      case 'warn': return 'À surveiller';
      default: return 'Indéterminée';
    }
  }

  trackCondition(_: number, c: AppCondition): string {
    return c.id;
  }

  // ── Chiffres clés ────────────────────────────────────────────────────────

  severity(key: string, source?: Record<string, number> | null): number {
    const map = source ?? this.posture?.bySeverity ?? {};
    const v = map[key] ?? map[key.charAt(0).toUpperCase() + key.slice(1)] ?? 0;
    return typeof v === 'number' ? v : 0;
  }

  get openTotal(): number {
    return ['critical', 'high', 'medium', 'low'].reduce((n, k) => n + this.severity(k), 0);
  }

  get servicesProgress(): string {
    const p = this.posture;
    if (!p) return '—';
    const done = p.finishedServiceCount ?? this.services.length;
    const expected = p.expectedServiceCount ?? this.services.length;
    return `${done}/${expected}`;
  }

  // ── Explications et conseils ─────────────────────────────────────────────

  get whyLines(): string[] {
    const lines: string[] = [];
    for (const s of this.services) {
      const score = s.securityScore != null ? ` · score ${s.securityScore}/100 (${s.grade || this.gradeFor(s.securityScore)})` : '';
      const reasons = this.serviceReasons(s);
      lines.push(`« ${s.serviceName || 'service'} » — ${this.verdictLabel(s.verdict)}${score}${reasons ? ' · ' + reasons : ''}.`);
    }
    const weakest = this.weakestServiceName;
    if (this.hasScore && weakest && this.services.length > 1) {
      lines.push(`Règle d'agrégation : le verdict le plus sévère l'emporte et le score retenu est celui du service le plus faible (« ${weakest} »).`);
    }
    for (const o of this.posture?.obsoleteServices || []) {
      lines.push(`« ${o.serviceName || 'service'} » a reçu de nouveaux commits depuis ce scan : le verdict peut ne plus refléter le code actuel.`);
    }
    if (this.isPartialBatch && this.posture?.message) {
      lines.push(this.posture.message);
    }
    return lines;
  }

  serviceReasons(s: ServicePostureSummary): string {
    const parts: string[] = [];
    const crit = this.severity('critical', s.bySeverity);
    const high = this.severity('high', s.bySeverity);
    if (crit) parts.push(`${crit} critique${crit > 1 ? 's' : ''}`);
    if (high) parts.push(`${high} élevée${high > 1 ? 's' : ''}`);
    for (const id of s.hardGateIds || []) {
      if (id === 'dd_critical' && crit > 0) continue; // déjà dit par le compteur
      const label = this.hardGateLabel(id);
      if (label && !parts.includes(label)) parts.push(label);
    }
    if (s.indeterminate && (s.indeterminateSources || []).length) {
      parts.push('non évalué : ' + (s.indeterminateSources || []).map(x => this.sourceLabel(x)).join(', '));
    }
    return parts.join(', ');
  }

  hardGateLabel(id: string): string {
    switch (id) {
      case 'dd_critical': return 'vulnérabilité critique (tolérance zéro)';
      case 'secrets': return 'secret exposé';
      case 'sonar_blocker': return 'bloquant SonarQube';
      case 'sonar_qg': return 'Quality Gate SonarQube en échec';
      default: return '';
    }
  }

  private sourceLabel(src: string): string {
    const s = (src || '').toLowerCase();
    if (s.includes('sonar')) return 'SonarQube';
    if (s.includes('dojo') || s.startsWith('dd')) return 'DefectDojo';
    if (s.includes('dast') || s.includes('zap')) return 'ZAP';
    return src;
  }

  get adviceList(): string[] {
    const advice: string[] = [];
    for (const c of this.conditions.filter(x => x.status === 'violated')) {
      advice.push(`Corrigez d'abord : ${c.label}${c.detail ? ' — ' + c.detail : ''}.`);
    }
    const crit = this.severity('critical');
    const high = this.severity('high');
    if (crit > 0) {
      advice.push(`Traitez en priorité ${crit} vulnérabilité${crit > 1 ? 's' : ''} critique${crit > 1 ? 's' : ''} : la liste « Vulnérabilités bloquantes » ouvre chaque correction.`);
    }
    if (high > 0) {
      advice.push(`Planifiez la correction de ${high} vulnérabilité${high > 1 ? 's' : ''} élevée${high > 1 ? 's' : ''}, en commençant par le service « ${this.weakestServiceName || 'le plus faible'} ».`);
    }
    if (this.posture?.obsolete) {
      advice.push('Relancez un scan de l\'application : du code a changé depuis ce verdict.');
    }
    if (this.tone === 'unknown') {
      advice.push('Relancez le scan quand tous les outils sont disponibles pour obtenir un verdict complet.');
    }
    if (!advice.length) {
      advice.push('Aucune action bloquante : vous pouvez déployer l\'application en environnement de test.');
    }
    return advice;
  }

  get blockingFindings(): TopBlockingFinding[] {
    return this.posture?.topBlockingFindings || [];
  }

  severityClass(sev: string | null | undefined): string {
    const s = (sev || '').toLowerCase();
    if (s.startsWith('crit')) return 'aqg-sev--critical';
    if (s.startsWith('high')) return 'aqg-sev--high';
    if (s.startsWith('med')) return 'aqg-sev--medium';
    if (s.startsWith('low')) return 'aqg-sev--low';
    return 'aqg-sev--info';
  }

  severityLabel(sev: string | null | undefined): string {
    const s = (sev || '').toLowerCase();
    if (s.startsWith('crit')) return 'Critique';
    if (s.startsWith('high')) return 'Élevée';
    if (s.startsWith('med')) return 'Moyenne';
    if (s.startsWith('low')) return 'Faible';
    return sev || 'Gate';
  }

  servicePct(s: ServicePostureSummary): number {
    return Math.max(0, Math.min(100, s.securityScore ?? 0));
  }

  get canDeploy(): boolean {
    return this.tone === 'ok' || this.tone === 'warn';
  }

  // ── Animation du score ───────────────────────────────────────────────────

  private animateScoreTo(target: number): void {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof requestAnimationFrame === 'undefined') {
      this.animatedScore = target;
      return;
    }
    const duration = 900;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      this.animatedScore = Math.round(target * eased);
      this.rafId = p < 1 ? requestAnimationFrame(step) : null;
    };
    this.rafId = requestAnimationFrame(step);
  }
}
