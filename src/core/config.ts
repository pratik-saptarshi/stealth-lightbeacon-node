import { z } from 'zod';

export const reportFormatSchema = z.enum(['json', 'html', 'both', 'llm', 'geo-xml']);
export const engineSchema = z.enum(['http', 'rendered', 'fast', 'stealth']);

const runtimeOptionsSchema = z.object({
  outputDir: z.string().default('.'),
  format: reportFormatSchema.default('both'),
  crawlDepth: z.coerce.number().int().min(0).default(0),
  maxUrls: z.coerce.number().int().min(1).default(10),
  render: z.coerce.boolean().default(false),
  engine: engineSchema.default('http'),
  budgetPath: z.string().optional(),
  checkLinks: z.coerce.boolean().default(false),
  checkApi: z.coerce.boolean().default(false),
  allowPrivate: z.coerce.boolean().default(false),
  http2: z.coerce.boolean().default(false),
  pdf: z.coerce.boolean().default(true),
  apiKey: z.string().optional(),
  concurrency: z.coerce.number().int().min(1).max(20).default(4),
  throttleMs: z.coerce.number().int().min(0).max(60_000).default(0)
});

export type AuditEngine = z.infer<typeof engineSchema>;
export type ReportFormat = z.infer<typeof reportFormatSchema>;

export interface RuntimeOptions {
  outputDir: string;
  reportFormat: ReportFormat;
  crawlDepth: number;
  maxUrls: number;
  render: boolean;
  engine: AuditEngine;
  budgetPath?: string;
  checkLinks: boolean;
  checkApi: boolean;
  allowPrivate: boolean;
  http2: boolean;
  pdf: boolean;
  apiKey?: string;
  concurrency: number;
  throttleMs: number;
}

export function loadRuntimeOptions(input: Record<string, unknown>): RuntimeOptions {
  const parsed = runtimeOptionsSchema.parse(input);

  return {
    outputDir: parsed.outputDir,
    reportFormat: parsed.format,
    crawlDepth: parsed.crawlDepth,
    maxUrls: parsed.maxUrls,
    render: parsed.render,
    engine: parsed.engine,
    budgetPath: parsed.budgetPath,
    checkLinks: parsed.checkLinks,
    checkApi: parsed.checkApi,
    allowPrivate: parsed.allowPrivate,
    http2: parsed.http2,
    pdf: parsed.pdf,
    apiKey: parsed.apiKey,
    concurrency: parsed.concurrency,
    throttleMs: parsed.throttleMs
  };
}
