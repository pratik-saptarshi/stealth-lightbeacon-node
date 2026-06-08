import { PreAuditRecon, type ReconRecommendation } from '../core/recon';
import { SSRFGuard } from '../core/ssrf';

export interface ReconRequest {
  targetUrl: string;
  allowPrivate?: boolean;
}

export type ReconRunner = (request: ReconRequest) => Promise<ReconRecommendation>;

export const defaultReconRunner: ReconRunner = async (request) => {
  const guard = new SSRFGuard({ allowPrivate: Boolean(request.allowPrivate) });
  return new PreAuditRecon(guard).analyze(request.targetUrl);
};
