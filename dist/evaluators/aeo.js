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
exports.AeoEvaluator = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../core/types");
class AeoEvaluator {
    id = 'aeo';
    domain = 'Answer Engine Optimization';
    async evaluate(context) {
        const $ = cheerio.load(context.html);
        const issues = [];
        const schemas = $('script[type="application/ld+json"]').toArray();
        let hasFaqOrHowTo = false;
        for (const element of schemas) {
            const content = $(element).html();
            if (!content) {
                continue;
            }
            try {
                const parsed = JSON.parse(content);
                const serialized = JSON.stringify(parsed);
                if (serialized.includes('FAQPage') || serialized.includes('QAPage') || serialized.includes('HowTo')) {
                    hasFaqOrHowTo = true;
                }
            }
            catch {
                continue;
            }
        }
        if (!hasFaqOrHowTo) {
            issues.push({
                id: 'R-AEO-SCHEMA',
                severity: 'warning',
                message: 'FAQPage, QAPage, or HowTo schema was not detected.',
                location: 'JSON-LD',
                remedy: 'Add FAQ/HowTo structured data for snippet eligibility.'
            });
        }
        const questionHeadings = $('h2, h3')
            .toArray()
            .filter((element) => /^(who|what|where|when|why|how)\b/i.test($(element).text().trim()));
        if (questionHeadings.length === 0) {
            issues.push({
                id: 'R-AEO-QUESTIONS',
                severity: 'warning',
                message: 'No question-oriented headings were detected.',
                location: 'Headings',
                remedy: 'Add query-shaped headings that match real user questions.'
            });
        }
        const conciseParagraphs = $('p')
            .toArray()
            .filter((element) => {
            const words = $(element).text().trim().split(/\s+/).filter(Boolean).length;
            return words >= 10 && words <= 50;
        });
        if (conciseParagraphs.length === 0) {
            issues.push({
                id: 'R-AEO-CONCISE',
                severity: 'warning',
                message: 'No concise answer-style paragraphs were detected.',
                location: 'Paragraphs',
                remedy: 'Add short direct-answer paragraphs near question headings.'
            });
        }
        return {
            id: this.id,
            domain: this.domain,
            score: (0, types_1.scoreFromIssues)(issues),
            issues,
            metadata: {
                questionHeadingCount: questionHeadings.length,
                conciseParagraphCount: conciseParagraphs.length
            }
        };
    }
}
exports.AeoEvaluator = AeoEvaluator;
