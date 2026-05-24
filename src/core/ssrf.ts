import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const IPV4_PRIVATE_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' }
] as const;

function ipv4ToInt(ipAddress: string): number {
  return ipAddress.split('.').reduce((value, part) => (value << 8) + Number(part), 0);
}

function isPrivateIpv4(ipAddress: string): boolean {
  const value = ipv4ToInt(ipAddress);
  return IPV4_PRIVATE_RANGES.some((range) => {
    return value >= ipv4ToInt(range.start) && value <= ipv4ToInt(range.end);
  });
}

function isPrivateIpv6(ipAddress: string): boolean {
  const normalized = ipAddress.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
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
