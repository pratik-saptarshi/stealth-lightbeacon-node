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
exports.PerformanceEvaluator = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../core/types");
class PerformanceEvaluator {
    id = 'performance';
    domain = 'Performance & Core Web Vitals';
    async evaluate(context) {
        const $ = cheerio.load(context.html);
        const issues = [];
        const ttfb = context.responseTimeMs ?? 0;
        if (ttfb >= 600) {
            issues.push({
                id: 'R-PERF-TTFB',
                severity: 'critical',
                message: `Time to first byte is high at ${ttfb}ms.`,
                location: context.url,
                remedy: 'Enable Drupal page caching, reverse proxy caching, or CDN edge caching.'
            });
        }
        else if (ttfb >= 200) {
            issues.push({
                id: 'R-PERF-TTFB',
                severity: 'warning',
                message: `Time to first byte is elevated at ${ttfb}ms.`,
                location: context.url,
                remedy: 'Investigate backend response time and cache policy.'
            });
        }
        const cacheHeader = stringHeader(context.headers['x-drupal-cache']) ?? 'MISS';
        const varnishHeader = stringHeader(context.headers['x-varnish']);
        if (cacheHeader !== 'HIT' && !varnishHeader) {
            issues.push({
                id: 'R-PERF-CACHE-MISS',
                severity: 'critical',
                message: 'Drupal page caching does not appear active.',
                location: 'HTTP headers',
                remedy: 'Enable Internal Page Cache, Dynamic Page Cache, or Varnish/CDN caching.'
            });
        }
        const stylesheets = $('link[rel="stylesheet"]').toArray();
        const scripts = $('script[src]').toArray();
        const aggregatedCss = stylesheets.some((element) => {
            const href = $(element).attr('href') ?? '';
            return href.includes('css_') || href.includes('/css/css');
        });
        const aggregatedJs = scripts.some((element) => {
            const src = $(element).attr('src') ?? '';
            return src.includes('js_') || src.includes('/js/js');
        });
        if (!aggregatedCss || !aggregatedJs) {
            issues.push({
                id: 'R-PERF-AGGREGATION',
                severity: aggregatedCss || aggregatedJs ? 'warning' : 'critical',
                message: 'CSS/JS aggregation appears incomplete.',
                location: 'Document assets',
                remedy: 'Enable CSS and JS aggregation in Drupal performance settings.'
            });
        }
        const legacyImages = $('img[src]')
            .toArray()
            .map((element) => ($(element).attr('src') ?? '').toLowerCase())
            .filter((src) => src.endsWith('.jpg') || src.endsWith('.jpeg') || src.endsWith('.png') || src.endsWith('.gif'));
        if (legacyImages.length > 0) {
            issues.push({
                id: 'R-PERF-IMAGES',
                severity: legacyImages.length > 2 ? 'critical' : 'warning',
                message: `${legacyImages.length} images use legacy formats instead of WebP/AVIF.`,
                location: 'Image assets',
                remedy: 'Configure Drupal image styles to emit modern formats.'
            });
        }
        if (context.pageSpeed?.lighthousePerformanceScore && context.pageSpeed.lighthousePerformanceScore < 90) {
            issues.push({
                id: 'R-PERF-LIGHTHOUSE',
                severity: context.pageSpeed.lighthousePerformanceScore < 50 ? 'critical' : 'warning',
                message: `Lighthouse performance score is ${context.pageSpeed.lighthousePerformanceScore}/100.`,
                location: context.url,
                remedy: 'Review PageSpeed diagnostics and address the highest-value opportunities.'
            });
        }
        if (context.pageSpeed?.lcpMs !== undefined) {
            const lcp = context.pageSpeed.lcpMs;
            if (lcp > 4000) {
                issues.push({
                    id: 'R-PERF-LCP-CRIT',
                    severity: 'critical',
                    message: `Largest Contentful Paint is extremely poor (${lcp}ms). Standard threshold is under 2500ms.`,
                    location: 'External Loading Experience',
                    remedy: 'Optimize hero images, compress CSS/JS, and utilize Drupal aggregated assets.'
                });
            }
            else if (lcp > 2500) {
                issues.push({
                    id: 'R-PERF-LCP-WARN',
                    severity: 'warning',
                    message: `Largest Contentful Paint needs improvement (${lcp}ms). Target is under 2500ms.`,
                    location: 'External Loading Experience',
                    remedy: 'Enable lazy loading for images and reduce main-thread rendering blocks.'
                });
            }
        }
        if (context.pageSpeed?.clsScore !== undefined) {
            const cls = context.pageSpeed.clsScore;
            if (cls > 0.25) {
                issues.push({
                    id: 'R-PERF-CLS-CRIT',
                    severity: 'critical',
                    message: `Cumulative Layout Shift is severe (${cls.toFixed(2)}). Standard target is under 0.1.`,
                    location: 'Visual Stability',
                    remedy: 'Specify width and height attributes on all images and dynamic iframe widgets.'
                });
            }
            else if (cls > 0.1) {
                issues.push({
                    id: 'R-PERF-CLS-WARN',
                    severity: 'warning',
                    message: `Cumulative Layout Shift needs tuning (${cls.toFixed(2)}). Target is under 0.1.`,
                    location: 'Visual Stability',
                    remedy: 'Ensure custom web fonts load smoothly and elements have reserved container spaces.'
                });
            }
        }
        if (context.pageSpeed?.inpMs !== undefined) {
            const inp = context.pageSpeed.inpMs;
            if (inp > 500) {
                issues.push({
                    id: 'R-PERF-INP-CRIT',
                    severity: 'critical',
                    message: `Interaction to Next Paint is extremely slow (${inp}ms). Threshold target is under 200ms.`,
                    location: 'Interaction Responsiveness',
                    remedy: 'Break up long JavaScript execution blocks and reduce complex event listener loops.'
                });
            }
            else if (inp > 200) {
                issues.push({
                    id: 'R-PERF-INP-WARN',
                    severity: 'warning',
                    message: `Interaction to Next Paint is slow (${inp}ms). Target is under 200ms.`,
                    location: 'Interaction Responsiveness',
                    remedy: 'Deconstruct bloated scripts and audit third-party tracker script payloads.'
                });
            }
        }
        return {
            id: this.id,
            domain: this.domain,
            score: (0, types_1.scoreFromIssues)(issues),
            issues,
            metadata: {
                responseTimeMs: ttfb,
                lighthousePerformanceScore: context.pageSpeed?.lighthousePerformanceScore,
                cwv: context.pageSpeed?.cwv,
                lcpMs: context.pageSpeed?.lcpMs,
                clsScore: context.pageSpeed?.clsScore,
                inpMs: context.pageSpeed?.inpMs,
                ttfbMs: context.pageSpeed?.ttfbMs
            }
        };
    }
}
exports.PerformanceEvaluator = PerformanceEvaluator;
function stringHeader(value) {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}
