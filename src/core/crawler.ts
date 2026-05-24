import * as cheerio from 'cheerio';
import { createDuckDbRuntime } from './db/duckdb';

class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        next();
      }
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export interface CrawledPage {
  url: string;
  html: string;
  headers: Record<string, string | string[] | undefined>;
  status: number;
  responseTimeMs: number;
}

export interface CrawlSiteOptions {
  startUrl: string;
  maxDepth: number;
  maxUrls: number;
  fetchPage: (url: string) => Promise<CrawledPage>;
  concurrency?: number;
  throttleMs?: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  brokenPages: Map<string, number>;
}

export async function crawlSite(options: CrawlSiteOptions): Promise<CrawlResult> {
  const start = new URL(options.startUrl);
  const concurrency = options.concurrency ?? 1;
  const throttleMs = options.throttleMs ?? 0;

  // Spin up a temporary DuckDB instance for persisted queue management
  const duck = await createDuckDbRuntime({ databasePath: ':memory:' });
  
  await duck.exec({
    sql: `
      CREATE TABLE crawl_queue (
        url VARCHAR PRIMARY KEY,
        depth INTEGER,
        status VARCHAR DEFAULT 'pending'
      )
    `
  });

  const pages: CrawledPage[] = [];
  const brokenPages = new Map<string, number>();
  let activeCount = 0;
  const queueResolvers: (() => void)[] = [];
  const popMutex = new Mutex();
  const activeProcessingUrls = new Set<string>();

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

  const getCompletedCount = async (): Promise<number> => {
    const res = await duck.query({
      sql: `SELECT COUNT(*) as count FROM crawl_queue WHERE status = 'completed'`
    });
    return Number(res.rows[0].count);
  };

  const getPendingCount = async (): Promise<number> => {
    const res = await duck.query({
      sql: `SELECT COUNT(*) as count FROM crawl_queue WHERE status = 'pending'`
    });
    return Number(res.rows[0].count);
  };

  const nextEntry = async (): Promise<{ url: string; depth: number } | null> => {
    return await popMutex.runExclusive(async () => {
      while (true) {
        const completed = await getCompletedCount();
        if (completed >= options.maxUrls) {
          return null;
        }

        const pending = await getPendingCount();
        if (pending === 0) {
          if (activeCount === 0) {
            return null;
          }
          popMutex.release();
          await new Promise<void>((resolve) => {
            queueResolvers.push(resolve);
          });
          await popMutex.acquire();
          continue;
        }

        const result = await duck.query({
          sql: `
            SELECT url, depth 
            FROM crawl_queue 
            WHERE status = 'pending' 
            ORDER BY depth ASC
          `
        });

        const pendingRow = result.rows.find(row => !activeProcessingUrls.has(row.url as string));
        if (!pendingRow) {
          if (activeCount === 0) {
            return null;
          }
          popMutex.release();
          await new Promise<void>((resolve) => {
            queueResolvers.push(resolve);
          });
          await popMutex.acquire();
          continue;
        }

        const targetUrl = pendingRow.url as string;
        activeProcessingUrls.add(targetUrl);

        await duck.exec({
          sql: `UPDATE crawl_queue SET status = 'fetching' WHERE url = ?`,
          params: [targetUrl]
        });

        activeCount++;
        return { url: targetUrl, depth: Number(pendingRow.depth) };
      }
    });
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
        } else {
          await duck.exec({
            sql: `UPDATE crawl_queue SET status = 'failed' WHERE url = ?`,
            params: [normalizedUrl]
          });
          brokenPages.set(normalizedUrl, page.status);
        }
      } catch {
        await duck.exec({
          sql: `UPDATE crawl_queue SET status = 'failed' WHERE url = ?`,
          params: [normalizedUrl]
        });
        brokenPages.set(normalizedUrl, 0);
      } finally {
        activeProcessingUrls.delete(normalizedUrl);
        activeCount--;
        notifyQueueChanged();
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
  await duck.close();

  return { pages, brokenPages };
}

async function fetchAndParseSitemap(
  startUrl: string,
  fetchPage: (url: string) => Promise<CrawledPage>
): Promise<string[]> {
  try {
    const sitemapUrl = new URL('/sitemap.xml', startUrl).toString();
    const page = await fetchPage(sitemapUrl);
    if (page.status === 200) {
      const urls: string[] = [];
      const $ = cheerio.load(page.html, { xmlMode: true });
      $('loc').each((_, element) => {
        const text = $(element).text().trim();
        if (text) {
          urls.push(text);
        }
      });
      return urls;
    }
  } catch {
    // Ignore sitemap fetch errors gracefully
  }
  return [];
}

function discoverInternalLinks(html: string, baseUrl: string, hostname: string): string[] {
  const $ = cheerio.load(html);
  const discovered = new Set<string>();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      try {
        const url = new URL(href, baseUrl);
        if (url.hostname === hostname && url.protocol.startsWith('http')) {
          discovered.add(normalizeUrl(url.toString()));
        }
      } catch {
        // Skip invalid URLs
      }
    }
  });

  return [...discovered];
}

function normalizeUrl(urlValue: string): string {
  const parsed = new URL(urlValue);
  parsed.hash = '';
  parsed.search = '';
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}
