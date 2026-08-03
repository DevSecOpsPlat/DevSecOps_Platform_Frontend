export interface FindingAiRemediationResponse {
  problemSummary?: string;
  rootCause?: string;
  impact?: string;
  businessRisk?: string;
  location?: string;
  reproduction?: string;
  remediationSteps?: string[];
  suggestedPatch?: string;
  secureCodeBefore?: string;
  secureCodeAfter?: string;
  fullFileRewrite?: string;
  bestPractices?: string[];
  references?: { type: string; id: string; url: string }[];
  verificationHints?: string[];
  verificationCommands?: string[];
  confidence?: string;
  rawModelOutput?: string;
  codeContextSource?: string;
  aiProviderUsed?: string | null;
  aiModelUsed?: string | null;
  quotaFallbackUsed?: boolean | null;
  aiModelTier?: string | null;
  responseSource?: string | null;
  status?: 'PENDING' | 'COMPLETE' | 'FAILED' | string | null;
  jobId?: string | null;
}
