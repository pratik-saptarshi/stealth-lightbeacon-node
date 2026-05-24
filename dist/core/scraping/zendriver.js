"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZendriverEngine = void 0;
const ssrf_1 = require("../ssrf");
class ZendriverEngine {
    timeoutMs;
    allowPrivate;
    ssrfGuard;
    userAgent;
    constructor(options = {}) {
        this.timeoutMs = options.timeoutMs ?? 30000;
        this.allowPrivate = options.allowPrivate ?? false;
        this.ssrfGuard = new ssrf_1.SSRFGuard({ allowPrivate: this.allowPrivate });
        this.userAgent = options.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }
    async scrape(url) {
        let playwrightModule;
        try {
            playwrightModule = await new Function('return import("playwright-core")')();
        }
        catch {
            throw new Error("Playwright is not installed. Zendriver engine requires the 'playwright-core' package.\n" +
                "To install it, run: npm install playwright-core");
        }
        // 1. Pre-fetch SSRF validation
        await this.ssrfGuard.validate(url);
        const startTime = Date.now();
        const browser = await playwrightModule.chromium.launch({
            headless: true,
            executablePath: process.env.CHROME_BIN,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
                '--window-size=1920,1080'
            ]
        });
        try {
            const context = await browser.newContext({
                viewport: { width: 1920, height: 1080 },
                userAgent: this.userAgent,
                acceptDownloads: false,
                colorScheme: 'dark',
                deviceScaleFactor: 1,
                hasTouch: false,
                isMobile: false,
                locale: 'en-US',
                timezoneId: 'America/New_York'
            });
            // Bypass webdriver detection scripts
            await context.addInitScript(() => {
                // Override webdriver flag
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                // Emulate standard plugins list length
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                // Emulate standard chrome runtime interface
                window.chrome = {
                    runtime: {}
                };
                // WebGL Fingerprint Spoofing
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function (parameter) {
                    // UNMASKED_VENDOR_WEBGL
                    if (parameter === 37445) {
                        return 'Intel Open Source Technology Center';
                    }
                    // UNMASKED_RENDERER_WEBGL
                    if (parameter === 37446) {
                        return 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)';
                    }
                    return getParameter.apply(this, arguments);
                };
            });
            const page = await context.newPage();
            // Navigate and wait for content
            const response = await page.goto(url, {
                waitUntil: 'networkidle',
                timeout: this.timeoutMs
            });
            const finalUrl = page.url();
            // 2. Post-navigation redirect SSRF validation
            await this.ssrfGuard.validate(finalUrl);
            const html = await page.content();
            const headers = response
                ? Object.fromEntries(Object.entries(await response.allHeaders()).map(([k, v]) => [k.toLowerCase(), v]))
                : {};
            return {
                url: finalUrl,
                html,
                headers,
                status: response?.status() ?? 200,
                responseTimeMs: Date.now() - startTime
            };
        }
        finally {
            await browser.close();
        }
    }
}
exports.ZendriverEngine = ZendriverEngine;
