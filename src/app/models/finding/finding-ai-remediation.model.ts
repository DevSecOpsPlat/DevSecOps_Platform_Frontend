/** Provenance d'un élément du diagnostic. */
export type DiagnosisSource = 'SCANNER' | 'PLATFORM_CHECK' | 'REPOSITORY' | 'HYPOTHESIS';

/** Degré de certitude d'une cause ou d'une localisation. */
export type CertaintyStatus = 'CONFIRMED' | 'PROBABLE' | 'UNDETERMINED';

export interface DiagnosisItem {
  statement: string;
  source: DiagnosisSource | string;
}

export interface FixLayer {
  /** APPLICATION | REVERSE_PROXY | CDN_TLS | KUBERNETES | WEB_SERVER | BUILD | DEPENDENCY | OTHER */
  layer: string;
  description: string;
  recommended: boolean;
}

export interface FindingAiRemediationResponse {
  problemSummary?: string;
  rootCause?: string;
  impact?: string;
  /** Ancien format (avant v2) : fusionné avec impact à l'affichage. */
  businessRisk?: string;
  location?: string;
  reproduction?: string;
  remediationSteps?: string[];
  suggestedPatch?: string;
  /** Ancien format : affiché seulement s'il n'y a pas de suggestedPatch. */
  secureCodeBefore?: string;
  secureCodeAfter?: string;
  fullFileRewrite?: string;
  bestPractices?: string[];
  references?: { type: string; id: string; url: string }[];
  verificationHints?: string[];
  verificationCommands?: string[];
  /** Confiance finale (bornée par le backend selon les preuves). */
  confidence?: string;
  confidenceReason?: string | null;
  modelConfidence?: string | null;
  rawModelOutput?: string;
  codeContextSource?: string;

  // Format v2 (diagnostic sourcé) — absents des analyses antérieures et des modèles statiques
  diagnosis?: DiagnosisItem[];
  rootCauseStatus?: CertaintyStatus | string | null;
  locationStatus?: CertaintyStatus | string | null;
  fixLayers?: FixLayer[];
  patchLanguage?: string | null;
  patchTarget?: string | null;

  aiProviderUsed?: string | null;
  aiModelUsed?: string | null;
  quotaFallbackUsed?: boolean | null;
  aiModelTier?: string | null;
  responseSource?: string | null;
  status?: 'PENDING' | 'COMPLETE' | 'FAILED' | string | null;
  jobId?: string | null;
}
