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
exports.UxEvaluator = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../core/types");
class UxEvaluator {
    id = 'ux';
    domain = 'UX';
    async evaluate(context) {
        const $ = cheerio.load(context.html);
        const issues = [];
        const viewport = $('meta[name="viewport"]').attr('content') ?? '';
        if (!viewport.includes('width=device-width')) {
            issues.push({
                id: 'R-UX-VIEWPORT',
                severity: 'critical',
                message: 'Missing responsive viewport meta tag.',
                location: '<head>',
                remedy: 'Set the viewport to width=device-width, initial-scale=1.'
            });
        }
        const textLength = $('body').text().trim().split(/\s+/).filter(Boolean).length;
        if (textLength < 150) {
            issues.push({
                id: 'R-UX-DEPTH',
                severity: 'warning',
                message: 'Page content is very short.',
                location: 'Body',
                remedy: 'Add useful page copy and section structure.'
            });
        }
        const shortParagraphs = $('p')
            .toArray()
            .filter((element) => {
            const words = $(element).text().trim().split(/\s+/).filter(Boolean).length;
            return words >= 10 && words <= 30;
        });
        if (shortParagraphs.length === 0 && textLength > 200) {
            issues.push({
                id: 'R-UX-READABILITY',
                severity: 'warning',
                message: 'Long-form content lacks concise supporting paragraphs.',
                location: 'Content body',
                remedy: 'Break dense sections into smaller, readable chunks.'
            });
        }
        // Inline Small Font Size Heuristic
        const tinyFontElements = $('[style]')
            .toArray()
            .filter((element) => {
            const style = $(element).attr('style') ?? '';
            const match = style.match(/font-size\s*:\s*(\d+)\s*px/i);
            if (match) {
                const size = parseInt(match[1], 10);
                return size < 12;
            }
            return false;
        });
        if (tinyFontElements.length > 0) {
            issues.push({
                id: 'R-UX-FONT-SMALL',
                severity: 'warning',
                message: `${tinyFontElements.length} elements use an inline font-size less than 12px.`,
                location: 'Body text style',
                remedy: 'Increase inline or class font sizes to at least 12px for standard readability.'
            });
        }
        // Navigation Menu Depth Check
        const getListDepth = (el) => {
            let maxSubDepth = 0;
            el.children('li').each((_, li) => {
                $(li).children('ul, ol').each((_, subList) => {
                    const depth = getListDepth($(subList));
                    if (depth > maxSubDepth) {
                        maxSubDepth = depth;
                    }
                });
            });
            return 1 + maxSubDepth;
        };
        let maxNavDepth = 0;
        $('nav, [class*="menu"]').each((_, container) => {
            $(container).find('> ul, > ol').each((_, rootList) => {
                const depth = getListDepth($(rootList));
                if (depth > maxNavDepth) {
                    maxNavDepth = depth;
                }
            });
        });
        if (maxNavDepth > 3) {
            issues.push({
                id: 'R-UX-NAV-DEPTH',
                severity: 'warning',
                message: `Navigation menu nesting depth is very deep at ${maxNavDepth} levels (limit is 3).`,
                location: 'Navigation',
                remedy: 'Simplify site navigation architecture to keep menus within 3 levels of depth.'
            });
        }
        const tapTargets = $('a, button').toArray();
        const tinyTargets = tapTargets.filter((element) => {
            const dataWidth = Number($(element).attr('data-width') ?? NaN);
            const dataHeight = Number($(element).attr('data-height') ?? NaN);
            if (!Number.isNaN(dataWidth) && !Number.isNaN(dataHeight)) {
                return dataWidth < 44 || dataHeight < 44;
            }
            const style = $(element).attr('style') ?? '';
            const wMatch = style.match(/width\s*:\s*(\d+)\s*px/i);
            const hMatch = style.match(/height\s*:\s*(\d+)\s*px/i);
            if (wMatch && hMatch) {
                const w = parseInt(wMatch[1], 10);
                const h = parseInt(hMatch[1], 10);
                return w < 48 || h < 48;
            }
            return false;
        });
        if (tinyTargets.length > 0) {
            issues.push({
                id: 'R-UX-TAP-TARGET',
                severity: 'warning',
                message: `${tinyTargets.length} tap targets appear too small.`,
                location: 'Interactive controls',
                remedy: 'Increase touch target size to at least 44px or 48px where possible.'
            });
        }
        const consentMentions = $('body')
            .text()
            .toLowerCase()
            .includes('cookie consent') || $('body').text().toLowerCase().includes('privacy');
        if (!consentMentions) {
            issues.push({
                id: 'R-UX-CONSENT',
                severity: 'info',
                message: 'No obvious privacy or consent messaging was found.',
                location: 'Body copy',
                remedy: 'If required by policy or jurisdiction, add clear consent and privacy affordances.'
            });
        }
        return {
            id: this.id,
            domain: this.domain,
            score: (0, types_1.scoreFromIssues)(issues),
            issues,
            metadata: {
                textLength,
                shortParagraphCount: shortParagraphs.length
            }
        };
    }
}
exports.UxEvaluator = UxEvaluator;
