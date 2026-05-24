"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBudgets = validateBudgets;
function validateBudgets(report, budgetConfig) {
    const failures = [];
    for (const domain of report.domains) {
        const minScore = budgetConfig.minDomainScores?.[domain.id];
        if (typeof minScore === 'number' && domain.score < minScore) {
            failures.push(`Domain ${domain.id} score ${domain.score} is below minimum ${minScore}`);
        }
    }
    if (typeof budgetConfig.minLighthousePerformanceScore === 'number') {
        const performanceDomain = report.domains.find((domain) => domain.id === 'performance');
        const lighthouseScore = performanceDomain?.metadata.lighthousePerformanceScore;
        if (typeof lighthouseScore === 'number' && lighthouseScore < budgetConfig.minLighthousePerformanceScore) {
            failures.push(`Lighthouse performance score ${lighthouseScore} is below minimum ${budgetConfig.minLighthousePerformanceScore}`);
        }
    }
    return failures;
}
