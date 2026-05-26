import { SSRFGuard } from '../ssrf';
import type { CrawledPage } from '../crawler';
import { BrowserPool } from './browserPool';
import { requestSecurePinned } from '../fetcher';

export interface ZendriverOptions {
  timeoutMs?: number;
  allowPrivate?: boolean;
  userAgent?: string;
}

export class ZendriverEngine {
  private readonly timeoutMs: number;
  private readonly allowPrivate: boolean;
  private readonly ssrfGuard: SSRFGuard;
  private readonly userAgent: string;

  constructor(options: ZendriverOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.allowPrivate = options.allowPrivate ?? false;
    this.ssrfGuard = new SSRFGuard({ allowPrivate: this.allowPrivate });
    this.userAgent = options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  async scrape(url: string): Promise<CrawledPage> {
    // 1. Pre-fetch SSRF validation
    await this.ssrfGuard.validate(url);
    const startTime = Date.now();
    
    const ctx = await BrowserPool.getInstance().acquireContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: this.userAgent,
      acceptDownloads: false,
      colorScheme: 'dark',
      deviceScaleFactor: 1,
      timezoneId: 'America/New_York'
    });
    try {
      // Bypass webdriver detection scripts
      await ctx.addInitScript(() => {
        // Override webdriver flag
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined
        });

        // Emulate standard plugins list length
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5] as unknown as PluginArray
        });

        // Emulate standard chrome runtime interface
        (window as any).chrome = {
          runtime: {}
        };

        // WebGL Fingerprint Spoofing
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (param: number) {
          // UNMASKED_VENDOR_WEBGL
          if (param === 37445) {
            return 'Intel Open Source Technology Center';
          }
          // UNMASKED_RENDERER_WEBGL
          if (param === 37446) {
            return 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)';
          }
          return getParameter.apply(this, arguments as any);
        };
      });

      const page = await ctx.newPage();

      // Navigate and wait for content
      const res = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.timeoutMs
      });

      const finalUrl = page.url();
      // 2. Post-navigation redirect SSRF validation
      await this.ssrfGuard.validate(finalUrl);

      const html = await page.content();
      const headers = res
        ? (Object.fromEntries(Object.entries(await res.allHeaders()).map(([k, v]) => [k.toLowerCase(), v])) as Record<string, string>)
        : {};

      return {
        url: finalUrl,
        html,
        headers,
        status: res?.status() ?? 200,
        responseTimeMs: Date.now() - startTime
      };
    } finally {
      await BrowserPool.getInstance().releaseContext(ctx);
    }
  }
}
