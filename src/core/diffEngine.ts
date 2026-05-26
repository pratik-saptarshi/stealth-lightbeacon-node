import { DuckDbRuntime } from './db/duckdb';

export interface AuditDiff {
  improvements: Array<{ domainId: string; issueId: string; message: string; severity: string }>;
  regressions: Array<{ domainId: string; issueId: string; message: string; severity: string }>;
  unchanged: Array<{ domainId: string; issueId: string; message: string; severity: string }>;
}

export class DiffEngine {
  private readonly duck: DuckDbRuntime;

  constructor(duck: DuckDbRuntime) {
    this.duck = duck;
  }

  /**
   * Compares two historical audit runs stored in the DuckDB database.
   * Isolates improvements, regressions, and unchanged issues.
   */
  public async compareRuns(runIdA: string, runIdB: string): Promise<AuditDiff> {
    const queryA = await this.duck.query({
      sql: `SELECT DISTINCT domain_id, issue_id, message, severity FROM audit_findings WHERE run_id = ?`,
      params: [runIdA]
    });

    const queryB = await this.duck.query({
      sql: `SELECT DISTINCT domain_id, issue_id, message, severity FROM audit_findings WHERE run_id = ?`,
      params: [runIdB]
    });

    const findingsA = queryA.rows.map(row => ({
      domainId: String(row.domain_id),
      issueId: String(row.issue_id),
      message: String(row.message),
      severity: String(row.severity)
    }));

    const findingsB = queryB.rows.map(row => ({
      domainId: String(row.domain_id),
      issueId: String(row.issue_id),
      message: String(row.message),
      severity: String(row.severity)
    }));

    const key = (f: { domainId: string; issueId: string }) => `${f.domainId}:${f.issueId}`;

    const mapA = new Map(findingsA.map(f => [key(f), f]));
    const mapB = new Map(findingsB.map(f => [key(f), f]));

    const improvements = findingsA.filter(f => !mapB.has(key(f)));
    const regressions = findingsB.filter(f => !mapA.has(key(f)));
    const unchanged = findingsB.filter(f => mapA.has(key(f)));

    return {
      improvements,
      regressions,
      unchanged
    };
  }
}
