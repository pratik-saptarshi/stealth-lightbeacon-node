import * as cheerio from 'cheerio';
import type { CrawledPage } from './crawler';
import { SSRFGuard } from './ssrf';
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


export async function fetchHttpPage(url: string, guard: SSRFGuard, userAgent: string): Promise<CrawledPage> {
  const startTime = Date.now();
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'user-agent': userAgent
    },
    redirect: 'follow'
  });

  await guard.validate(response.url);
  const html = await response.text();
  const headers = Object.fromEntries(response.headers.entries());

  return {
    url: response.url,
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
