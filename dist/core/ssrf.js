"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSRFGuard = exports.SSRFViolationError = void 0;
const node_net_1 = require("node:net");
const promises_1 = require("node:dns/promises");
const IPV4_PRIVATE_RANGES = [
    { start: '10.0.0.0', end: '10.255.255.255' },
    { start: '127.0.0.0', end: '127.255.255.255' },
    { start: '169.254.0.0', end: '169.254.255.255' },
    { start: '172.16.0.0', end: '172.31.255.255' },
    { start: '192.168.0.0', end: '192.168.255.255' }
];
function ipv4ToInt(ipAddress) {
    return ipAddress.split('.').reduce((value, part) => (value << 8) + Number(part), 0);
}
function isPrivateIpv4(ipAddress) {
    const value = ipv4ToInt(ipAddress);
    return IPV4_PRIVATE_RANGES.some((range) => {
        return value >= ipv4ToInt(range.start) && value <= ipv4ToInt(range.end);
    });
}
function isPrivateIpv6(ipAddress) {
    const normalized = ipAddress.toLowerCase();
    return (normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe80:'));
}
class SSRFViolationError extends Error {
}
exports.SSRFViolationError = SSRFViolationError;
class SSRFGuard {
    allowPrivate;
    static dnsCache = new Map();
    constructor(options = {}) {
        this.allowPrivate = options.allowPrivate ?? false;
    }
    async validate(urlValue) {
        const parsedUrl = new URL(urlValue);
        const host = parsedUrl.hostname;
        const cleanHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
        if ((0, node_net_1.isIP)(cleanHost)) {
            if (!this.allowPrivate && isPrivateAddress(cleanHost)) {
                throw new SSRFViolationError(`Blocked private or loopback address: ${cleanHost}`);
            }
            return;
        }
        const addresses = await resolveHost(cleanHost);
        if (addresses.length === 0) {
            throw new Error(`Failed to resolve host: ${cleanHost}`);
        }
        for (const address of addresses) {
            if (!this.allowPrivate && isPrivateAddress(address)) {
                throw new SSRFViolationError(`Blocked private or loopback address: ${address}`);
            }
        }
        // Pin the first resolved IP to prevent DNS rebinding
        SSRFGuard.dnsCache.set(host, addresses[0]);
    }
    getPinnedAddress(host) {
        return SSRFGuard.dnsCache.get(host);
    }
}
exports.SSRFGuard = SSRFGuard;
async function resolveHost(host) {
    const result = await (0, promises_1.lookup)(host, { all: true });
    return result.map((entry) => entry.address);
}
function isPrivateAddress(ipAddress) {
    const family = (0, node_net_1.isIP)(ipAddress);
    if (family === 4) {
        return isPrivateIpv4(ipAddress);
    }
    if (family === 6) {
        return isPrivateIpv6(ipAddress);
    }
    return false;
}
