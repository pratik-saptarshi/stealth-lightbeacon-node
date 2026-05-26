import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import { SSRFGuard } from '../ssrf';
import type { CrawledPage } from '../crawler';
import { fetchHttpPage, requestSecurePinned } from '../fetcher';
import { SecureProxy } from './secureProxy';

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

    // Resolve redirects at Node layer using requestSecurePinned
    let currentUrl = url;
    let redirectsFollowed = 0;
    const maxRedirects = 5;

    while (redirectsFollowed < maxRedirects) {
      await this.ssrfGuard.validate(currentUrl);
      const parsed = new URL(currentUrl);
      const pinnedIp = this.ssrfGuard.getPinnedAddress(parsed.hostname);

      try {
        const response = await requestSecurePinned(currentUrl, {
          method: 'HEAD',
          pinnedIp: pinnedIp ?? undefined,
          guard: this.ssrfGuard
        });

        if (response.status >= 300 && response.status < 400 && response.headers['location']) {
          currentUrl = new URL(response.headers['location'], currentUrl).toString();
          redirectsFollowed++;
        } else {
          break;
        }
      } catch {
        // If HEAD fails, we can fall back to standard GET redirect tracking or break
        break;
      }
    }

    // Double check the final URL
    await this.ssrfGuard.validate(currentUrl);

    // Check if the binary exists and is executable
    if (fs.existsSync(this.binaryPath) && fs.statSync(this.binaryPath).isFile()) {
      const proxy = new SecureProxy(this.ssrfGuard);
      const proxyPort = await proxy.start();
      try {
        const proxyUrl = proxy.getProxyUrl();
        const { stdout } = await execFileAsync(
          this.binaryPath,
          ['--no-redirect', '--dump', 'html', currentUrl],
          {
            timeout: 15000,
            env: {
              ...process.env,
              HTTP_PROXY: proxyUrl,
              HTTPS_PROXY: proxyUrl,
              http_proxy: proxyUrl,
              https_proxy: proxyUrl
            }
          }
        );
        const elapsed = Date.now() - startTime;
        return {
          url: currentUrl,
          html: stdout,
          headers: {},
          status: 200,
          responseTimeMs: elapsed
        };
      } catch (err: any) {
        console.warn(`Obscura binary exec failed: ${err.message}. Falling back to spoofed browser client...`);
      } finally {
        await proxy.stop();
      }
    }

    return this.scrapeFallback(currentUrl, startTime);
  }

  private async scrapeFallback(url: string, startTime: number): Promise<CrawledPage> {
    const defaultUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    return fetchHttpPage(url, this.ssrfGuard, defaultUA);
  }
}
