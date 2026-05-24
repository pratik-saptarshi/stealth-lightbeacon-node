import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import { SSRFGuard } from '../ssrf';
import type { CrawledPage } from '../crawler';
import { fetchHttpPage } from '../fetcher';

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
        // Enforce redirects limit inside the binary if supported, or validate pre-fetch IP
        const parsed = new URL(url);
        const host = parsed.hostname;
        const pinnedIp = this.ssrfGuard.getPinnedAddress(host);
        const targetUrl = pinnedIp ? url.replace(host, pinnedIp) : url;

        const { stdout } = await execFileAsync(
          this.binaryPath,
          ['--dump', 'html', '--max-redirects', '0', targetUrl],
          { timeout: 15000 }
        );

        const elapsed = Date.now() - startTime;
        return {
          url,
          html: stdout,
          headers: {},
          status: 200,
          responseTimeMs: elapsed
        };
      } catch (err: any) {
        console.warn(`Obscura binary exec failed: ${err.message}. Falling back to spoofed browser client...`);
      }
    }

    return this.scrapeFallback(url, startTime);
  }

  private async scrapeFallback(url: string, startTime: number): Promise<CrawledPage> {
    const defaultUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    return fetchHttpPage(url, this.ssrfGuard, defaultUA);
  }
}
