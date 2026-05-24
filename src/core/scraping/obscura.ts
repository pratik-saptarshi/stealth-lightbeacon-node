import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import { SSRFGuard } from '../ssrf';
import type { CrawledPage } from '../crawler';

const execFileAsync = promisify(execFile);

export interface ObscuraOptions {
  binaryPath?: string;
  allowPrivate?: boolean;
}

export class ObscuraEngine {
  private readonly binaryPath: string;
  private readonly allowPrivate: boolean;
  private readonly ssrfGuard: SSRFGuard;

  constructor(options: ObscuraOptions = {}) {
    this.binaryPath = options.binaryPath ?? 'bin/obscura';
    this.allowPrivate = options.allowPrivate ?? false;
    this.ssrfGuard = new SSRFGuard({ allowPrivate: this.allowPrivate });
  }

  async scrape(url: string): Promise<CrawledPage> {
    // 1. Pre-fetch SSRF validation
    await this.ssrfGuard.validate(url);

    const startTime = Date.now();

    // Check if the binary exists and is executable
    if (fs.existsSync(this.binaryPath) && fs.statSync(this.binaryPath).isFile()) {
      try {
        const { stdout, stderr } = await execFileAsync(this.binaryPath, ['--dump', 'html', url], {
          timeout: 15000
        });

        const elapsed = Date.now() - startTime;
        // Construct standard CrawledPage
        return {
          url,
          html: stdout,
          headers: {},
          status: 200,
          responseTimeMs: elapsed
        };
      } catch (err: any) {
        // Fall back gracefully on subprocess failure or error
        console.warn(`Obscura binary execution failed: ${err.message}. Falling back to spoofed browser client...`);
      }
    }

    // Fallback: Specialized browser-spoofing client
    return this.scrapeFallback(url, startTime);
  }

  private async scrapeFallback(url: string, startTime: number): Promise<CrawledPage> {
    const spoofedHeaders = {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Linux"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    };

    const response = await fetch(url, {
      method: 'GET',
      headers: spoofedHeaders,
      redirect: 'follow'
    });

    const finalUrl = response.url;
    // Post-navigation redirect SSRF validation
    await this.ssrfGuard.validate(finalUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.statusText} (${response.status})`);
    }

    const html = await response.text();
    const headers = Object.fromEntries(
      Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), String(v)])
    );

    return {
      url: finalUrl,
      html,
      headers,
      status: response.status,
      responseTimeMs: Date.now() - startTime
    };
  }
}
