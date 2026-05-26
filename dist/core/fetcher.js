"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFetchPage = createFetchPage;
exports.requestSecurePinned = requestSecurePinned;
exports.fetchHttpPage = fetchHttpPage;
exports.discoverBrokenLinks = discoverBrokenLinks;
exports.secureFetch = secureFetch;
const cheerio = __importStar(require("cheerio"));
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const ssrf_1 = require("./ssrf");
const factory_1 = require("./scraping/factory");
const DEFAULT_USER_AGENT = 'StealthLightbeaconNode/2.0';
function createFetchPage(options = {}) {
    return (0, factory_1.createScraper)(options);
}
function requestSecurePinned(urlStr, options) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlStr);
        const isHttps = parsed.protocol === 'https:';
        const host = parsed.hostname;
        const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
        const client = isHttps ? https : http;
        const reqOptions = {
            method: options.method ?? 'GET',
            hostname: host,
            port,
            path: parsed.pathname + parsed.search,
            headers: options.headers,
            rejectUnauthorized: true
        };
        const guard = options.guard ?? new ssrf_1.SSRFGuard();
        const agents = (0, ssrf_1.getSSRFGuardAgents)(guard);
        reqOptions.agent = isHttps ? agents.httpsAgent : agents.httpAgent;
        const req = client.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const bodyText = Buffer.concat(chunks).toString('utf8');
                const headers = {};
                for (const [key, val] of Object.entries(res.headers)) {
                    if (Array.isArray(val)) {
                        headers[key] = val.join(', ');
                    }
                    else if (val !== undefined) {
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
function normalizeLookupOptions(opts) {
    if (typeof opts === 'number') {
        return { family: opts };
    }
    return {
        family: opts.family,
        hints: opts.hints,
        verbatim: opts.verbatim
    };
}
function normalizeLookupAllOptions(opts) {
    return {
        family: opts.family,
        hints: opts.hints,
        verbatim: opts.verbatim,
        all: true
    };
}
async function fetchHttpPage(url, guard, userAgent, maxRedirects = 5) {
    const startTime = Date.now();
    let currentUrl = url;
    let redirectsFollowed = 0;
    let response;
    while (true) {
        await guard.validate(currentUrl);
        const parsed = new URL(currentUrl);
        const host = parsed.hostname;
        const pinnedIp = guard.getPinnedAddress(host);
        const requestHeaders = {
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
async function renderPage(url, guard, userAgent) {
    let playwrightModule;
    try {
        playwrightModule = await new Function('return import("playwright-core")')();
    }
    catch {
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
        await page.route('**/*', async (route) => {
            try {
                await guard.validate(route.request().url());
                await route.continue();
            }
            catch {
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
    }
    finally {
        await browser.close();
    }
}
function normalizeHeaderEntries(headers) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}
function discoverBrokenLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();
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
        }
        catch {
            return;
        }
    });
    return [...links];
}
async function secureFetch(urlStr, options = {}) {
    const guard = options.guard ?? new ssrf_1.SSRFGuard();
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
