import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DuckDBConnection, DuckDBInstance, DuckDBValue } from '@duckdb/node-api';
import {
  duckDbExecInputSchema,
  duckDbExecOutputSchema,
  duckDbQueryInputSchema,
  duckDbQueryOutputSchema,
  duckDbRuntimeInputSchema,
  type DuckDbQueryInput,
  type DuckDbExecInput,
  type DuckDbExecOutput,
  type DuckDbQueryOutput,
  type DuckDbRuntimeInput
} from './schemas';
import { withHardTimeout } from './timeouts';

type DuckDbApi = typeof import('@duckdb/node-api');

export interface DuckDbRuntime {
  readonly connection: DuckDBConnection;
  readonly databasePath: string;
  readonly instance: DuckDBInstance;
  readonly tempDirectory: string;
  close(): Promise<void>;
  exec(input: unknown): Promise<DuckDbExecOutput>;
  query(input: unknown): Promise<DuckDbQueryOutput>;
}

async function loadDuckDbApi(): Promise<DuckDbApi> {
  return (await import('@duckdb/node-api')) as DuckDbApi;
}

function createTempDirectory(tempDirectory?: string): { path: string; owned: boolean } {
  if (tempDirectory) {
    mkdirSync(tempDirectory, { recursive: true });
    return { owned: false, path: tempDirectory };
  }

  return {
    owned: true,
    path: mkdtempSync(join(tmpdir(), `stealth-lightbeacon-node-duckdb-${process.pid}-`))
  };
}

function resolveDuckDbOptions(input: DuckDbRuntimeInput): Record<string, string> {
  return {
    memory_limit: input.memoryLimit,
    temp_directory: input.tempDirectory ?? '',
    threads: String(input.threads)
  };
}

function normalizeParams(params: DuckDbQueryInput['params']): DuckDBValue[] | Record<string, DuckDBValue> | undefined {
  if (!params) {
    return undefined;
  }

  return params as DuckDBValue[] | Record<string, DuckDBValue>;
}

async function readQueryResult(
  connection: DuckDBConnection,
  input: DuckDbQueryInput
): Promise<DuckDbQueryOutput> {
  const startedAt = performance.now();
  const result = await connection.runAndReadAll(input.sql, normalizeParams(input.params) as never);
  const rows = await result.getRowObjectsJson();
  const output = {
    columns: result.columnNames(),
    elapsedMs: Math.round(performance.now() - startedAt),
    rowCount: rows.length,
    rows
  };

  return duckDbQueryOutputSchema.parse(output);
}

async function runStatement(connection: DuckDBConnection, input: DuckDbExecInput): Promise<DuckDbExecOutput> {
  const startedAt = performance.now();
  await connection.run(input.sql, normalizeParams(input.params) as never);

  return duckDbExecOutputSchema.parse({
    elapsedMs: Math.round(performance.now() - startedAt),
    ok: true,
    result: {},
    tool: 'duckdb.exec'
  });
}

export async function createDuckDbRuntime(input: unknown = {}): Promise<DuckDbRuntime> {
  const parsed = duckDbRuntimeInputSchema.parse(input);
  const { DuckDBInstance } = await loadDuckDbApi();
  const tempDirectoryInfo = createTempDirectory(parsed.tempDirectory);
  const instance = await DuckDBInstance.create(
    parsed.databasePath,
    resolveDuckDbOptions({ ...parsed, tempDirectory: tempDirectoryInfo.path })
  );
  const connection = await instance.connect();
  let closed = false;

  return {
    connection,
    databasePath: parsed.databasePath,
    instance,
    tempDirectory: tempDirectoryInfo.path,
    async close() {
      if (closed) {
        return;
      }

      closed = true;

      try {
        await new Promise<void>((resolve, reject) => {
          setImmediate(() => {
            try {
              connection.disconnectSync();
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });
      } finally {
        await new Promise<void>((resolve, reject) => {
          setImmediate(() => {
            try {
              instance.closeSync();
              resolve();
            } catch (err) {
              reject(err);
            }
          });
        });

        if (tempDirectoryInfo.owned) {
          rmSync(tempDirectoryInfo.path, { force: true, recursive: true });
        }
      }
    },
    async query(queryInput: unknown): Promise<DuckDbQueryOutput> {
      const parsedQuery = duckDbQueryInputSchema.parse(queryInput);
      return withHardTimeout(
        signal => {
          if (signal.aborted) {
            throw signal.reason ?? new Error('DuckDB query aborted');
          }

          return readQueryResult(connection, parsedQuery);
        },
        {
          label: 'DuckDB query',
          timeoutMs: parsedQuery.timeoutMs
        }
      );
    },
    async exec(execInput: unknown): Promise<DuckDbExecOutput> {
      const parsedExec = duckDbExecInputSchema.parse(execInput);
      return withHardTimeout(
        signal => {
          if (signal.aborted) {
            throw signal.reason ?? new Error('DuckDB statement aborted');
          }

          return runStatement(connection, parsedExec);
        },
        {
          label: 'DuckDB statement',
          timeoutMs: parsedExec.timeoutMs
        }
      );
    }
  };
}
