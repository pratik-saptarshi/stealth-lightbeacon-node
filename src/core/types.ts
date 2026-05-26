export type Severity = 'critical' | 'warning' | 'info' | 'pass';

export interface AuditIssue {
  id: string;
  severity: Severity;
  message: string;
  location: string;
  remedy: string;
}

export interface AuxiliaryResponse {
  status: number;
  body: string;
}

export interface EvaluationContext {
  url: string;
  html: string;
  headers: Record<string, string | string[] | undefined>;
  status?: number;
  responseTimeMs?: number;
  auxiliaryResponses?: Record<string, AuxiliaryResponse>;
  pageSpeed?: {
    lighthousePerformanceScore?: number;
    cwv?: {
      lcp?: string;
      inp?: string;
      cls?: string;
    };
    lcpMs?: number;
    clsScore?: number;
    inpMs?: number;
    ttfbMs?: number;
  };
  robotsContent?: string;
}

export interface DomainResult {
  id: string;
  domain: string;
  score: number;
  issues: AuditIssue[];
  metadata: Record<string, unknown>;
}

export interface AuditReport {
  targetUrl: string;
  crawledPagesCount: number;
  domains: DomainResult[];
  brokenPages?: Record<string, number>;
}

export interface Evaluator {
  id: string;
  domain: string;
  description?: string;
  prerequisites?: string[];
  evaluate(context: EvaluationContext): Promise<DomainResult>;
  run?(context: EvaluationContext): Promise<DomainResult>;
}

const severityPenalty: Record<Severity, number> = {
  critical: 2.5,
  warning: 1,
  info: 0.25,
  pass: 0
};

export function scoreFromIssues(issues: AuditIssue[], baseScore = 10): number {
  const score = issues.reduce((total, issue) => total - severityPenalty[issue.severity], baseScore);
  return Math.max(0, Number(score.toFixed(1)));
}
