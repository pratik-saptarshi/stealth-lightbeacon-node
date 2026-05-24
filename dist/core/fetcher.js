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
exports.fetchHttpPage = fetchHttpPage;
exports.discoverBrokenLinks = discoverBrokenLinks;
const cheerio = __importStar(require("cheerio"));
const factory_1 = require("./scraping/factory");
const DEFAULT_USER_AGENT = 'StealthLightbeaconNode/2.0';
function createFetchPage(options = {}) {
    return (0, factory_1.createScraper)(options);
}
async function fetchHttpPage(url, guard, userAgent) {
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
