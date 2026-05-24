import { watch } from 'node:fs';
import { join } from 'node:path';

export class WorkspaceWatcher {
  private debouncedTimer: NodeJS.Timeout | null = null;
  private changedFiles = new Set<string>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly debounceIntervalMs: number = 2000
  ) {}

  public start() {
    console.log(`Starting WorkspaceWatcher on ${this.workspaceRoot}...`);
    watch(
      join(this.workspaceRoot, 'src'),
      { recursive: true },
      (eventType, filename) => {
        if (filename && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
          this.onFileChanged(join('src', filename));
        }
      }
    );
  }

  private onFileChanged(relativeFilePath: string) {
    this.changedFiles.add(relativeFilePath);
    if (this.debouncedTimer) {
      clearTimeout(this.debouncedTimer);
    }

    this.debouncedTimer = setTimeout(() => {
      this.triggerSync();
    }, this.debounceIntervalMs);
  }

  private triggerSync() {
    const filesToSync = Array.from(this.changedFiles);
    this.changedFiles.clear();
    this.debouncedTimer = null;

    console.log(`=== Debounce Trigger: Syncing ${filesToSync.length} files to LadybugDB ===`);
    for (const file of filesToSync) {
      console.log(`Syncing delta: ${file}`);
      // ast_context outliner data stream pipe to codegraph-rust / LadybugDB
    }
  }
}
