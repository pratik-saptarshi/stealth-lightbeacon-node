"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbTimeoutError = exports.DEFAULT_DB_TIMEOUT_MS = void 0;
exports.withHardTimeout = withHardTimeout;
exports.DEFAULT_DB_TIMEOUT_MS = 2000;
class DbTimeoutError extends Error {
    timeoutMs;
    constructor(timeoutMs, label = 'DB operation') {
        super(`${label} timed out after ${timeoutMs}ms`);
        this.name = 'DbTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}
exports.DbTimeoutError = DbTimeoutError;
function toAbortError(label, reason) {
    if (reason instanceof Error) {
        return reason;
    }
    return new Error(`${label} aborted`);
}
async function withHardTimeout(operation, options = {}) {
    const timeoutMs = options.timeoutMs ?? exports.DEFAULT_DB_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('timeoutMs must be a positive finite number');
    }
    const label = options.label ?? 'DB operation';
    const controller = new AbortController();
    const externalSignal = options.signal;
    let timeoutId;
    let removeAbortListener;
    const operationPromise = Promise.resolve().then(() => operation(controller.signal));
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            const error = new DbTimeoutError(timeoutMs, label);
            controller.abort(error);
            reject(error);
        }, timeoutMs);
        if (typeof timeoutId !== 'number') {
            timeoutId.unref();
        }
    });
    const abortPromise = externalSignal
        ? new Promise((_, reject) => {
            const onAbort = () => {
                const error = toAbortError(label, externalSignal.reason);
                controller.abort(error);
                reject(error);
            };
            if (externalSignal.aborted) {
                onAbort();
                return;
            }
            externalSignal.addEventListener('abort', onAbort, { once: true });
            removeAbortListener = () => externalSignal.removeEventListener('abort', onAbort);
        })
        : null;
    try {
        const race = abortPromise
            ? Promise.race([operationPromise, timeoutPromise, abortPromise])
            : Promise.race([operationPromise, timeoutPromise]);
        return await race;
    }
    finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        removeAbortListener?.();
    }
}
