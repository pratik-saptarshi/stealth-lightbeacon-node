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
exports.SSRFGuardHttpsAgent = exports.SSRFGuardHttpAgent = exports.SSRFGuard = exports.SSRFViolationError = void 0;
exports.getSSRFGuardAgents = getSSRFGuardAgents;
const node_net_1 = require("node:net");
const promises_1 = require("node:dns/promises");
const http = __importStar(require("node:http"));
const https = __importStar(require("node:https"));
const net = __importStar(require("node:net"));
const tls = __importStar(require("node:tls"));
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
            SSRFGuard.dnsCache.set(host, cleanHost);
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
class SSRFGuardHttpAgent extends http.Agent {
    guard;
    constructor(guard, options) {
        super(options);
        this.guard = guard;
    }
    createConnection(options, callback) {
        const host = options.host || options.hostname;
        const pinnedIp = this.guard.getPinnedAddress(host);
        if (!pinnedIp) {
            const err = new SSRFViolationError(`Unvalidated host: ${host}`);
            if (callback) {
                callback(err);
            }
            throw err;
        }
        options.host = pinnedIp;
        options.hostname = pinnedIp;
        return net.createConnection(options, callback);
    }
}
exports.SSRFGuardHttpAgent = SSRFGuardHttpAgent;
class SSRFGuardHttpsAgent extends https.Agent {
    guard;
    constructor(guard, options) {
        super(options);
        this.guard = guard;
    }
    createConnection(options, callback) {
        const host = options.host || options.hostname;
        const pinnedIp = this.guard.getPinnedAddress(host);
        if (!pinnedIp) {
            const err = new SSRFViolationError(`Unvalidated host: ${host}`);
            if (callback) {
                callback(err);
            }
            throw err;
        }
        options.host = pinnedIp;
        options.hostname = pinnedIp;
        if (!options.servername) {
            options.servername = host;
        }
        return tls.connect(options, callback);
    }
}
exports.SSRFGuardHttpsAgent = SSRFGuardHttpsAgent;
function getSSRFGuardAgents(guard) {
    return {
        httpAgent: new SSRFGuardHttpAgent(guard),
        httpsAgent: new SSRFGuardHttpsAgent(guard)
    };
}
