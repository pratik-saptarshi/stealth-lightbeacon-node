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
exports.crawlSite = crawlSite;
const cheerio = __importStar(require("cheerio"));
const duckdb_1 = require("./db/duckdb");
class Mutex {
    queue = [];
    locked = false;
    async acquire() {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise((resolve) => {
            this.queue.push(resolve);
        });
    }
    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                next();
            }
        }
        else {
            this.locked = false;
        }
    }
    async runExclusive(fn) {
        await this.acquire();
        try {
            return await fn();
        }
        finally {
            this.release();
        }
    }
}
async function crawlSite(options) {
    const start = new URL(options.startUrl);
    const concurrency = options.concurrency ?? 1;
    const throttleMs = options.throttleMs ?? 0;
    // Spin up a temporary DuckDB instance for persisted queue management
    const duck = await (0, duckdb_1.createDuckDbRuntime)({ databasePath: ':memory:' });
    await duck.exec({
        sql: `
      CREATE TABLE crawl_queue (
        url VARCHAR PRIMARY KEY,
        depth INTEGER,
        status VARCHAR DEFAULT 'pending'
      )
    `
    });
    const pages = [];
    const brokenPages = new Map();
    let activeCount = 0;
    const queueResolvers = [];
    const popMutex = new Mutex();
    const notifyQueueChanged = () => {
        while (queueResolvers.length > 0) {
            const resolve = queueResolvers.shift();
            if (resolve) {
                resolve();
            }
        }
    };
    // Seed the queue with the start URL
    const normalizedStart = normalizeUrl(start.toString());
    await duck.exec({
        sql: `INSERT INTO crawl_queue (url, depth, status) VALUES (?, ?, 'pending') ON CONFLICT DO NOTHING`,
        params: [normalizedStart, 0]
    });
    // Seed the queue with sitemap.xml entries if available
    const sitemapUrls = await fetchAndParseSitemap(options.startUrl, options.fetchPage);
    for (const sitemapUrl of sitemapUrls) {
        const norm = normalizeUrl(sitemapUrl);
        await duck.exec({
            sql: `INSERT INTO crawl_queue (url, depth, status) VALUES (?, ?, 'pending') ON CONFLICT DO NOTHING`,
            params: [norm, 0]
        });
    }
    const getCompletedCount = async () => {
        const res = await duck.query({
            sql: `SELECT COUNT(*) as count FROM crawl_queue WHERE status = 'completed'`
        });
        return Number(res.rows[0].count);
    };
    const getPendingCount = async () => {
        const res = await duck.query({
            sql: `SELECT COUNT(*) as count FROM crawl_queue WHERE status = 'pending'`
        });
        return Number(res.rows[0].count);
    };
    const nextEntry = async () => {
        while (true) {
            const completed = await getCompletedCount();
            if (completed >= options.maxUrls) {
                return null;
            }
            // 1. Try to pop atomically
            const popped = await popMutex.runExclusive(async () => {
                const result = await duck.query({
                    sql: `
            UPDATE crawl_queue 
            SET status = 'fetching' 
            WHERE url = (
              SELECT url FROM crawl_queue 
              WHERE status = 'pending' 
              ORDER BY depth ASC 
              LIMIT 1
            )
            RETURNING url, depth
          `
                });
                if (result.rows.length > 0) {
                    const row = result.rows[0];
                    return { url: row.url, depth: Number(row.depth) };
                }
                return null;
            });
            if (popped) {
                activeCount++;
                return popped;
            }
            // 2. If nothing was popped, check if we are finished
            if (activeCount === 0) {
                const pending = await getPendingCount();
                if (pending === 0) {
                    return null; // All workers idle and no pending work -> finished!
                }
            }
            // 3. Otherwise, wait for the queue to change
            await new Promise((resolve) => {
                queueResolvers.push(resolve);
            });
        }
    };
    const runWorker = async () => {
        while (true) {
            const completed = await getCompletedCount();
            if (completed >= options.maxUrls) {
                break;
            }
            const entry = await nextEntry();
            if (!entry) {
                break;
            }
            const normalizedUrl = normalizeUrl(entry.url);
            try {
                if (throttleMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, throttleMs));
                }
                const page = await options.fetchPage(normalizedUrl);
                if (page.status >= 200 && page.status < 300) {
                    await duck.exec({
                        sql: `UPDATE crawl_queue SET status = 'completed' WHERE url = ?`,
                        params: [normalizedUrl]
                    });
                    pages.push(page);
                    const currentCompleted = await getCompletedCount();
                    if (entry.depth < options.maxDepth && currentCompleted < options.maxUrls) {
                        const discovered = discoverInternalLinks(page.html, normalizedUrl, start.hostname);
                        for (const link of discovered) {
                            const normLink = normalizeUrl(link);
                            await duck.exec({
                                sql: `INSERT INTO crawl_queue (url, depth, status) VALUES (?, ?, 'pending') ON CONFLICT DO NOTHING`,
                                params: [normLink, entry.depth + 1]
                            });
                        }
                    }
                }
                else {
                    await duck.exec({
                        sql: `UPDATE crawl_queue SET status = 'failed' WHERE url = ?`,
                        params: [normalizedUrl]
                    });
                    brokenPages.set(normalizedUrl, page.status);
                }
            }
            catch {
                await duck.exec({
                    sql: `UPDATE crawl_queue SET status = 'failed' WHERE url = ?`,
                    params: [normalizedUrl]
                });
                brokenPages.set(normalizedUrl, 0);
            }
            finally {
                activeCount--;
                notifyQueueChanged();
            }
        }
    };
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(runWorker());
    }
    await Promise.all(workers);
    await duck.close();
    return { pages, brokenPages };
}
async function fetchAndParseSitemap(startUrl, fetchPage) {
    try {
        const sitemapUrl = new URL('/sitemap.xml', startUrl).toString();
        const page = await fetchPage(sitemapUrl);
        if (page.status === 200) {
            const urls = [];
            const $ = cheerio.load(page.html, { xmlMode: true });
            $('loc').each((_, element) => {
                const text = $(element).text().trim();
                if (text) {
                    urls.push(text);
                }
            });
            return urls;
        }
    }
    catch {
        // Ignore sitemap fetch errors gracefully
    }
    return [];
}
function discoverInternalLinks(html, baseUrl, hostname) {
    const $ = cheerio.load(html);
    const discovered = new Set();
    $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
            try {
                const url = new URL(href, baseUrl);
                if (url.hostname === hostname && url.protocol.startsWith('http')) {
                    discovered.add(normalizeUrl(url.toString()));
                }
            }
            catch {
                // Skip invalid URLs
            }
        }
    });
    return [...discovered];
}
function normalizeUrl(urlValue) {
    const parsed = new URL(urlValue);
    parsed.hash = '';
    parsed.search = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
}
