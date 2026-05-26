"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZendriverEngine = void 0;
const ssrf_1 = require("../ssrf");
const browserPool_1 = require("./browserPool");
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
        // 1. Pre-fetch SSRF validation
        await this.ssrfGuard.validate(url);
        const startTime = Date.now();
        const ctx = await browserPool_1.BrowserPool.getInstance().acquireContext({
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
                    get: () => [1, 2, 3, 4, 5]
                });
                // Emulate standard chrome runtime interface
                window.chrome = {
                    runtime: {}
                };
                // WebGL Fingerprint Spoofing
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function (param) {
                    // UNMASKED_VENDOR_WEBGL
                    if (param === 37445) {
                        return 'Intel Open Source Technology Center';
                    }
                    // UNMASKED_RENDERER_WEBGL
                    if (param === 37446) {
                        return 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)';
                    }
                    return getParameter.apply(this, arguments);
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
                ? Object.fromEntries(Object.entries(await res.allHeaders()).map(([k, v]) => [k.toLowerCase(), v]))
                : {};
            return {
                url: finalUrl,
                html,
                headers,
                status: res?.status() ?? 200,
                responseTimeMs: Date.now() - startTime
            };
        }
        finally {
            await browserPool_1.BrowserPool.getInstance().releaseContext(ctx);
        }
    }
}
exports.ZendriverEngine = ZendriverEngine;
