"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadServiceConfig = loadServiceConfig;
function loadServiceConfig(input = {}) {
    return {
        host: parseHost(input.host),
        port: parsePort(input.port),
        persistence: input.persistence !== false,
        version: parseVersion(input.version),
        clock: input.clock ?? (() => Date.now()),
        auditRunner: input.auditRunner,
        reconRunner: input.reconRunner,
        artifactRoot: parseArtifactRoot(input.artifactRoot),
        authToken: parseOptionalString(input.authToken),
        allowUnsafePublicHttp: input.allowUnsafePublicHttp === true,
        allowPrivateRecon: input.allowPrivateRecon === true,
        jsonBodyLimitBytes: parseJsonBodyLimitBytes(input.jsonBodyLimitBytes),
        tls: parseTls(input.tlsKeyPath, input.tlsCertPath)
    };
}
function parseHost(host) {
    return typeof host === 'string' && host.trim() ? host.trim() : '127.0.0.1';
}
function parsePort(port) {
    const parsed = Number(port ?? 8787);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        return 8787;
    }
    return parsed;
}
function parseVersion(version) {
    return typeof version === 'string' && version.trim() ? version.trim() : '3.0.11';
}
function parseArtifactRoot(artifactRoot) {
    return typeof artifactRoot === 'string' && artifactRoot.trim()
        ? artifactRoot.trim()
        : 'reports/service-artifacts';
}
function parseJsonBodyLimitBytes(limit) {
    const parsed = Number(limit ?? 64 * 1024);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return 64 * 1024;
    }
    return parsed;
}
function parseOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function parseTls(keyPath, certPath) {
    const key = parseOptionalString(keyPath);
    const cert = parseOptionalString(certPath);
    if (!key && !cert) {
        return undefined;
    }
    return {
        keyPath: key ?? '',
        certPath: cert ?? ''
    };
}
