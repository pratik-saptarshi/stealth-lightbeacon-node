import { performance } from 'node:perf_hooks';
import type { ConnectionOptions } from '@lancedb/lancedb';
import {
  lanceDbCreateTableInputSchema,
  lanceDbCreateTableOutputSchema,
  lanceDbInsertInputSchema,
  lanceDbInsertOutputSchema,
  lanceDbRuntimeInputSchema,
  lanceDbSearchInputSchema,
  lanceDbSearchOutputSchema,
  type LanceDbCreateTableInput,
  type LanceDbCreateTableOutput,
  type LanceDbInsertInput,
  type LanceDbInsertOutput,
  type LanceDbRuntimeInput,
  type LanceDbSearchInput,
  type LanceDbSearchOutput
} from './schemas';
import { withHardTimeout } from './timeouts';

type LanceDbApi = typeof import('@lancedb/lancedb');
type LanceDbConnection = Awaited<ReturnType<LanceDbApi['connect']>>;
type LanceDbTable = Awaited<ReturnType<LanceDbConnection['openTable']>>;

export interface LanceDbRuntime {
  readonly connection: LanceDbConnection;
  readonly uri: string;
  close(): Promise<void>;
  createTable(input: unknown): Promise<LanceDbCreateTableOutput>;
  insert(input: unknown): Promise<LanceDbInsertOutput>;
  search(input: unknown): Promise<LanceDbSearchOutput>;
}

async function loadLanceDbApi(): Promise<LanceDbApi> {
  return (await import('@lancedb/lancedb')) as LanceDbApi;
}

async function openLanceDbConnection(input: LanceDbRuntimeInput): Promise<LanceDbConnection> {
  const { connect } = await loadLanceDbApi();
  const options: Partial<ConnectionOptions> & { uri: string } = {
    uri: input.uri
  };

  return connect(options);
}

async function openTable(connection: LanceDbConnection, name: string): Promise<LanceDbTable> {
  return connection.openTable(name);
}

function toFloat32Vector(vector: number[]): Float32Array {
  return Float32Array.from(vector);
}

export async function createLanceDbRuntime(input: unknown = {}): Promise<LanceDbRuntime> {
  const parsed = lanceDbRuntimeInputSchema.parse(input);
  const connection = await openLanceDbConnection(parsed);
  let closed = false;

  return {
    connection,
    uri: parsed.uri,
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      connection.close();
    },
    async createTable(tableInput: unknown): Promise<LanceDbCreateTableOutput> {
      const parsedInput = lanceDbCreateTableInputSchema.parse(tableInput);

      return withHardTimeout(
        async () => {
          const startedAt = performance.now();
          await connection.createTable({
            data: parsedInput.data,
            mode: parsedInput.mode,
            name: parsedInput.name
          } as never);

          return lanceDbCreateTableOutputSchema.parse({
            elapsedMs: Math.round(performance.now() - startedAt),
            mode: parsedInput.mode,
            ok: true,
            rowCount: parsedInput.data.length,
            table: parsedInput.name
          });
        },
        {
          label: 'LanceDB createTable',
          timeoutMs: parsedInput.timeoutMs
        }
      );
    },
    async insert(insertInput: unknown): Promise<LanceDbInsertOutput> {
      const parsedInput = lanceDbInsertInputSchema.parse(insertInput);
      const table = await openTable(connection, parsedInput.table);

      return withHardTimeout(
        async () => {
          const startedAt = performance.now();
          await table.add(parsedInput.data, { mode: 'append' } as never);

          return lanceDbInsertOutputSchema.parse({
            elapsedMs: Math.round(performance.now() - startedAt),
            ok: true,
            rowCount: parsedInput.data.length,
            table: parsedInput.table
          });
        },
        {
          label: 'LanceDB insert',
          timeoutMs: parsedInput.timeoutMs
        }
      );
    },
    async search(searchInput: unknown): Promise<LanceDbSearchOutput> {
      const parsedInput = lanceDbSearchInputSchema.parse(searchInput);
      const table = await openTable(connection, parsedInput.table);

      return withHardTimeout(
        async () => {
          const startedAt = performance.now();
          let query = table.vectorSearch(toFloat32Vector(parsedInput.vector));

          if (parsedInput.where) {
            query = query.where(parsedInput.where);
          }

          const rows = await query.limit(parsedInput.limit).toArray();

          return lanceDbSearchOutputSchema.parse({
            elapsedMs: Math.round(performance.now() - startedAt),
            ok: true,
            rowCount: rows.length,
            rows,
            table: parsedInput.table
          });
        },
        {
          label: 'LanceDB search',
          timeoutMs: parsedInput.timeoutMs
        }
      );
    }
  };
}

export type { LanceDbRuntimeInput };
