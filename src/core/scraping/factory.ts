import { ObscuraEngine } from './obscura';
import { ZendriverEngine } from './zendriver';
import { fetchHttpPage } from '../fetcher';
import { SSRFGuard } from '../ssrf';
import type { CrawledPage } from '../crawler';
import { StealthMcpClient } from '../../mcp/client';

export interface ScraperOptions {
  engine?: 'http' | 'rendered' | 'fast' | 'stealth' | 'mcp';
  allowPrivate?: boolean;
  userAgent?: string;
  timeoutMs?: number;
}

export type ScraperFunction = (url: string) => Promise<CrawledPage>;

export function createScraper(options: ScraperOptions = {}): ScraperFunction {
  const engine = options.engine ?? 'http';
  const allowPrivate = options.allowPrivate ?? false;
  const userAgent = options.userAgent;
  const timeoutMs = options.timeoutMs ?? 30000;
  const guard = new SSRFGuard({ allowPrivate });

  switch (engine) {
    case 'mcp':
      const mcpClient = new StealthMcpClient();
      return async (url: string) => {
        await guard.validate(url);
        const result = await mcpClient.callTool('scrape', { url });
        return result as CrawledPage;
      };

    case 'stealth':
      const zendriver = new ZendriverEngine({ allowPrivate, userAgent, timeoutMs });
      return (url: string) => zendriver.scrape(url);

    case 'fast':
      const obscura = new ObscuraEngine({ allowPrivate });
      return (url: string) => obscura.scrape(url);

    case 'rendered':
      // Backwards compatible basic Playwright rendering
      const basicZendriver = new ZendriverEngine({ allowPrivate, userAgent, timeoutMs });
      return (url: string) => basicZendriver.scrape(url);

    case 'http':
    default:
      // Standard HTTP fetch client
      return async (url: string) => {
        await guard.validate(url);
        const defaultUA = userAgent ?? 'StealthLightbeaconNode/2.0';
        return fetchHttpPage(url, guard, defaultUA);
      };
  }
}
