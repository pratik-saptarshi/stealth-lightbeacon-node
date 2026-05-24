import { z } from 'zod';
import { dbRuntimeInputSchema, type DbRuntimeInput } from './schemas';
import { DEFAULT_DB_TIMEOUT_MS } from './timeouts';

export const dbRuntimeContextSchema = dbRuntimeInputSchema;

export interface DbRuntimeContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  abort(reason?: unknown): void;
}

export function resolveDbRuntimeInput(input: unknown = {}): DbRuntimeInput {
  return dbRuntimeInputSchema.parse(input);
}

export function createDbRuntimeContext(input: unknown = {}): DbRuntimeContext {
  const parsed = resolveDbRuntimeInput(input);
  const controller = new AbortController();

  return {
    abort(reason?: unknown) {
      controller.abort(reason);
    },
    signal: controller.signal,
    timeoutMs: parsed.timeoutMs
  };
}

export function resolveDbTimeoutMs(input: unknown = {}): number {
  const parsed = dbRuntimeInputSchema.parse(input);
  return parsed.timeoutMs;
}

export const dbRuntimeDefaultsSchema = z
  .object({
    timeoutMs: z.number().int().positive().default(DEFAULT_DB_TIMEOUT_MS)
  })
  .strict();

export type DbRuntimeDefaults = z.infer<typeof dbRuntimeDefaultsSchema>;
