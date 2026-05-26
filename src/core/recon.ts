import { secureFetch } from './fetcher';
import { SSRFGuard } from './ssrf';

export interface ReconRecommendation {
  detectedProtections: string[];
  recommendedEngine: 'http' | 'rendered' | 'fast' | 'stealth';
  recommendedThrottleMs: number;
  reason: string;
}

export class PreAuditRecon {
  private readonly guard: SSRFGuard;
  private readonly fetchFn: typeof secureFetch;

  constructor(guard?: SSRFGuard, fetchFn?: typeof secureFetch) {
    this.guard = guard ?? new SSRFGuard();
    this.fetchFn = fetchFn ?? secureFetch;
  }

  public async analyze(urlStr: string): Promise<ReconRecommendation> {
    const protections: string[] = [];
    let html = '';
    let headers: Record<string, string> = {};

    try {
      const response = await this.fetchFn(urlStr, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        guard: this.guard
      });

      html = await response.text();
      headers = response.headers;

      // 1. Cloudflare Detection
      const serverHeader = (headers['server'] || '').toLowerCase();
      if (
        serverHeader.includes('cloudflare') ||
        headers['cf-ray'] ||
        html.includes('cf-challenge') ||
        html.includes('challenge-platform') ||
        html.includes('<title>Just a moment...</title>')
      ) {
        protections.push('Cloudflare');
      }

      // 2. Akamai Detection
      if (
        serverHeader.includes('akamaighost') ||
        headers['x-akamai-transformed'] ||
        html.includes('akamai-analytics')
      ) {
        protections.push('Akamai');
      }

      // 3. DataDome Detection
      const cookieHeader = (headers['set-cookie'] || '').toLowerCase();
      if (
        cookieHeader.includes('datadome') ||
        html.includes('js.datadome.co')
      ) {
        protections.push('DataDome');
      }

      // 4. General CAPTCHAs
      if (
        html.includes('recaptcha/api.js') ||
        html.includes('hcaptcha.com/1/api.js') ||
        html.includes('g-recaptcha')
      ) {
        protections.push('CAPTCHA');
      }

    } catch (err) {
      // In case of error (e.g. timeout or blocked by challenge), default to secure
      return {
        detectedProtections: ['Unknown (Blocked or Offline)'],
        recommendedEngine: 'stealth',
        recommendedThrottleMs: 2000,
        reason: 'Target request failed during recon, suggesting aggressive anti-bot blocking or structural firewall. Recommend stealth mode.'
      };
    }

    if (protections.length > 0) {
      return {
        detectedProtections: protections,
        recommendedEngine: 'stealth',
        recommendedThrottleMs: 1500,
        reason: `Anti-bot protection systems detected: ${protections.join(', ')}. Activating defensive stealth crawling layers.`
      };
    }

    // Check for heavy JS framework footprints (e.g. Next.js, React, Vue) to recommend rendering
    if (
      html.includes('id="__next"') ||
      html.includes('id="app"') ||
      html.includes('id="root"') ||
      html.includes('/_next/static') ||
      html.includes('vue.js') ||
      html.includes('react.production')
    ) {
      return {
        detectedProtections: [],
        recommendedEngine: 'rendered',
        recommendedThrottleMs: 0,
        reason: 'Heavy clientside JavaScript framework footprint detected. Recommend JS-rendering crawler.'
      };
    }

    return {
      detectedProtections: [],
      recommendedEngine: 'http',
      recommendedThrottleMs: 0,
      reason: 'No anti-bot walls or clientside framework footprints detected. Direct fast-path HTTP fetcher is fully suitable.'
    };
  }
}
