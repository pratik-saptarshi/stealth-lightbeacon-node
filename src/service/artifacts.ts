import { createReadStream, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { ReadStream } from 'node:fs';

export interface ArtifactManifestEntry {
  name: string;
  sizeBytes: number;
  contentType: string;
}

export interface ArtifactFile {
  name: string;
  path: string;
  contentType: string;
  stream: ReadStream;
}

export class ArtifactStore {
  constructor(private readonly rootDir: string) {}

  list(evaluationId: string): ArtifactManifestEntry[] {
    const evaluationDir = this.evaluationDir(evaluationId);
    try {
      return readdirSync(evaluationDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const artifactPath = resolve(evaluationDir, entry.name);
          return {
            name: entry.name,
            sizeBytes: statSync(artifactPath).size,
            contentType: contentTypeFor(entry.name)
          };
        })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      return [];
    }
  }

  open(evaluationId: string, rawName: string): ArtifactFile | 'invalid' | undefined {
    const evaluationDir = this.evaluationDir(evaluationId);
    const artifactPath = resolve(evaluationDir, rawName);
    if (!artifactPath.startsWith(`${evaluationDir}/`) || basename(artifactPath) !== rawName) {
      return 'invalid';
    }

    try {
      const stats = statSync(artifactPath);
      if (!stats.isFile()) {
        return undefined;
      }
      return {
        name: rawName,
        path: artifactPath,
        contentType: contentTypeFor(rawName),
        stream: createReadStream(artifactPath)
      };
    } catch {
      return undefined;
    }
  }

  private evaluationDir(evaluationId: string): string {
    return resolve(this.rootDir, evaluationId);
  }
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.json')) {
    return 'application/json';
  }
  if (name.endsWith('.html')) {
    return 'text/html';
  }
  if (name.endsWith('.txt') || name.endsWith('.llm')) {
    return 'text/plain';
  }
  return 'application/octet-stream';
}
