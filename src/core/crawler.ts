import * as cheerio from 'cheerio';

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

interface QueueEntry {
  url: string;
  depth: number;
}

export async function crawlSite(options: CrawlSiteOptions): Promise<CrawlResult> {
  const start = new URL(options.startUrl);
  const queue: QueueEntry[] = [{ url: start.toString(), depth: 0 }];
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const brokenPages = new Map<string, number>();

  const concurrency = options.concurrency ?? 1;
  const throttleMs = options.throttleMs ?? 0;

  // Track start URL as visited
  visited.add(normalizeUrl(start.toString()));

  let activeCount = 0;
  const queueResolvers: (() => void)[] = [];

  const notifyQueueChanged = () => {
    while (queueResolvers.length > 0) {
      const resolve = queueResolvers.shift();
      if (resolve) {
        resolve();
      }
    }
  };

  const nextEntry = async (): Promise<QueueEntry | null> => {
    while (queue.length === 0) {
      if (activeCount === 0 || pages.length >= options.maxUrls) {
        return null;
      }
      await new Promise<void>((resolve) => {
        queueResolvers.push(resolve);
      });
    }
    const item = queue.shift() || null;
    if (item) {
      activeCount++;
    }
    return item;
  };

  const runWorker = async () => {
    while (pages.length < options.maxUrls) {
      const entry = await nextEntry();
      if (!entry) {
        break;
      }

      try {
        const normalizedUrl = normalizeUrl(entry.url);

        if (throttleMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, throttleMs));
        }

        const page = await options.fetchPage(normalizedUrl);

        if (page.status >= 200 && page.status < 300) {
          pages.push(page);

          if (entry.depth < options.maxDepth && pages.length < options.maxUrls) {
            const discovered = discoverInternalLinks(page.html, normalizedUrl, start.hostname);
            for (const link of discovered) {
              if (pages.length + queue.length >= options.maxUrls) {
                break;
              }

              if (!visited.has(link)) {
                visited.add(link);
                queue.push({ url: link, depth: entry.depth + 1 });
              }
            }
          }
        } else {
          brokenPages.set(normalizedUrl, page.status);
        }
      } catch (err) {
        // Ignore fetch errors during crawl
      } finally {
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

  return { pages, brokenPages };
}

function discoverInternalLinks(html: string, baseUrl: string, hostname: string): string[] {
  const $ = cheerio.load(html);
  const discovered = new Set<string>();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) {
      return;
    }

    try {
      const url = new URL(href, baseUrl);
      if (url.hostname !== hostname) {
        return;
      }

      discovered.add(normalizeUrl(url.toString()));
    } catch {
      return;
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
