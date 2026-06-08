"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadServiceConfig = loadServiceConfig;
function loadServiceConfig(input = {}) {
    return {
        host: parseHost(input.host),
        port: parsePort(input.port),
        persistence: input.persistence !== false,
        version: parseVersion(input.version),
        clock: input.clock ?? (() => Date.now())
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
