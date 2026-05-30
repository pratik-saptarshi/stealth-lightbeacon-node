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
exports.SeoEvaluator = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../core/types");
const robots_1 = require("../core/robots");
function hasSchemaOrgContext(value) {
    if (typeof value !== 'string') {
        return false;
    }
    try {
        const parsed = new URL(value.trim());
        return parsed.hostname === 'schema.org' || parsed.hostname.endsWith('.schema.org');
    }
    catch {
        return false;
    }
}
class SeoEvaluator {
    id = 'seo';
    domain = 'Technical SEO';
    async evaluate(context) {
        const $ = cheerio.load(context.html);
        const issues = [];
        const title = $('title').text().trim();
        if (!title) {
            issues.push(makeIssue('R-SEO-TITLE-MISS', 'critical', 'Missing title tag.', '<head>', 'Add a descriptive title.'));
        }
        else if (title.length < 10 || title.length > 60) {
            issues.push(makeIssue('R-SEO-TITLE-LEN', 'warning', `Title length is suboptimal at ${title.length} characters.`, '<title>', 'Keep titles roughly between 10 and 60 characters.'));
        }
        const description = $('meta[name="description"]').attr('content')?.trim() ?? '';
        if (!description) {
            issues.push(makeIssue('R-SEO-DESC-MISS', 'critical', 'Missing meta description tag.', '<head>', 'Add a description via Drupal metatag configuration.'));
        }
        else if (description.length < 110 || description.length > 160) {
            issues.push(makeIssue('R-SEO-DESC-LEN', 'warning', `Meta description is suboptimal (${description.length} chars). Standard target is between 110 and 160 characters.`, '<meta name="description">', 'Keep summary excerpts concise without cutting off descriptive context.'));
        }
        const canonical = $('link[rel="canonical"]').attr('href')?.trim() ?? '';
        if (!canonical) {
            issues.push(makeIssue('R-SEO-CAN-MISS', 'critical', 'Missing canonical URL link tag.', '<head>', 'Emit a canonical tag for indexable pages.'));
        }
        else {
            const requested = new URL(context.url);
            const canonicalUrl = new URL(canonical, context.url);
            if (canonicalUrl.protocol === 'http:' && requested.protocol === 'https:') {
                issues.push(makeIssue('R-SEO-CAN-SCHEME', 'warning', `Canonical scheme is insecure HTTP (${canonical}) while requesting secure HTTPS page.`, '<link rel="canonical">', 'Enforce HTTPS schemes globally in your Drupal settings.php and canonical templates.'));
            }
            else if (canonicalUrl.hostname !== requested.hostname || canonicalUrl.pathname !== requested.pathname) {
                issues.push(makeIssue('R-SEO-CAN-MISMATCH', 'warning', `Canonical URL ${canonicalUrl.toString()} does not self-reference the requested page.`, '<link rel="canonical">', 'Check canonical URL generation for this content type.'));
            }
        }
        const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() ?? '';
        if (robotsMeta.includes('noindex')) {
            issues.push(makeIssue('R-SEO-ROBOTS-NOINDEX', 'warning', `Robots meta uses noindex: ${robotsMeta}`, '<meta name="robots">', 'Remove noindex on public content that should rank.'));
        }
        const h1Count = $('h1').length;
        if (h1Count === 0) {
            issues.push(makeIssue('R-SEO-H1-MISS', 'critical', 'No H1 tag found.', 'Body', 'Add a primary H1 heading.'));
        }
        else if (h1Count > 1) {
            issues.push(makeIssue('R-SEO-H1-MULTI', 'warning', `Found ${h1Count} H1 tags.`, 'Body', 'Prefer one primary H1.'));
        }
        const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
        if (!ogTitle) {
            issues.push(makeIssue('R-SEO-OG-MISS', 'warning', 'Missing Open Graph title metadata.', '<head>', 'Configure social metadata.'));
        }
        const jsonLdScripts = $('script[type="application/ld+json"]').toArray();
        if (jsonLdScripts.length === 0) {
            issues.push(makeIssue('R-SEO-LD-MISS', 'critical', 'Missing JSON-LD structured data.', 'Body', 'Add Schema.org JSON-LD markup.'));
        }
        else {
            for (const [index, element] of jsonLdScripts.entries()) {
                const content = $(element).html()?.trim();
                if (!content) {
                    issues.push(makeIssue(`R-SEO-LD-EMPTY-${index}`, 'warning', 'Empty JSON-LD block.', 'JSON-LD', 'Remove or populate the block.'));
                    continue;
                }
                try {
                    const parsed = JSON.parse(content);
                    const contextValue = parsed['@context'] ?? parsed?.[0]?.['@context'];
                    const typeValue = parsed['@type'] ?? parsed?.[0]?.['@type'];
                    if (!hasSchemaOrgContext(contextValue)) {
                        issues.push(makeIssue(`R-SEO-LD-CTX-${index}`, 'warning', 'JSON-LD block has missing or invalid @context.', 'JSON-LD', 'Use https://schema.org.'));
                    }
                    if (!typeValue) {
                        issues.push(makeIssue(`R-SEO-LD-TYPE-${index}`, 'warning', 'JSON-LD block has no @type.', 'JSON-LD', 'Declare an entity type.'));
                    }
                }
                catch {
                    issues.push(makeIssue(`R-SEO-LD-PARSE-${index}`, 'critical', 'JSON-LD block is malformed JSON.', 'JSON-LD', 'Fix JSON syntax.'));
                }
            }
        }
        if (context.robotsContent !== undefined) {
            const robotsUrl = new URL('/robots.txt', context.url).toString();
            const policy = new robots_1.RobotsPolicy(robotsUrl, context.robotsContent);
            const homeUrl = new URL('/', context.url).toString();
            const globalBlocked = !policy.isAllowed('Googlebot', homeUrl);
            const targetBlocked = !policy.isAllowed('Googlebot', context.url);
            if (globalBlocked) {
                issues.push(makeIssue('R-SEO-ROBOTS-BLOCK', 'critical', 'robots.txt contains a global disallow directive, blocking all search engine crawlers from the site.', '/robots.txt', "Remove 'Disallow: /' from production robots.txt and replace with standard administrative restrictions."));
            }
            else if (targetBlocked) {
                issues.push(makeIssue('R-SEO-ROBOTS-PATH-BLOCK', 'warning', `robots.txt disallow directives block search engines from crawling the target URL (${context.url}).`, '/robots.txt', 'Review robots.txt path disallow rules and ensure public content is crawlable.'));
            }
            const sitemaps = policy.getSitemaps();
            if (!sitemaps || sitemaps.length === 0) {
                issues.push(makeIssue('R-SEO-ROBOTS-SITEMAP', 'warning', 'Sitemap URL reference is missing from robots.txt.', '/robots.txt', "Append a sitemap path reference (e.g., 'Sitemap: https://yourdomain.com/sitemap.xml') to robots.txt."));
            }
        }
        return {
            id: this.id,
            domain: this.domain,
            score: (0, types_1.scoreFromIssues)(issues),
            issues,
            metadata: {
                titleLength: title.length,
                hasCanonical: Boolean(canonical),
                jsonLdCount: jsonLdScripts.length
            }
        };
    }
}
exports.SeoEvaluator = SeoEvaluator;
function makeIssue(id, severity, message, location, remedy) {
    return { id, severity, message, location, remedy };
}
