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
exports.crawlSite = crawlSite;
const cheerio = __importStar(require("cheerio"));
async function crawlSite(options) {
    const start = new URL(options.startUrl);
    const queue = [{ url: start.toString(), depth: 0 }];
    const visited = new Set();
    const pages = [];
    const brokenPages = new Map();
    const concurrency = options.concurrency ?? 1;
    const throttleMs = options.throttleMs ?? 0;
    // Track start URL as visited
    visited.add(normalizeUrl(start.toString()));
    let activeCount = 0;
    const queueResolvers = [];
    const notifyQueueChanged = () => {
        while (queueResolvers.length > 0) {
            const resolve = queueResolvers.shift();
            if (resolve) {
                resolve();
            }
        }
    };
    const nextEntry = async () => {
        while (queue.length === 0) {
            if (activeCount === 0 || pages.length >= options.maxUrls) {
                return null;
            }
            await new Promise((resolve) => {
                queueResolvers.push(resolve);
            });
        }
        const item = queue.shift() || null;
        if (item) {
            activeCount++;
        }
        return item;
    };
    const runWorker = async () => {
        while (pages.length < options.maxUrls) {
            const entry = await nextEntry();
            if (!entry) {
                break;
            }
            try {
                const normalizedUrl = normalizeUrl(entry.url);
                if (throttleMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, throttleMs));
                }
                const page = await options.fetchPage(normalizedUrl);
                if (page.status >= 200 && page.status < 300) {
                    pages.push(page);
                    if (entry.depth < options.maxDepth && pages.length < options.maxUrls) {
                        const discovered = discoverInternalLinks(page.html, normalizedUrl, start.hostname);
                        for (const link of discovered) {
                            if (pages.length + queue.length >= options.maxUrls) {
                                break;
                            }
                            if (!visited.has(link)) {
                                visited.add(link);
                                queue.push({ url: link, depth: entry.depth + 1 });
                            }
                        }
                    }
                }
                else {
                    brokenPages.set(normalizedUrl, page.status);
                }
            }
            catch (err) {
                // Ignore fetch errors during crawl
            }
            finally {
                activeCount--;
                notifyQueueChanged();
            }
        }
    };
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(runWorker());
    }
    await Promise.all(workers);
    return { pages, brokenPages };
}
function discoverInternalLinks(html, baseUrl, hostname) {
    const $ = cheerio.load(html);
    const discovered = new Set();
    $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) {
            return;
        }
        try {
            const url = new URL(href, baseUrl);
            if (url.hostname !== hostname) {
                return;
            }
            discovered.add(normalizeUrl(url.toString()));
        }
        catch {
            return;
        }
    });
    return [...discovered];
}
function normalizeUrl(urlValue) {
    const parsed = new URL(urlValue);
    parsed.hash = '';
    parsed.search = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
}
