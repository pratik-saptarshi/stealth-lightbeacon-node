import { defaultAuditRunner, type AuditRunner, type EvaluationResult } from './auditRunner';

export type EvaluationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface EvaluationJobSnapshot {
  id: string;
  targetUrl: string;
  options: Record<string, unknown>;
  status: EvaluationStatus;
  createdAt: string;
  updatedAt: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface EvaluationJobStoreOptions {
  auditRunner?: AuditRunner;
  clock?: () => number;
}

interface EvaluationJob extends EvaluationJobSnapshot {
  result?: EvaluationResult;
}

export class EvaluationJobStore {
  private readonly auditRunner: AuditRunner;
  private readonly clock: () => number;
  private readonly jobs = new Map<string, EvaluationJob>();
  private sequence = 0;

  constructor(options: EvaluationJobStoreOptions = {}) {
    this.auditRunner = options.auditRunner ?? defaultAuditRunner;
    this.clock = options.clock ?? (() => Date.now());
  }

  create(targetUrl: string, options: Record<string, unknown> = {}): EvaluationJobSnapshot {
    const now = this.timestamp();
    const job: EvaluationJob = {
      id: this.nextId(),
      targetUrl,
      options,
      status: 'queued',
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(job.id, job);
    queueMicrotask(() => {
      void this.run(job);
    });
    return snapshot(job);
  }

  get(id: string): EvaluationJobSnapshot | undefined {
    const job = this.jobs.get(id);
    return job ? snapshot(job) : undefined;
  }

  getResult(id: string): { job?: EvaluationJobSnapshot; result?: EvaluationResult } {
    const job = this.jobs.get(id);
    if (!job) {
      return {};
    }
    return {
      job: snapshot(job),
      result: job.result
    };
  }

  private async run(job: EvaluationJob): Promise<void> {
    this.update(job, { status: 'running' });
    try {
      const result = await this.auditRunner({
        id: job.id,
        targetUrl: job.targetUrl,
        options: job.options
      });
      job.result = result;
      this.update(job, { status: 'succeeded' });
    } catch (error) {
      this.update(job, {
        status: 'failed',
        error: {
          code: 'evaluation_failed',
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private update(job: EvaluationJob, changes: Partial<EvaluationJob>): void {
    Object.assign(job, changes, { updatedAt: this.timestamp() });
  }

  private nextId(): string {
    this.sequence += 1;
    return `eval-${String(this.sequence).padStart(6, '0')}`;
  }

  private timestamp(): string {
    return new Date(this.clock()).toISOString();
  }
}

function snapshot(job: EvaluationJob): EvaluationJobSnapshot {
  return {
    id: job.id,
    targetUrl: job.targetUrl,
    options: job.options,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.error ? { error: job.error } : {})
  };
}
