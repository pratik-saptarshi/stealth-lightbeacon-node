"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreFromIssues = scoreFromIssues;
const severityPenalty = {
    critical: 2.5,
    warning: 1,
    info: 0.25,
    pass: 0
};
function scoreFromIssues(issues, baseScore = 10) {
    const score = issues.reduce((total, issue) => total - severityPenalty[issue.severity], baseScore);
    return Math.max(0, Number(score.toFixed(1)));
}
