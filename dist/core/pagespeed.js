"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PageSpeedService = void 0;
const schemas_1 = require("./db/schemas");
const pagespeedCache_1 = require("./pagespeedCache");
const PAGE_SPEED_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_CACHE_PATH = '.cache/pagespeed.duckdb';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
class PageSpeedService {
    cacheTtlMs;
    cachePath;
    cache;
    cachePromise = null;
    constructor(options = {}) {
        this.cache = options.cache;
        this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
        this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    }
    async getSummary(url, apiKey) {
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
        apiUrl.searchParams.set('category', 'PERFORMANCE');
        apiUrl.searchParams.set('strategy', 'mobile');
        const headers = {};
        if (apiKey) {
            headers['X-Goog-Api-Key'] = apiKey;
        }
        let payload = null;
        let lastError = null;
        let delay = 1000;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const res = await fetch(apiUrl, { method: 'GET', headers });
                if (res.status === 429) {
                    throw new Error('HTTP 429 Rate Limited');
                }
                if (!res.ok) {
                    throw new Error(`PageSpeed API failed with HTTP ${res.status}`);
                }
                payload = (await res.json());
                break;
            }
            catch (err) {
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
        const lighthouseResult = payload.lighthouseResult;
        const audits = (lighthouseResult?.audits ?? {});
        const loadingExperience = payload.loadingExperience;
        const metrics = loadingExperience?.metrics;
        const lcpPercentile = extractPercentile(metrics, 'LARGEST_CONTENTFUL_PAINT_MS');
        const clsPercentile = extractPercentile(metrics, 'CUMULATIVE_LAYOUT_SHIFT_SCORE');
        const inpPercentile = extractPercentile(metrics, 'INTERACTION_TO_NEXT_PAINT');
        const ttfbPercentile = extractPercentile(metrics, 'EXPERIMENTAL_TIME_TO_FIRST_BYTE');
        const parseErrors = [];
        const lcpMs = lcpPercentile ?? extractAuditMetricMs(audits, 'largest-contentful-paint', 'lcpMs', parseErrors);
        const inpMs = inpPercentile ?? extractAuditMetricMs(audits, 'interaction-to-next-paint', 'inpMs', parseErrors);
        const clsScore = clsPercentile !== undefined
            ? clsPercentile / 100
            : extractAuditMetricNumber(audits, 'cumulative-layout-shift', 'clsScore', parseErrors);
        const ttfbMs = ttfbPercentile ?? extractAuditMetricMs(audits, 'server-response-time', 'ttfbMs', parseErrors);
        const fetchedAt = extractFetchTime(lighthouseResult, parseErrors);
        const summary = schemas_1.pageSpeedSummarySchema.parse({
            lighthousePerformanceScore: extractPerformanceScore(lighthouseResult),
            cwv: {
                lcp: extractDisplayValue(audits, 'largest-contentful-paint'),
                inp: extractDisplayValue(audits, 'interaction-to-next-paint'),
                cls: extractDisplayValue(audits, 'cumulative-layout-shift')
            },
            lcpMs,
            clsScore,
            inpMs,
            ttfbMs,
            fetchedAt,
            parseErrors: parseErrors.length > 0 ? parseErrors : undefined
        });
        await this.writeCacheWithRetry(cache, url, summary);
        return summary;
    }
    async close() {
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
    async getCache() {
        if (this.cache) {
            return this.cache;
        }
        if (!this.cachePromise) {
            this.cachePromise = Promise.resolve((0, pagespeedCache_1.createDuckDbPageSpeedCache)({ cachePath: this.cachePath }));
        }
        return this.cachePromise;
    }
    async writeCacheWithRetry(cache, url, summary) {
        let delay = 25;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await cache.set(url, summary);
                return;
            }
            catch (error) {
                if (!isContentionError(error) || attempt === 3) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }
}
exports.PageSpeedService = PageSpeedService;
function extractPerformanceScore(lighthouseResult) {
    const categories = lighthouseResult?.categories;
    const performance = categories?.performance;
    const score = performance?.score;
    return typeof score === 'number' ? Math.round(score * 100) : undefined;
}
function extractDisplayValue(audits, auditName) {
    const audit = audits[auditName];
    const displayValue = audit?.displayValue;
    return typeof displayValue === 'string' ? displayValue : undefined;
}
function extractAuditMetricMs(audits, auditName, fieldName, parseErrors) {
    const value = extractAuditNumericValue(audits, auditName);
    if (value !== undefined) {
        return value;
    }
    const displayValue = extractDisplayValue(audits, auditName);
    if (displayValue === undefined) {
        return undefined;
    }
    const parsed = parseLocalizedNumber(displayValue);
    if (parsed === undefined) {
        parseErrors.push(`${fieldName}:unparseable`);
        return undefined;
    }
    return /\bs\b/i.test(displayValue) && !/\bms\b/i.test(displayValue) ? parsed * 1000 : parsed;
}
function extractAuditMetricNumber(audits, auditName, fieldName, parseErrors) {
    const value = extractAuditNumericValue(audits, auditName);
    if (value !== undefined) {
        return value;
    }
    const displayValue = extractDisplayValue(audits, auditName);
    if (displayValue === undefined) {
        return undefined;
    }
    const parsed = parseLocalizedNumber(displayValue);
    if (parsed === undefined) {
        parseErrors.push(`${fieldName}:unparseable`);
    }
    return parsed;
}
function extractAuditNumericValue(audits, auditName) {
    const audit = audits[auditName];
    const numericValue = audit?.numericValue;
    return typeof numericValue === 'number' && Number.isFinite(numericValue) ? numericValue : undefined;
}
function parseLocalizedNumber(value) {
    const match = value.match(/[-+]?\d[\d.,\s]*/);
    if (!match) {
        return undefined;
    }
    const normalized = normalizeLocalizedNumber(match[0]);
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function normalizeLocalizedNumber(value) {
    const compact = value.replace(/\s/g, '');
    const lastComma = compact.lastIndexOf(',');
    const lastDot = compact.lastIndexOf('.');
    if (lastComma > lastDot) {
        return compact.replace(/\./g, '').replace(',', '.');
    }
    if (lastDot > lastComma) {
        return compact.replace(/,/g, '');
    }
    return compact.replace(',', '.');
}
function extractFetchTime(lighthouseResult, parseErrors) {
    const fetchTime = lighthouseResult?.fetchTime;
    if (typeof fetchTime !== 'string') {
        return undefined;
    }
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(fetchTime)) {
        parseErrors.push('fetchedAt:unparseable');
        return undefined;
    }
    const time = Date.parse(fetchTime);
    if (!Number.isFinite(time)) {
        parseErrors.push('fetchedAt:unparseable');
        return undefined;
    }
    return new Date(time).toISOString();
}
function extractPercentile(metrics, metricName) {
    const metric = metrics?.[metricName];
    const percentile = metric?.percentile;
    return typeof percentile === 'number' ? percentile : undefined;
}
function isContentionError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return message.includes('lock') || message.includes('busy') || message.includes('conflict');
}
