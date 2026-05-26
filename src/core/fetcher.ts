import * as cheerio from 'cheerio';
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import { isIP } from 'node:net';
import type { CrawledPage } from './crawler';
import { SSRFGuard, getSSRFGuardAgents } from './ssrf';
import { createScraper } from './scraping/factory';

export interface FetchPageOptions {
  allowPrivate?: boolean;
  engine?: 'http' | 'rendered' | 'fast' | 'stealth';
  userAgent?: string;
}

const DEFAULT_USER_AGENT = 'StealthLightbeaconNode/2.0';

export function createFetchPage(options: FetchPageOptions = {}): (url: string) => Promise<CrawledPage> {
  return createScraper(options);
}

export interface PinnedRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  pinnedIp?: string;
  guard?: SSRFGuard;
}

export function requestSecurePinned(
  urlStr: string,
  options: PinnedRequestOptions
): Promise<{ status: number; headers: Record<string, string>; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const host = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);

    const client = isHttps ? https : http;
    const reqOptions: https.RequestOptions = {
      method: options.method ?? 'GET',
      hostname: host,
      port,
      path: parsed.pathname + parsed.search,
      headers: options.headers,
      rejectUnauthorized: true
    };

    const guard = options.guard ?? new SSRFGuard();
    const agents = getSSRFGuardAgents(guard);
    reqOptions.agent = isHttps ? agents.httpsAgent : agents.httpAgent;

    const req = client.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const headers: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (Array.isArray(val)) {
            headers[key] = val.join(', ');
          } else if (val !== undefined) {
            headers[key] = val;
          }
        }
        resolve({
          status: res.statusCode ?? 200,
          headers,
          text: async () => bodyText
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

function normalizeLookupOptions(
  opts: number | dns.LookupOneOptions | dns.LookupAllOptions
): dns.LookupOneOptions {
  if (typeof opts === 'number') {
    return { family: opts };
  }
  return {
    family: opts.family,
    hints: opts.hints,
    verbatim: opts.verbatim
  };
}

function normalizeLookupAllOptions(
  opts: dns.LookupOneOptions | dns.LookupAllOptions
): dns.LookupAllOptions {
  return {
    family: opts.family,
    hints: opts.hints,
    verbatim: opts.verbatim,
    all: true
  };
}

export async function fetchHttpPage(
  url: string,
  guard: SSRFGuard,
  userAgent: string,
  maxRedirects = 5
): Promise<CrawledPage> {
  const startTime = Date.now();
  let currentUrl = url;
  let redirectsFollowed = 0;
  let response: { status: number; headers: Record<string, string>; text: () => Promise<string> };

  while (true) {
    await guard.validate(currentUrl);
    const parsed = new URL(currentUrl);
    const host = parsed.hostname;
    const pinnedIp = guard.getPinnedAddress(host);

    const requestHeaders: Record<string, string> = {
      'user-agent': userAgent
    };

    response = await requestSecurePinned(currentUrl, {
      method: 'GET',
      headers: requestHeaders,
      pinnedIp: pinnedIp ?? undefined,
      guard
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers['location'];
      if (!location) {
        break;
      }
      redirectsFollowed++;
      if (redirectsFollowed > maxRedirects) {
        throw new Error(`Max redirects (${maxRedirects}) exceeded`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    break;
  }

  const html = await response.text();
  const headers = { ...response.headers };

  return {
    url: currentUrl,
    html,
    headers,
    status: response.status,
    responseTimeMs: Date.now() - startTime
  };
}

async function renderPage(url: string, guard: SSRFGuard, userAgent: string): Promise<CrawledPage> {
  let playwrightModule: { chromium: { launch: (options: Record<string, unknown>) => Promise<any> } };
  try {
    playwrightModule = await new Function('return import("playwright-core")')();
  } catch {
    throw new Error("Rendered audits require the 'playwright-core' package to be installed.");
  }

  const startTime = Date.now();
  const browser = await playwrightModule.chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN
  });

  try {
    const page = await browser.newPage({ userAgent });

    // Validate every request dynamically before loading
    await page.route('**/*', async (route: any) => {
      try {
        await guard.validate(route.request().url());
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });

    const response = await page.goto(url, { waitUntil: 'networkidle' });
    const finalUrl = page.url();
    await guard.validate(finalUrl);
    const html = await page.content();

    const headers = response ? normalizeHeaderEntries(await response.allHeaders()) : {};

    return {
      url: finalUrl,
      html,
      headers,
      status: response?.status() ?? 200,
      responseTimeMs: Date.now() - startTime
    };
  } finally {
    await browser.close();
  }
}

function normalizeHeaderEntries(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

export function discoverBrokenLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) {
      return;
    }

    try {
      const url = new URL(href, baseUrl);
      if (url.protocol.startsWith('http')) {
        links.add(url.toString());
      }
    } catch {
      return;
    }
  });

  return [...links];
}

export async function secureFetch(
  urlStr: string,
  options: { method?: string; headers?: Record<string, string>; guard?: SSRFGuard } = {}
): Promise<{ ok: boolean; status: number; headers: Record<string, string>; text: () => Promise<string>; json: () => Promise<any> }> {
  const guard = options.guard ?? new SSRFGuard();
  await guard.validate(urlStr);
  const parsed = new URL(urlStr);
  const pinnedIp = guard.getPinnedAddress(parsed.hostname);

  const res = await requestSecurePinned(urlStr, {
    method: options.method,
    headers: options.headers,
    pinnedIp: pinnedIp ?? undefined,
    guard
  });

  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    headers: res.headers,
    text: () => res.text(),
    json: async () => JSON.parse(await res.text())
  };
}

