import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';

const IPV4_NON_GLOBAL_RANGES = [
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '100.64.0.0', end: '100.127.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.0.0.0', end: '192.0.0.255' },
  { start: '192.0.2.0', end: '192.0.2.255' },
  { start: '192.88.99.0', end: '192.88.99.255' },
  { start: '192.168.0.0', end: '192.168.255.255' },
  { start: '198.18.0.0', end: '198.19.255.255' },
  { start: '198.51.100.0', end: '198.51.100.255' },
  { start: '203.0.113.0', end: '203.0.113.255' },
  { start: '224.0.0.0', end: '239.255.255.255' },
  { start: '240.0.0.0', end: '255.255.255.255' }
] as const;

function ipv4ToInt(ipAddress: string): number {
  return ipAddress.split('.').reduce((value, part) => ((value << 8) + Number(part)) >>> 0, 0);
}

function isPrivateIpv4(ipAddress: string): boolean {
  const value = ipv4ToInt(ipAddress);
  return IPV4_NON_GLOBAL_RANGES.some((range) => {
    return value >= ipv4ToInt(range.start) && value <= ipv4ToInt(range.end);
  });
}

const IPV6_NON_GLOBAL_RANGES = [
  { start: '::', end: '::' },
  { start: '::1', end: '::1' },
  { start: '::ffff:0:0', end: '::ffff:ffff:ffff' },
  { start: '64:ff9b:1::', end: '64:ff9b:1:ffff:ffff:ffff:ffff:ffff' },
  { start: '100::', end: '100::ffff:ffff:ffff:ffff' },
  { start: '2001::', end: '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: '2001:2::', end: '2001:2:0:ffff:ffff:ffff:ffff:ffff' },
  { start: '2001:db8::', end: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: '2002::', end: '2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: 'fc00::', end: 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: 'fe80::', end: 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff' },
  { start: 'ff00::', end: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' }
] as const;

function expandIpv6Parts(ipAddress: string): number[] {
  const ipv4Match = ipAddress.match(/(.+:)(\d+\.\d+\.\d+\.\d+)$/);
  const normalized = ipv4Match
    ? `${ipv4Match[1]}${(ipv4ToInt(ipv4Match[2]) >>> 16).toString(16)}:${(ipv4ToInt(ipv4Match[2]) & 0xffff).toString(16)}`
    : ipAddress;
  const [head, tail = ''] = normalized.toLowerCase().split('::');
  const headParts = head ? head.split(':').map((part) => Number.parseInt(part, 16)) : [];
  const tailParts = tail ? tail.split(':').map((part) => Number.parseInt(part, 16)) : [];
  const fillParts = new Array(8 - headParts.length - tailParts.length).fill(0);

  return [...headParts, ...fillParts, ...tailParts];
}

function ipv6ToBigInt(ipAddress: string): bigint {
  return expandIpv6Parts(ipAddress).reduce((value, part) => (value << 16n) + BigInt(part), 0n);
}

function isPrivateIpv6(ipAddress: string): boolean {
  const value = ipv6ToBigInt(ipAddress);
  return IPV6_NON_GLOBAL_RANGES.some((range) => {
    return value >= ipv6ToBigInt(range.start) && value <= ipv6ToBigInt(range.end);
  });
}

export class SSRFViolationError extends Error {}

export interface SSRFGuardOptions {
  allowPrivate?: boolean;
}

export class SSRFGuard {
  private readonly allowPrivate: boolean;
  public static readonly dnsCache = new Map<string, string>();

  constructor(options: SSRFGuardOptions = {}) {
    this.allowPrivate = options.allowPrivate ?? false;
  }

  async validate(urlValue: string): Promise<void> {
    const parsedUrl = new URL(urlValue);
    const host = parsedUrl.hostname;
    const cleanHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

    if (isIP(cleanHost)) {
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

  getPinnedAddress(host: string): string | undefined {
    return SSRFGuard.dnsCache.get(host);
  }
}

async function resolveHost(host: string): Promise<string[]> {
  const result = await lookup(host, { all: true });
  return result.map((entry) => entry.address);
}

function isPrivateAddress(ipAddress: string): boolean {
  const family = isIP(ipAddress);
  if (family === 4) {
    return isPrivateIpv4(ipAddress);
  }
  if (family === 6) {
    return isPrivateIpv6(ipAddress);
  }
  return false;
}

export class SSRFGuardHttpAgent extends http.Agent {
  constructor(private readonly guard: SSRFGuard, options?: http.AgentOptions) {
    super(options);
  }

  override createConnection(options: any, callback: any): any {
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

export class SSRFGuardHttpsAgent extends https.Agent {
  constructor(private readonly guard: SSRFGuard, options?: https.AgentOptions) {
    super(options);
  }

  override createConnection(options: any, callback: any): any {
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

export function getSSRFGuardAgents(guard: SSRFGuard) {
  return {
    httpAgent: new SSRFGuardHttpAgent(guard),
    httpsAgent: new SSRFGuardHttpsAgent(guard)
  };
}
