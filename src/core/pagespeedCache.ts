import { DuckDbJsonCache } from './cache';
import { pageSpeedSummarySchema, type PageSpeedSummary } from './db/schemas';

export interface PageSpeedCache {
  get(key: string, ttlMs: number): Promise<PageSpeedSummary | null>;
  set(key: string, value: PageSpeedSummary): Promise<void>;
  close(): Promise<void>;
}

export interface CreatePageSpeedCacheOptions {
  cachePath: string;
}

export function createDuckDbPageSpeedCache(options: CreatePageSpeedCacheOptions): PageSpeedCache {
  const cache = new DuckDbJsonCache<PageSpeedSummary>(options.cachePath, pageSpeedSummarySchema);
  return {
    get: (key, ttlMs) => cache.get(key, ttlMs),
    set: (key, value) => cache.set(key, value),
    close: () => cache.close()
  };
}
