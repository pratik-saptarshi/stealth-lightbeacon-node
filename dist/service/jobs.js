"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvaluationJobStore = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const auditRunner_1 = require("./auditRunner");
class EvaluationJobStore {
    auditRunner;
    clock;
    statePath;
    jobs = new Map();
    sequence = 0;
    recoveryError;
    constructor(options = {}) {
        this.auditRunner = options.auditRunner ?? auditRunner_1.defaultAuditRunner;
        this.clock = options.clock ?? (() => Date.now());
        this.statePath = options.statePath;
        this.recoveryError = this.load();
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
                id: job.id,
                targetUrl: job.targetUrl,
                options: job.options
            });
            job.result = result;
            this.update(job, { status: 'succeeded' });
            this.persist();
        }
        catch (error) {
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
    load() {
        if (!this.statePath || !(0, node_fs_1.existsSync)(this.statePath)) {
            return undefined;
        }
        try {
            const parsed = JSON.parse((0, node_fs_1.readFileSync)(this.statePath, 'utf8'));
            if (!isPersistedState(parsed)) {
                throw new Error('Invalid job state shape');
            }
            this.sequence = parsed.sequence;
            for (const job of parsed.jobs) {
                this.jobs.set(job.id, job);
            }
            return undefined;
        }
        catch (error) {
            return {
                code: 'state_recovery_failed',
                message: error instanceof Error ? error.message : String(error)
            };
        }
    }
    persist() {
        if (!this.statePath) {
            return;
        }
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.statePath), { recursive: true });
        (0, node_fs_1.writeFileSync)(this.statePath, JSON.stringify({
            sequence: this.sequence,
            jobs: Array.from(this.jobs.values())
                .filter((job) => job.status === 'succeeded' || job.status === 'failed')
        }));
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
function isPersistedState(value) {
    return Boolean(value) &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.sequence === 'number' &&
        Array.isArray(value.jobs);
}
