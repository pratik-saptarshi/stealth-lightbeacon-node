import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  statePath?: string;
}

interface EvaluationJob extends EvaluationJobSnapshot {
  result?: EvaluationResult;
}

export class EvaluationJobStore {
  private readonly auditRunner: AuditRunner;
  private readonly clock: () => number;
  private readonly statePath?: string;
  private readonly jobs = new Map<string, EvaluationJob>();
  private sequence = 0;
  readonly recoveryError?: {
    code: string;
    message: string;
  };

  constructor(options: EvaluationJobStoreOptions = {}) {
    this.auditRunner = options.auditRunner ?? defaultAuditRunner;
    this.clock = options.clock ?? (() => Date.now());
    this.statePath = options.statePath;
    this.recoveryError = this.load();
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
      this.persist();
    } catch (error) {
      this.update(job, {
        status: 'failed',
        error: {
          code: 'evaluation_failed',
          message: error instanceof Error ? error.message : String(error)
        }
      });
      this.persist();
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

  private load(): { code: string; message: string } | undefined {
    if (!this.statePath || !existsSync(this.statePath)) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as unknown;
      if (!isPersistedState(parsed)) {
        throw new Error('Invalid job state shape');
      }
      this.sequence = parsed.sequence;
      for (const job of parsed.jobs) {
        this.jobs.set(job.id, job);
      }
      return undefined;
    } catch (error) {
      return {
        code: 'state_recovery_failed',
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private persist(): void {
    if (!this.statePath) {
      return;
    }
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify({
      sequence: this.sequence,
      jobs: Array.from(this.jobs.values())
        .filter((job) => job.status === 'succeeded' || job.status === 'failed')
    }));
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

function isPersistedState(value: unknown): value is { sequence: number; jobs: EvaluationJob[] } {
  return Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { sequence?: unknown }).sequence === 'number' &&
    Array.isArray((value as { jobs?: unknown }).jobs);
}
