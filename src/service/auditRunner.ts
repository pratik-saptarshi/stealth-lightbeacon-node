export interface EvaluationRequest {
  id: string;
  targetUrl: string;
  options: Record<string, unknown>;
  signal: AbortSignal;
}

export type EvaluationResult = Record<string, unknown>;

export type AuditRunner = (request: EvaluationRequest) => Promise<EvaluationResult>;

export const defaultAuditRunner: AuditRunner = async () => {
  throw new Error('Evaluation job execution is not implemented yet.');
};
