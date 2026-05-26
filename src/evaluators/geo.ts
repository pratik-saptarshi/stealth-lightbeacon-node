import * as cheerio from 'cheerio';
import type { AuditIssue, DomainResult, EvaluationContext, Evaluator } from '../core/types';
import { scoreFromIssues } from '../core/types';

export class GeoEvaluator implements Evaluator {
  readonly id = 'geo';
  readonly domain = 'Generative Engine Optimization';

  async evaluate(context: EvaluationContext): Promise<DomainResult> {
    const $ = cheerio.load(context.html);
    const issues: AuditIssue[] = [];

    if (!context.url.startsWith('https://')) {
      issues.push({
        id: 'R-GEO-HTTPS',
        severity: 'critical',
        message: 'Target is not served over HTTPS.',
        location: context.url,
        remedy: 'Serve public content over HTTPS.'
      });
    }

    const linkText = $('a[href]')
      .toArray()
      .map((element) => `${$(element).text()} ${$(element).attr('href') ?? ''}`.toLowerCase())
      .join(' ');

    for (const [label, token] of [
      ['privacy', 'Privacy Policy'],
      ['contact', 'Contact'],
      ['about', 'About']
    ] as const) {
      if (!linkText.includes(label)) {
        issues.push({
          id: `R-GEO-${label.toUpperCase()}`,
          severity: 'warning',
          message: `Missing visible ${token} trust signal.`,
          location: 'Navigation',
          remedy: `Add an accessible ${token} page and link to it.`
        });
      }
    }

    // Outbound Citations & Authority
    const currentHost = new URL(context.url).hostname;
    const outboundLinks = $('a[href]')
      .toArray()
      .filter((element) => {
        const href = $(element).attr('href')?.trim();
        if (!href) {
          return false;
        }
        try {
          const url = new URL(href, context.url);
          return url.protocol.startsWith('http') && url.hostname !== currentHost;
        } catch {
          return false;
        }
      });

    if (outboundLinks.length === 0) {
      issues.push({
        id: 'R-GEO-CIT-NONE',
        severity: 'warning',
        message: 'No outbound citations detected.',
        location: 'Body links',
        remedy: 'Add outbound citations to support informational depth.'
      });
    } else {
      const hasAuthorityCitation = outboundLinks.some((element) => {
        const href = $(element).attr('href')!.toLowerCase();
        try {
          const url = new URL(href, context.url);
          const domain = url.hostname;
          return (
            domain.endsWith('.edu') ||
            domain.endsWith('.gov') ||
            domain.endsWith('.org') ||
            domain.includes('wikipedia.org') ||
            domain.includes('arxiv.org')
          );
        } catch {
          return false;
        }
      });

      if (!hasAuthorityCitation) {
        issues.push({
          id: 'R-GEO-CIT-LOW',
          severity: 'warning',
          message: 'No high-authority outbound citations (e.g. .edu, .gov, .org) found.',
          location: 'Body links',
          remedy: 'Cite high-authority sources (academic, governmental, or educational reference portals).'
        });
      }
    }

    // E-E-A-T Schema Metadata Check (Author & Recency)
    let hasSchemaAuthor = false;
    let hasSchemaRecency = false;

    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const text = $(element).html();
        if (!text) {
          return;
        }
        const data = JSON.parse(text);

        const checkObject = (obj: any) => {
          if (!obj || typeof obj !== 'object') {
            return;
          }
          if (Array.isArray(obj)) {
            obj.forEach(checkObject);
            return;
          }

          if (obj.author) {
            const author = obj.author;
            if (typeof author === 'string' && author.trim().length > 0) {
              hasSchemaAuthor = true;
            } else if (typeof author === 'object') {
              const authors = Array.isArray(author) ? author : [author];
              authors.forEach((a) => {
                if (a.name || a.sameAs) {
                  hasSchemaAuthor = true;
                }
              });
            }
          }

          if (obj.datePublished || obj.dateModified) {
            hasSchemaRecency = true;
          }

          Object.values(obj).forEach((val) => {
            if (val && typeof val === 'object') {
              checkObject(val);
            }
          });
        };

        checkObject(data);
      } catch {
        // Ignore json syntax errors
      }
    });

    // Check microdata author & recency
    if ($('[itemprop="author"]').length > 0) {
      hasSchemaAuthor = true;
    }
    if ($('[itemprop="datePublished"]').length > 0 || $('[itemprop="dateModified"]').length > 0) {
      hasSchemaRecency = true;
    }

    const hasAuthorHTML = $('[class*="author"], [class*="byline"], [rel="author"]').length > 0 || $('meta[name="author"]').length > 0;
    const hasAuthor = hasAuthorHTML || hasSchemaAuthor;

    if (!hasAuthor) {
      issues.push({
        id: 'R-GEO-AUTHOR',
        severity: 'warning',
        message: 'No clear author or byline signal detected.',
        location: 'Content metadata',
        remedy: 'Add author bylines or author structured data.'
      });
    }

    if (!hasSchemaAuthor) {
      issues.push({
        id: 'R-GEO-EEAT-AUTHOR',
        severity: 'warning',
        message: 'Missing structured E-E-A-T author metadata in schema markup.',
        location: 'Structured data',
        remedy: 'Add clear JSON-LD Article/CreativeWork author objects with names and profiles.'
      });
    }

    if (!hasSchemaRecency) {
      issues.push({
        id: 'R-GEO-EEAT-RECENCY',
        severity: 'warning',
        message: 'Missing content recency signals (datePublished/dateModified schema).',
        location: 'Structured data',
        remedy: 'Define datePublished and dateModified timestamp properties in JSON-LD.'
      });
    }

    // Keyword Stuffing Analysis
    const rawBodyText = $('body').text() ?? '';
    const words = rawBodyText.toLowerCase().match(/[a-z]{4,15}/g) ?? [];
    if (words.length > 0) {
      const wordCounts: Record<string, number> = {};
      words.forEach((word) => {
        wordCounts[word] = (wordCounts[word] ?? 0) + 1;
      });

      const totalWords = words.length;
      let stuffedWord: string | null = null;
      let maxDensity = 0;

      for (const [word, count] of Object.entries(wordCounts)) {
        const density = count / totalWords;
        if (density > 0.03 && density > maxDensity) {
          maxDensity = density;
          stuffedWord = word;
        }
      }

      if (stuffedWord) {
        issues.push({
          id: 'R-GEO-STUFFING-WARN',
          severity: 'warning',
          message: `Potential keyword stuffing: word "${stuffedWord}" has density of ${(maxDensity * 100).toFixed(1)}% (limit is 3.0%).`,
          location: 'Body',
          remedy: 'Refactor copy to maintain balanced keyword density and natural readability.'
        });
      }
    }

    const bodyTextWordCount = $('body').text().trim().split(/\s+/).filter(Boolean).length;
    if (bodyTextWordCount < 300) {
      issues.push({
        id: 'R-GEO-DEPTH',
        severity: 'warning',
        message: `Content depth is light at ${bodyTextWordCount} words.`,
        location: 'Body',
        remedy: 'Expand content with more depth and supporting detail.'
      });
    }

    return {
      id: this.id,
      domain: this.domain,
      score: scoreFromIssues(issues),
      issues,
      metadata: {
        wordCount: bodyTextWordCount,
        hasAuthor
      }
    };
  }
}
