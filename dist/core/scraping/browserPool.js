"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserPool = void 0;
class BrowserPool {
    static instance = null;
    browserPromise = null;
    browser = null;
    constructor() { }
    static getInstance() {
        if (!BrowserPool.instance) {
            BrowserPool.instance = new BrowserPool();
        }
        return BrowserPool.instance;
    }
    async getBrowser() {
        if (this.browser) {
            return this.browser;
        }
        if (this.browserPromise) {
            return this.browserPromise;
        }
        let playwrightModule;
        try {
            playwrightModule = await new Function('return import("playwright-core")')();
        }
        catch {
            throw new Error("Playwright is not installed. Zendriver engine requires the 'playwright-core' package.\n" +
                "To install it, run: npm install playwright-core");
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
        }).then((b) => {
            this.browser = b;
            this.browserPromise = null;
            return b;
        });
        return this.browserPromise;
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}
exports.BrowserPool = BrowserPool;
