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
exports.DrupalSecurityEvaluator = void 0;
const cheerio = __importStar(require("cheerio"));
const types_1 = require("../core/types");
function asHeaderList(header) {
    if (!header) {
        return [];
    }
    return Array.isArray(header) ? header : [header];
}
class DrupalSecurityEvaluator {
    id = 'drupal-security';
    domain = 'Drupal & Security Headers';
    async evaluate(context) {
        const $ = cheerio.load(context.html);
        const issues = [];
        const generator = $('meta[name="generator"]').attr('content') ?? '';
        if (generator.toLowerCase().includes('drupal')) {
            issues.push({
                id: 'R-DRUP-FINGERPRINT',
                severity: 'info',
                message: `Drupal generator tag exposed: ${generator}`,
                location: '<meta name="generator">',
                remedy: 'Hide generator signatures where possible.'
            });
        }
        const assetUrls = $('link[href], script[src], img[src]')
            .toArray()
            .map((element) => $(element).attr('href') ?? $(element).attr('src') ?? '');
        if (assetUrls.some((value) => value.includes('/sites/default/') || value.includes('/core/assets/'))) {
            issues.push({
                id: 'R-DRUP-CORE-PATHS',
                severity: 'info',
                message: 'Drupal core or default file paths are exposed in asset URLs.',
                location: 'Asset references',
                remedy: 'Use proxy rewrites or hardened asset delivery where footprint reduction matters.'
            });
        }
        pushMissingHeaderIssue(issues, context.headers['content-security-policy'], 'R-SEC-CSP-MISS', 'Content-Security-Policy');
        pushMissingHeaderIssue(issues, context.headers['strict-transport-security'], 'R-SEC-HSTS-MISS', 'Strict-Transport-Security');
        pushMissingHeaderIssue(issues, context.headers['x-frame-options'], 'R-SEC-XFRAME-MISS', 'X-Frame-Options', 'warning');
        const xContentType = context.headers['x-content-type-options'];
        if (typeof xContentType !== 'string' || !xContentType.toLowerCase().includes('nosniff')) {
            issues.push({
                id: 'R-SEC-XCONTENT-MISS',
                severity: 'warning',
                message: "X-Content-Type-Options is missing or does not include 'nosniff'.",
                location: 'HTTP header',
                remedy: "Set X-Content-Type-Options to 'nosniff'."
            });
        }
        for (const cookieHeader of asHeaderList(context.headers['set-cookie'])) {
            const lower = cookieHeader.toLowerCase();
            const missingFlags = ['httponly', 'secure', 'samesite'].filter((flag) => !lower.includes(flag));
            if (missingFlags.length > 0) {
                issues.push({
                    id: 'R-SEC-COOKIE-INSECURE',
                    severity: 'warning',
                    message: `Cookie is missing security flags: ${missingFlags.join(', ')}`,
                    location: 'Set-Cookie',
                    remedy: 'Apply HttpOnly, Secure, and SameSite to session cookies.'
                });
            }
        }
        const jsonApiBody = context.auxiliaryResponses?.jsonApiUser;
        if (jsonApiBody?.status === 200 && jsonApiBody.body.includes('user--user')) {
            issues.push({
                id: 'R-DRUP-API-EXPOSED',
                severity: 'critical',
                message: 'Drupal JSON:API user endpoint appears publicly exposed.',
                location: '/jsonapi/user/user',
                remedy: 'Disable or restrict JSON:API user exposure.'
            });
        }
        return {
            id: this.id,
            domain: this.domain,
            score: (0, types_1.scoreFromIssues)(issues),
            issues,
            metadata: {
                generator,
                hasJsonApiExposure: issues.some((issue) => issue.id === 'R-DRUP-API-EXPOSED')
            }
        };
    }
}
exports.DrupalSecurityEvaluator = DrupalSecurityEvaluator;
function pushMissingHeaderIssue(issues, headerValue, issueId, headerName, severity = 'critical') {
    const isMissing = Array.isArray(headerValue) ? headerValue.length === 0 : !headerValue;
    if (!isMissing) {
        return;
    }
    issues.push({
        id: issueId,
        severity,
        message: `Missing ${headerName} header.`,
        location: 'HTTP header',
        remedy: `Configure ${headerName} for Drupal responses.`
    });
}
