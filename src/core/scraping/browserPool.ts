import type { Browser } from 'playwright-core';

export class BrowserPool {
  private static instance: BrowserPool | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private browser: Browser | null = null;

  private constructor() {}

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
        "Playwright is not installed. Zendriver engine requires the 'playwright-core' package.\n" +
        "To install it, run: npm install playwright-core"
      );
    }

    this.browserPromise = playwrightModule.chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_BIN,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1920,1080',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    }).then((b: any) => {
      this.browser = b as Browser;
      this.browserPromise = null;
      return b;
    });

    return this.browserPromise!;
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
