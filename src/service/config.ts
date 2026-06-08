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
    artifactRoot: parseArtifactRoot(input.artifactRoot)
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
