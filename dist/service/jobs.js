"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvaluationJobStore = void 0;
const auditRunner_1 = require("./auditRunner");
class EvaluationJobStore {
    auditRunner;
    clock;
    jobs = new Map();
    sequence = 0;
    constructor(options = {}) {
        this.auditRunner = options.auditRunner ?? auditRunner_1.defaultAuditRunner;
        this.clock = options.clock ?? (() => Date.now());
    }
    create(targetUrl, options = {}) {
        const now = this.timestamp();
        const job = {
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
    get(id) {
        const job = this.jobs.get(id);
        return job ? snapshot(job) : undefined;
    }
    getResult(id) {
        const job = this.jobs.get(id);
        if (!job) {
            return {};
        }
        return {
            job: snapshot(job),
            result: job.result
        };
    }
    async run(job) {
        this.update(job, { status: 'running' });
        try {
            const result = await this.auditRunner({
                targetUrl: job.targetUrl,
                options: job.options
            });
            job.result = result;
            this.update(job, { status: 'succeeded' });
        }
        catch (error) {
            this.update(job, {
                status: 'failed',
                error: {
                    code: 'evaluation_failed',
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
    update(job, changes) {
        Object.assign(job, changes, { updatedAt: this.timestamp() });
    }
    nextId() {
        this.sequence += 1;
        return `eval-${String(this.sequence).padStart(6, '0')}`;
    }
    timestamp() {
        return new Date(this.clock()).toISOString();
    }
}
exports.EvaluationJobStore = EvaluationJobStore;
function snapshot(job) {
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
