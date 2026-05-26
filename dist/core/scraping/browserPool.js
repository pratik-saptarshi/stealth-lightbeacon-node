"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserPool = void 0;
const secureProxy_1 = require("./secureProxy");
const ssrf_1 = require("../ssrf");
class BrowserPool {
    static instance = null;
    browserPromise = null;
    browser = null;
    proxy = null;
    guard;
    activeContexts = 0;
    contextQueue = [];
    MAX_CONTEXTS = 10;
    constructor() {
        this.guard = new ssrf_1.SSRFGuard({ allowPrivate: false });
    }
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
            throw new Error("Playwright is not installed. Zendriver engine requires the 'playwright-core' pkg.\n" +
                "To install it, run: npm install playwright-core");
        }
        // Start secure proxy first
        this.proxy = new secureProxy_1.SecureProxy(this.guard);
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
        }).then((b) => {
            this.browser = b;
            this.browserPromise = null;
            return this.browser;
        });
        return this.browserPromise;
    }
    async acquireContext(options) {
        if (this.activeContexts >= this.MAX_CONTEXTS) {
            await new Promise((resolve) => {
                this.contextQueue.push(resolve);
            });
        }
        this.activeContexts++;
        const browser = await this.getBrowser();
        return await browser.newContext(options);
    }
    async releaseContext(context) {
        await context.close();
        this.activeContexts--;
        const next = this.contextQueue.shift();
        if (next) {
            next();
        }
    }
    async close() {
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
exports.BrowserPool = BrowserPool;
