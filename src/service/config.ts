import type { AuditRunner } from './auditRunner';
import type { ReconRunner } from './reconRunner';

export interface ServiceConfig {
  host: string;
  port: number;
  persistence: boolean;
  version: string;
  clock: () => number;
  auditRunner?: AuditRunner;
  reconRunner?: ReconRunner;
  artifactRoot: string;
  authToken?: string;
  allowUnsafePublicHttp: boolean;
  allowPrivateRecon: boolean;
  tls?: {
    keyPath: string;
    certPath: string;
  };
}

export interface ServiceConfigInput {
  host?: unknown;
  port?: unknown;
  persistence?: unknown;
  version?: unknown;
  clock?: () => number;
  auditRunner?: AuditRunner;
  reconRunner?: ReconRunner;
  artifactRoot?: unknown;
  authToken?: unknown;
  allowUnsafePublicHttp?: unknown;
  allowPrivateRecon?: unknown;
  tlsKeyPath?: unknown;
  tlsCertPath?: unknown;
}

export function loadServiceConfig(input: ServiceConfigInput = {}): ServiceConfig {
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
    tls: parseTls(input.tlsKeyPath, input.tlsCertPath)
  };
}

function parseHost(host: unknown): string {
  return typeof host === 'string' && host.trim() ? host.trim() : '127.0.0.1';
}

function parsePort(port: unknown): number {
  const parsed = Number(port ?? 8787);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return 8787;
  }
  return parsed;
}

function parseVersion(version: unknown): string {
  return typeof version === 'string' && version.trim() ? version.trim() : '3.0.11';
}

function parseArtifactRoot(artifactRoot: unknown): string {
  return typeof artifactRoot === 'string' && artifactRoot.trim()
    ? artifactRoot.trim()
    : 'reports/service-artifacts';
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseTls(keyPath: unknown, certPath: unknown): ServiceConfig['tls'] {
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
