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
exports.AccessibilityEvaluator = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../core/types");
class AccessibilityEvaluator {
    id = 'accessibility';
    domain = 'Accessibility';
    async evaluate(context) {
        const $ = cheerio.load(context.html);
        const issues = [];
        const imagesWithoutAlt = $('img')
            .toArray()
            .filter((element) => !($(element).attr('alt') ?? '').trim());
        if (imagesWithoutAlt.length > 0) {
            issues.push({
                id: 'R-A11Y-IMG-ALT',
                severity: imagesWithoutAlt.length > 2 ? 'critical' : 'warning',
                message: `${imagesWithoutAlt.length} images are missing alt text.`,
                location: 'Images',
                remedy: 'Add meaningful alt text to decorative and informative images.'
            });
        }
        const badAltImages = $('img')
            .toArray()
            .filter((element) => {
            const alt = ($(element).attr('alt') ?? '').trim().toLowerCase();
            if (!alt) {
                return false;
            }
            if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(alt)) {
                return true;
            }
            const genericTerms = ['image', 'img', 'photo', 'picture', 'pic', 'logo', 'icon', 'graphic'];
            return genericTerms.includes(alt);
        });
        if (badAltImages.length > 0) {
            issues.push({
                id: 'R-A11Y-ALT-BAD',
                severity: 'warning',
                message: `${badAltImages.length} images use generic or filename terms as alt text.`,
                location: 'Images',
                remedy: 'Replace generic or file-named alt attributes with descriptive text.'
            });
        }
        const inputsWithoutLabels = $('input, select, textarea')
            .toArray()
            .filter((element) => {
            const type = $(element).attr('type');
            if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset') {
                return false;
            }
            const id = $(element).attr('id');
            const ariaLabel = $(element).attr('aria-label');
            const ariaLabelledBy = $(element).attr('aria-labelledby');
            const parentLabel = $(element).closest('label').length > 0;
            const hasAssociatedLabel = id ? $(`label[for="${id}"]`).length > 0 : false;
            return !hasAssociatedLabel && !parentLabel && !ariaLabel && !ariaLabelledBy;
        });
        if (inputsWithoutLabels.length > 0) {
            issues.push({
                id: 'R-A11Y-FORM-LABEL',
                severity: 'critical',
                message: `${inputsWithoutLabels.length} form controls lack an accessible label.`,
                location: 'Forms',
                remedy: 'Add labels, aria-label, or aria-labelledby to every form control.'
            });
            // Maintain R-A11Y-LABELS for backward compatibility if any test depends on it
            issues.push({
                id: 'R-A11Y-LABELS',
                severity: 'critical',
                message: `${inputsWithoutLabels.length} form controls lack an accessible label.`,
                location: 'Forms',
                remedy: 'Add labels, aria-label, or aria-labelledby to every form control.'
            });
        }
        const headingCounts = [1, 2, 3, 4, 5, 6].map((level) => $(`h${level}`).length);
        const missingH1 = headingCounts[0] === 0;
        if (missingH1) {
            issues.push({
                id: 'R-A11Y-H1',
                severity: 'critical',
                message: 'No H1 heading found.',
                location: 'Document headings',
                remedy: 'Provide one primary H1 for the page.'
            });
        }
        // Modern skipped heading check walking DOM order
        let lastHeadingLevel = 0;
        let headingSkipCount = 0;
        $('h1, h2, h3, h4, h5, h6').each((_, element) => {
            const level = parseInt(element.tagName.substring(1), 10);
            if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
                headingSkipCount++;
            }
            lastHeadingLevel = level;
        });
        if (headingSkipCount > 0) {
            issues.push({
                id: 'R-A11Y-HEAD-SKIP',
                severity: 'warning',
                message: `Heading hierarchy skips levels ${headingSkipCount} times.`,
                location: 'Document headings',
                remedy: 'Keep heading levels sequential in document order.'
            });
        }
        const skippedHeadingLevel = headingCounts.some((count, index) => {
            if (index === 0 || count === 0) {
                return false;
            }
            return index > 0 && headingCounts.slice(1, index).every((count) => count === 0);
        });
        if (skippedHeadingLevel) {
            issues.push({
                id: 'R-A11Y-HEADING-ORDER',
                severity: 'warning',
                message: 'Heading hierarchy appears to skip levels.',
                location: 'Document headings',
                remedy: 'Keep heading levels sequential where possible.'
            });
        }
        const emptyInteractive = $('a, button')
            .toArray()
            .filter((element) => {
            const text = $(element).text().trim();
            const ariaLabel = $(element).attr('aria-label')?.trim();
            const ariaLabelledBy = $(element).attr('aria-labelledby')?.trim();
            return !text && !ariaLabel && !ariaLabelledBy;
        });
        if (emptyInteractive.length > 0) {
            issues.push({
                id: 'R-A11Y-IA-EMPTY',
                severity: 'warning',
                message: `${emptyInteractive.length} interactive elements (links or buttons) are empty and lack accessible labels.`,
                location: 'Interactive controls',
                remedy: 'Add visible text, aria-label, or aria-labelledby to empty interactive elements.'
            });
        }
        const buttonsWithoutText = $('button, [role="button"]')
            .toArray()
            .filter((element) => {
            const text = $(element).text().trim();
            const ariaLabel = $(element).attr('aria-label');
            return !text && !ariaLabel;
        });
        if (buttonsWithoutText.length > 0) {
            issues.push({
                id: 'R-A11Y-BUTTON-TEXT',
                severity: 'warning',
                message: `${buttonsWithoutText.length} buttons lack visible text or aria-labels.`,
                location: 'Interactive controls',
                remedy: 'Give interactive controls accessible names.'
            });
        }
        return {
            id: this.id,
            domain: this.domain,
            score: (0, types_1.scoreFromIssues)(issues),
            issues,
            metadata: {
                missingAltCount: imagesWithoutAlt.length,
                unlabeledControlCount: inputsWithoutLabels.length
            }
        };
    }
}
exports.AccessibilityEvaluator = AccessibilityEvaluator;
