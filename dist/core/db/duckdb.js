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
exports.createDuckDbRuntime = createDuckDbRuntime;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_perf_hooks_1 = require("node:perf_hooks");
const schemas_1 = require("./schemas");
const timeouts_1 = require("./timeouts");
async function loadDuckDbApi() {
    return (await Promise.resolve().then(() => __importStar(require('@duckdb/node-api'))));
}
function createTempDirectory(tempDirectory) {
    if (tempDirectory) {
        (0, node_fs_1.mkdirSync)(tempDirectory, { recursive: true });
        return { owned: false, path: tempDirectory };
    }
    return {
        owned: true,
        path: (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), `stealth-lightbeacon-node-duckdb-${process.pid}-`))
    };
}
function resolveDuckDbOptions(input) {
    return {
        memory_limit: input.memoryLimit,
        temp_directory: input.tempDirectory ?? '',
        threads: String(input.threads)
    };
}
function normalizeParams(params) {
    if (!params) {
        return undefined;
    }
    return params;
}
async function readQueryResult(connection, input) {
    const startedAt = node_perf_hooks_1.performance.now();
    const result = await connection.runAndReadAll(input.sql, normalizeParams(input.params));
    const rows = await result.getRowObjectsJson();
    const output = {
        columns: result.columnNames(),
        elapsedMs: Math.round(node_perf_hooks_1.performance.now() - startedAt),
        rowCount: rows.length,
        rows
    };
    return schemas_1.duckDbQueryOutputSchema.parse(output);
}
async function runStatement(connection, input) {
    const startedAt = node_perf_hooks_1.performance.now();
    await connection.run(input.sql, normalizeParams(input.params));
    return schemas_1.duckDbExecOutputSchema.parse({
        elapsedMs: Math.round(node_perf_hooks_1.performance.now() - startedAt),
        ok: true,
        result: {},
        tool: 'duckdb.exec'
    });
}
async function createDuckDbRuntime(input = {}) {
    const parsed = schemas_1.duckDbRuntimeInputSchema.parse(input);
    const { DuckDBInstance } = await loadDuckDbApi();
    const tempDirectoryInfo = createTempDirectory(parsed.tempDirectory);
    const instance = await DuckDBInstance.create(parsed.databasePath, resolveDuckDbOptions({ ...parsed, tempDirectory: tempDirectoryInfo.path }));
    const connection = await instance.connect();
    let closed = false;
    return {
        connection,
        databasePath: parsed.databasePath,
        instance,
        tempDirectory: tempDirectoryInfo.path,
        async close() {
            if (closed) {
                return;
            }
            closed = true;
            try {
                await new Promise((resolve, reject) => {
                    setImmediate(() => {
                        try {
                            connection.disconnectSync();
                            resolve();
                        }
                        catch (err) {
                            reject(err);
                        }
                    });
                });
            }
            finally {
                await new Promise((resolve, reject) => {
                    setImmediate(() => {
                        try {
                            instance.closeSync();
                            resolve();
                        }
                        catch (err) {
                            reject(err);
                        }
                    });
                });
                if (tempDirectoryInfo.owned) {
                    (0, node_fs_1.rmSync)(tempDirectoryInfo.path, { force: true, recursive: true });
                }
            }
        },
        async query(queryInput) {
            const parsedQuery = schemas_1.duckDbQueryInputSchema.parse(queryInput);
            return (0, timeouts_1.withHardTimeout)(signal => {
                if (signal.aborted) {
                    throw signal.reason ?? new Error('DuckDB query aborted');
                }
                return readQueryResult(connection, parsedQuery);
            }, {
                label: 'DuckDB query',
                timeoutMs: parsedQuery.timeoutMs
            });
        },
        async exec(execInput) {
            const parsedExec = schemas_1.duckDbExecInputSchema.parse(execInput);
            return (0, timeouts_1.withHardTimeout)(signal => {
                if (signal.aborted) {
                    throw signal.reason ?? new Error('DuckDB statement aborted');
                }
                return runStatement(connection, parsedExec);
            }, {
                label: 'DuckDB statement',
                timeoutMs: parsedExec.timeoutMs
            });
        }
    };
}
