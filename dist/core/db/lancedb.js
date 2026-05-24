"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLanceDbRuntime = createLanceDbRuntime;
const node_perf_hooks_1 = require("node:perf_hooks");
const schemas_1 = require("./schemas");
const timeouts_1 = require("./timeouts");
async function loadLanceDbApi() {
    return (await Promise.resolve().then(() => __importStar(require('@lancedb/lancedb'))));
}
async function openLanceDbConnection(input) {
    const { connect } = await loadLanceDbApi();
    const options = {
        uri: input.uri
    };
    return connect(options);
}
async function openTable(connection, name) {
    return connection.openTable(name);
}
function toFloat32Vector(vector) {
    return Float32Array.from(vector);
}
async function createLanceDbRuntime(input = {}) {
    const parsed = schemas_1.lanceDbRuntimeInputSchema.parse(input);
    const connection = await openLanceDbConnection(parsed);
    let closed = false;
    return {
        connection,
        uri: parsed.uri,
        async close() {
            if (closed) {
                return;
            }
            closed = true;
            connection.close();
        },
        async createTable(tableInput) {
            const parsedInput = schemas_1.lanceDbCreateTableInputSchema.parse(tableInput);
            return (0, timeouts_1.withHardTimeout)(async () => {
                const startedAt = node_perf_hooks_1.performance.now();
                await connection.createTable({
                    data: parsedInput.data,
                    mode: parsedInput.mode,
                    name: parsedInput.name
                });
                return schemas_1.lanceDbCreateTableOutputSchema.parse({
                    elapsedMs: Math.round(node_perf_hooks_1.performance.now() - startedAt),
                    mode: parsedInput.mode,
                    ok: true,
                    rowCount: parsedInput.data.length,
                    table: parsedInput.name
                });
            }, {
                label: 'LanceDB createTable',
                timeoutMs: parsedInput.timeoutMs
            });
        },
        async insert(insertInput) {
            const parsedInput = schemas_1.lanceDbInsertInputSchema.parse(insertInput);
            const table = await openTable(connection, parsedInput.table);
            return (0, timeouts_1.withHardTimeout)(async () => {
                const startedAt = node_perf_hooks_1.performance.now();
                await table.add(parsedInput.data, { mode: 'append' });
                return schemas_1.lanceDbInsertOutputSchema.parse({
                    elapsedMs: Math.round(node_perf_hooks_1.performance.now() - startedAt),
                    ok: true,
                    rowCount: parsedInput.data.length,
                    table: parsedInput.table
                });
            }, {
                label: 'LanceDB insert',
                timeoutMs: parsedInput.timeoutMs
            });
        },
        async search(searchInput) {
            const parsedInput = schemas_1.lanceDbSearchInputSchema.parse(searchInput);
            const table = await openTable(connection, parsedInput.table);
            return (0, timeouts_1.withHardTimeout)(async () => {
                const startedAt = node_perf_hooks_1.performance.now();
                let query = table.vectorSearch(toFloat32Vector(parsedInput.vector));
                if (parsedInput.where) {
                    query = query.where(parsedInput.where);
                }
                const rows = await query.limit(parsedInput.limit).toArray();
                return schemas_1.lanceDbSearchOutputSchema.parse({
                    elapsedMs: Math.round(node_perf_hooks_1.performance.now() - startedAt),
                    ok: true,
                    rowCount: rows.length,
                    rows,
                    table: parsedInput.table
                });
            }, {
                label: 'LanceDB search',
                timeoutMs: parsedInput.timeoutMs
            });
        }
    };
}
