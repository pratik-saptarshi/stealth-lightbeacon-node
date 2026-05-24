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
exports.ObscuraEngine = void 0;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const fs = __importStar(require("node:fs"));
const ssrf_1 = require("../ssrf");
const fetcher_1 = require("../fetcher");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
class ObscuraEngine {
    binaryPath;
    allowPrivate;
    ssrfGuard;
    constructor(options = {}) {
        this.binaryPath = options.binaryPath ?? 'bin/obscura';
        this.allowPrivate = options.allowPrivate ?? false;
        this.ssrfGuard = new ssrf_1.SSRFGuard({ allowPrivate: this.allowPrivate });
    }
    async scrape(url) {
        // 1. Pre-fetch SSRF validation
        await this.ssrfGuard.validate(url);
        const startTime = Date.now();
        // Check if the binary exists and is executable
        if (fs.existsSync(this.binaryPath) && fs.statSync(this.binaryPath).isFile()) {
            try {
                // Enforce redirects limit inside the binary if supported, or validate pre-fetch IP
                const parsed = new URL(url);
                const host = parsed.hostname;
                const pinnedIp = this.ssrfGuard.getPinnedAddress(host);
                const targetUrl = pinnedIp ? url.replace(host, pinnedIp) : url;
                const { stdout } = await execFileAsync(this.binaryPath, ['--dump', 'html', '--max-redirects', '0', targetUrl], { timeout: 15000 });
                const elapsed = Date.now() - startTime;
                return {
                    url,
                    html: stdout,
                    headers: {},
                    status: 200,
                    responseTimeMs: elapsed
                };
            }
            catch (err) {
                console.warn(`Obscura binary exec failed: ${err.message}. Falling back to spoofed browser client...`);
            }
        }
        return this.scrapeFallback(url, startTime);
    }
    async scrapeFallback(url, startTime) {
        const defaultUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        return (0, fetcher_1.fetchHttpPage)(url, this.ssrfGuard, defaultUA);
    }
}
exports.ObscuraEngine = ObscuraEngine;
