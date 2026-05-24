import { DuckDbJsonCache } from './cache';
import { pageSpeedSummarySchema, type PageSpeedSummary as PageSpeedSummaryShape } from './db/schemas';

export type PageSpeedSummary = PageSpeedSummaryShape;

const PAGE_SPEED_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_CACHE_PATH = '.cache/pagespeed.duckdb';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface PageSpeedServiceOptions {
  cache?: DuckDbJsonCache<PageSpeedSummary>;
  cachePath?: string;
  cacheTtlMs?: number;
}

export class PageSpeedService {
  private readonly cacheTtlMs: number;
  private readonly cachePath: string;
  private readonly cache?: DuckDbJsonCache<PageSpeedSummary>;
  private cachePromise: Promise<DuckDbJsonCache<PageSpeedSummary>> | null = null;

  constructor(options: PageSpeedServiceOptions = {}) {
    this.cache = options.cache;
    this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async getSummary(url: string, apiKey?: string): Promise<PageSpeedSummary | null> {
    const cache = await this.getCache();
    const cached = await cache.get(url, this.cacheTtlMs);
    if (cached) {
      return cached;
    }

    if (!apiKey) {
      return null;
    }

    const apiUrl = new URL(PAGE_SPEED_API_URL);
    apiUrl.searchParams.set('url', url);
    apiUrl.searchParams.set('key', apiKey);
    apiUrl.searchParams.set('category', 'PERFORMANCE');
    apiUrl.searchParams.set('strategy', 'mobile');

    let payload: Record<string, unknown> | null = null;
    let lastError: Error | null = null;
    let delay = 1000;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(apiUrl, { method: 'GET' });
        if (res.status === 429) {
          throw new Error('HTTP 429 Rate Limited');
        }
        if (!res.ok) {
          throw new Error(`PageSpeed API failed with HTTP ${res.status}`);
        }
        payload = (await res.json()) as Record<string, unknown>;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }

    if (!payload) {
      throw lastError ?? new Error('PageSpeed request failed');
    }

    const lighthouseResult = payload.lighthouseResult as Record<string, unknown> | undefined;
    const audits = (lighthouseResult?.audits ?? {}) as Record<string, unknown>;
    
    const loadingExperience = payload.loadingExperience as Record<string, any> | undefined;
    const metrics = loadingExperience?.metrics as Record<string, any> | undefined;

    const lcpPercentile = extractPercentile(metrics, 'LARGEST_CONTENTFUL_PAINT_MS');
    const clsPercentile = extractPercentile(metrics, 'CUMULATIVE_LAYOUT_SHIFT_SCORE');
    const inpPercentile = extractPercentile(metrics, 'INTERACTION_TO_NEXT_PAINT');
    const ttfbPercentile = extractPercentile(metrics, 'EXPERIMENTAL_TIME_TO_FIRST_BYTE');

    const summary = pageSpeedSummarySchema.parse({
      lighthousePerformanceScore: extractPerformanceScore(lighthouseResult),
      cwv: {
        lcp: extractDisplayValue(audits, 'largest-contentful-paint'),
        inp: extractDisplayValue(audits, 'interaction-to-next-paint'),
        cls: extractDisplayValue(audits, 'cumulative-layout-shift')
      },
      lcpMs: lcpPercentile,
      clsScore: clsPercentile !== undefined ? clsPercentile / 100 : undefined,
      inpMs: inpPercentile,
      ttfbMs: ttfbPercentile
    });

    await cache.set(url, summary);
    return summary;
  }

  async close(): Promise<void> {
    if (this.cache) {
      await this.cache.close();
      return;
    }

    if (this.cachePromise) {
      const cache = await this.cachePromise;
      await cache.close();
      this.cachePromise = null;
    }
  }

  private async getCache(): Promise<DuckDbJsonCache<PageSpeedSummary>> {
    if (this.cache) {
      return this.cache;
    }

    if (!this.cachePromise) {
      this.cachePromise = Promise.resolve(
        new DuckDbJsonCache(this.cachePath, pageSpeedSummarySchema)
      );
    }

    return this.cachePromise;
  }
}

function extractPerformanceScore(
  lighthouseResult: Record<string, unknown> | undefined
): number | undefined {
  const categories = lighthouseResult?.categories as Record<string, unknown> | undefined;
  const performance = categories?.performance as Record<string, unknown> | undefined;
  const score = performance?.score;

  return typeof score === 'number' ? Math.round(score * 100) : undefined;
}

function extractDisplayValue(
  audits: Record<string, unknown>,
  auditName: string
): string | undefined {
  const audit = audits[auditName] as Record<string, unknown> | undefined;
  const displayValue = audit?.displayValue;

  return typeof displayValue === 'string' ? displayValue : undefined;
}

function extractPercentile(
  metrics: Record<string, any> | undefined,
  metricName: string
): number | undefined {
  const metric = metrics?.[metricName] as Record<string, any> | undefined;
  const percentile = metric?.percentile;
  return typeof percentile === 'number' ? percentile : undefined;
}
