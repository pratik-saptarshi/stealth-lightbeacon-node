"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createScraper = createScraper;
const obscura_1 = require("./obscura");
const zendriver_1 = require("./zendriver");
const fetcher_1 = require("../fetcher");
const ssrf_1 = require("../ssrf");
const client_1 = require("../../mcp/client");
function createScraper(options = {}) {
    const engine = options.engine ?? 'http';
    const allowPrivate = options.allowPrivate ?? false;
    const userAgent = options.userAgent;
    const timeoutMs = options.timeoutMs ?? 30000;
    const guard = new ssrf_1.SSRFGuard({ allowPrivate });
    switch (engine) {
        case 'mcp':
            const mcpClient = new client_1.StealthMcpClient();
            return async (url) => {
                await guard.validate(url);
                const result = await mcpClient.callTool('scrape', { url });
                return result;
            };
        case 'stealth':
            const zendriver = new zendriver_1.ZendriverEngine({ allowPrivate, userAgent, timeoutMs });
            return (url) => zendriver.scrape(url);
        case 'fast':
            const obscura = new obscura_1.ObscuraEngine({ allowPrivate });
            return (url) => obscura.scrape(url);
        case 'rendered':
            // Backwards compatible basic Playwright rendering
            const basicZendriver = new zendriver_1.ZendriverEngine({ allowPrivate, userAgent, timeoutMs });
            return (url) => basicZendriver.scrape(url);
        case 'http':
        default:
            // Standard HTTP fetch client
            return async (url) => {
                await guard.validate(url);
                const defaultUA = userAgent ?? 'StealthLightbeaconNode/2.0';
                return (0, fetcher_1.fetchHttpPage)(url, guard, defaultUA);
            };
    }
}
