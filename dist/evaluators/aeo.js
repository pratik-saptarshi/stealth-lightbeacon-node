"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AeoEvaluator = void 0;
const cheerio = require("cheerio");
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
        const microdataTypes = $('[itemtype]').toArray().map(el => $(el).attr('itemtype') || '');
        const hasMicrodataFaqOrHowTo = microdataTypes.some(type => type.includes('FAQPage') || type.includes('QAPage') || type.includes('HowTo'));
        if (hasMicrodataFaqOrHowTo) {
            hasFaqOrHowTo = true;
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
