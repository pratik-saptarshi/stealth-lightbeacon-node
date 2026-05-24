"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonFileCache = exports.DuckDbJsonCache = void 0;
const zod_1 = require("zod");
const duckdb_1 = require("./db/duckdb");
class DuckDbJsonCache {
    databasePath;
    schema;
    options;
    runtimePromise = null;
    constructor(databasePath, schema, options = {}) {
        this.databasePath = databasePath;
        this.schema = schema;
        this.options = options;
    }
    async get(key, ttlMs) {
        const runtime = await this.runtime();
        const result = await runtime.query(this.selectQuery(key));
        const row = result.rows[0];
        if (!row) {
            return null;
        }
        if (Date.now() - Number(row.cached_at) > ttlMs) {
            return null;
        }
        return this.schema.parse(JSON.parse(row.payload_json));
    }
    async set(key, value) {
        const runtime = await this.runtime();
        const payload = this.schema.parse(value);
        const cacheKey = this.normalizeKey(key);
        await runtime.query(this.execQuery(`DELETE FROM ${this.tableName()} WHERE cache_key = ?`, [cacheKey]));
        await runtime.query(this.execQuery(`INSERT INTO ${this.tableName()} (cache_key, cached_at, payload_json) VALUES (?, ?, ?)`, [cacheKey, String(Date.now()), JSON.stringify(payload)]));
    }
    async close() {
        if (this.runtimePromise) {
            const runtime = await this.runtimePromise;
            await runtime.close();
            this.runtimePromise = null;
        }
    }
    async runtime() {
        if (!this.runtimePromise) {
            this.runtimePromise = (0, duckdb_1.createDuckDbRuntime)({
                databasePath: this.databasePath,
                ...this.options
            });
        }
        const runtime = await this.runtimePromise;
        await runtime.query(this.execQuery(`CREATE TABLE IF NOT EXISTS ${this.tableName()} (
          cache_key VARCHAR PRIMARY KEY,
        cached_at VARCHAR NOT NULL,
          payload_json VARCHAR NOT NULL
        )`));
        return runtime;
    }
    tableName() {
        return this.options.tableName ?? 'page_speed_cache';
    }
    normalizeKey(key) {
        return zod_1.z.string().min(1).parse(key);
    }
    selectQuery(key) {
        return this.execQuery(`SELECT cache_key, cached_at, payload_json
      FROM ${this.tableName()}
      WHERE cache_key = ?
      LIMIT 1`, [this.normalizeKey(key)]);
    }
    execQuery(sql, params) {
        return {
            params,
            sql,
            timeoutMs: this.options.timeoutMs ?? 2000
        };
    }
}
exports.DuckDbJsonCache = DuckDbJsonCache;
exports.JsonFileCache = DuckDbJsonCache;
