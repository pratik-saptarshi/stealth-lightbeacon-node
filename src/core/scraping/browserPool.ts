import type { Browser } from 'playwright-core';
import { SecureProxy } from './secureProxy';
import { SSRFGuard } from '../ssrf';

export class BrowserPool {
  private static instance: BrowserPool | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private browser: Browser | null = null;
  private proxy: SecureProxy | null = null;
  private readonly guard: SSRFGuard;
  private activeContexts = 0;
  private contextQueue: (() => void)[] = [];
  private readonly MAX_CONTEXTS = 10;

  private constructor() {
    this.guard = new SSRFGuard({ allowPrivate: false });
  }

  public static getInstance(): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool();
    }
    return BrowserPool.instance;
  }

  public async getBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    if (this.browserPromise) {
      return this.browserPromise;
    }

    let playwrightModule: any;
    try {
      playwrightModule = await new Function('return import("playwright-core")')();
    } catch {
      throw new Error(
        "Playwright is not installed. Zendriver engine requires the 'playwright-core' pkg.\n" +
        "To install it, run: npm install playwright-core"
      );
    }

    // Start secure proxy first
    this.proxy = new SecureProxy(this.guard);
    const proxyPort = await this.proxy.start();

    this.browserPromise = playwrightModule.chromium.launch({
      executablePath: process.env.CHROME_BIN,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--disable-setuid-sandbox',
        '--single-process',
        `--proxy-server=http://127.0.0.1:${proxyPort}`
      ]
    }).then((b: any) => {
      this.browser = b as Browser;
      this.browserPromise = null;
      return this.browser;
    });

    return this.browserPromise!;
  }

  public async acquireContext(options?: any): Promise<any> {
    if (this.activeContexts >= this.MAX_CONTEXTS) {
      await new Promise<void>((resolve) => {
        this.contextQueue.push(resolve);
      });
    }
    this.activeContexts++;
    const browser = await this.getBrowser();
    return await browser.newContext(options);
  }

  public async releaseContext(context: any): Promise<void> {
    await context.close();
    this.activeContexts--;
    const next = this.contextQueue.shift();
    if (next) {
      next();
    }
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    if (this.proxy) {
      await this.proxy.stop();
      this.proxy = null;
    }
    this.activeContexts = 0;
    this.contextQueue = [];
  }
}
