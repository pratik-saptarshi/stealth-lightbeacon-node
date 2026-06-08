"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultReconRunner = void 0;
const recon_1 = require("../core/recon");
const ssrf_1 = require("../core/ssrf");
const defaultReconRunner = async (request) => {
    const guard = new ssrf_1.SSRFGuard({ allowPrivate: Boolean(request.allowPrivate) });
    return new recon_1.PreAuditRecon(guard).analyze(request.targetUrl);
};
exports.defaultReconRunner = defaultReconRunner;
