import { z, type ZodType } from 'zod';
import { createDuckDbRuntime } from './db/duckdb';
import type { DuckDbRuntimeInput, DuckDbQueryInput } from './db/schemas';

interface CacheRow {
  cache_key: string;
  cached_at: number;
  payload_json: string;
}

export interface DuckDbJsonCacheOptions extends Partial<DuckDbRuntimeInput> {
  tableName?: string;
}

export class DuckDbJsonCache<T> {
  private runtimePromise: ReturnType<typeof createDuckDbRuntime> | null = null;

  constructor(
    private readonly databasePath: string,
    private readonly schema: ZodType<T>,
    private readonly options: DuckDbJsonCacheOptions = {}
  ) {}

  async get(key: string, ttlMs: number): Promise<T | null> {
    const runtime = await this.runtime();
    const result = await runtime.query(this.selectQuery(key));
    const row = result.rows[0] as unknown as CacheRow | undefined;
    if (!row) {
      console.log(`[Cache Miss] No entry found for key: ${key}`);
      return null;
    }

    if (Date.now() - Number(row.cached_at) > ttlMs) {
      console.log(`[Cache Miss] Stale entry rejected for key: ${key} (age: ${Date.now() - Number(row.cached_at)}ms > TTL: ${ttlMs}ms)`);
      return null;
    }

    console.log(`[Cache Hit] Serving cached entry for key: ${key}`);
    return this.schema.parse(JSON.parse(row.payload_json));
  }

  async set(key: string, value: T): Promise<void> {
    const runtime = await this.runtime();
    const payload = this.schema.parse(value);
    const cacheKey = this.normalizeKey(key);

    let delay = 25;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await runtime.exec({ sql: 'BEGIN TRANSACTION' });
        await runtime.exec(
          this.execQuery(`DELETE FROM ${this.tableName()} WHERE cache_key = ?`, [cacheKey])
        );
        await runtime.exec(
          this.execQuery(
            `INSERT INTO ${this.tableName()} (cache_key, cached_at, payload_json) VALUES (?, ?, ?)`,
            [cacheKey, String(Date.now()), JSON.stringify(payload)]
          )
        );
        await runtime.exec({ sql: 'COMMIT' });
        return;
      } catch (error) {
        try {
          await runtime.exec({ sql: 'ROLLBACK' });
        } catch {
          // Ignore rollback failure
        }
        if (!this.isContentionError(error) || attempt === 5) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  async close(): Promise<void> {
    if (this.runtimePromise) {
      const runtime = await this.runtimePromise;
      await runtime.close();
      this.runtimePromise = null;
    }
  }

  private async runtime(): Promise<Awaited<ReturnType<typeof createDuckDbRuntime>>> {
    if (!this.runtimePromise) {
      this.runtimePromise = createDuckDbRuntime({
        databasePath: this.databasePath,
        ...this.options
      });
    }

    const runtime = await this.runtimePromise;
    await runtime.query(
      this.execQuery(
        `CREATE TABLE IF NOT EXISTS ${this.tableName()} (
          cache_key VARCHAR PRIMARY KEY,
          cached_at BIGINT NOT NULL,
          payload_json VARCHAR NOT NULL
        )`
      )
    );
    return runtime;
  }

  private tableName(): string {
    return this.options.tableName ?? 'page_speed_cache';
  }

  private normalizeKey(key: string): string {
    return z.string().min(1).parse(key);
  }

  private selectQuery(key: string): DuckDbQueryInput {
    return this.execQuery(
      `SELECT cache_key, cached_at, payload_json
      FROM ${this.tableName()}
      WHERE cache_key = ?
      LIMIT 1`,
      [this.normalizeKey(key)]
    );
  }

  private execQuery(sql: string, params?: DuckDbQueryInput['params']): DuckDbQueryInput {
    return {
      params,
      sql,
      timeoutMs: this.options.timeoutMs ?? 2000
    };
  }

  private isContentionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('lock') || message.includes('busy') || message.includes('conflict') || message.includes('contention');
  }
}

export { DuckDbJsonCache as JsonFileCache };
