"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbRuntimeDefaultsSchema = exports.dbRuntimeContextSchema = void 0;
exports.resolveDbRuntimeInput = resolveDbRuntimeInput;
exports.createDbRuntimeContext = createDbRuntimeContext;
exports.resolveDbTimeoutMs = resolveDbTimeoutMs;
const zod_1 = require("zod");
const schemas_1 = require("./schemas");
const timeouts_1 = require("./timeouts");
exports.dbRuntimeContextSchema = schemas_1.dbRuntimeInputSchema;
function resolveDbRuntimeInput(input = {}) {
    return schemas_1.dbRuntimeInputSchema.parse(input);
}
function createDbRuntimeContext(input = {}) {
    const parsed = resolveDbRuntimeInput(input);
    const controller = new AbortController();
    return {
        abort(reason) {
            controller.abort(reason);
        },
        signal: controller.signal,
        timeoutMs: parsed.timeoutMs
    };
}
function resolveDbTimeoutMs(input = {}) {
    const parsed = schemas_1.dbRuntimeInputSchema.parse(input);
    return parsed.timeoutMs;
}
exports.dbRuntimeDefaultsSchema = zod_1.z
    .object({
    timeoutMs: zod_1.z.number().int().positive().default(timeouts_1.DEFAULT_DB_TIMEOUT_MS)
})
    .strict();
