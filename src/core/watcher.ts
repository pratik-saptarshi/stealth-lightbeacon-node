import { watch as fsWatch, type WatchEventType } from 'node:fs';
import { join } from 'node:path';

type TimerHandle = unknown;

export interface WatchScheduler {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface WatchHandle {
  close(): void;
}

export type WatchFunction = (
  pathToWatch: string,
  options: { recursive: boolean },
  listener: (eventType: WatchEventType, filename: string | Buffer | null) => void
) => WatchHandle;

export interface WorkspaceWatcherOptions {
  scheduler?: WatchScheduler;
  watch?: WatchFunction;
  onChange?: (relativeFilePaths: string[]) => void;
}

const defaultScheduler: WatchScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
};

export class WorkspaceWatcher {
  private debouncedTimer: TimerHandle | null = null;
  private changedFiles = new Set<string>();
  private watcher: WatchHandle | null = null;
  private readonly scheduler: WatchScheduler;
  private readonly watch: WatchFunction;
  private readonly onChange?: (relativeFilePaths: string[]) => void;

  constructor(
    private readonly workspaceRoot: string,
    private readonly debounceIntervalMs: number = 2000,
    options: WorkspaceWatcherOptions = {}
  ) {
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.watch = options.watch ?? fsWatch;
    this.onChange = options.onChange;
  }

  public start() {
    console.log(`Starting WorkspaceWatcher on ${this.workspaceRoot}...`);
    this.watcher = this.watch(
      join(this.workspaceRoot, 'src'),
      { recursive: true },
      (eventType, filename) => {
        const changedFile = filename ? String(filename) : '';
        if (changedFile.endsWith('.ts') || changedFile.endsWith('.js')) {
          this.onFileChanged(join('src', changedFile));
        }
      }
    );
  }

  public close() {
    if (this.debouncedTimer) {
      this.scheduler.clearTimeout(this.debouncedTimer);
      this.debouncedTimer = null;
    }

    this.changedFiles.clear();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private onFileChanged(relativeFilePath: string) {
    this.changedFiles.add(relativeFilePath);
    if (this.debouncedTimer) {
      this.scheduler.clearTimeout(this.debouncedTimer);
    }

    this.debouncedTimer = this.scheduler.setTimeout(() => {
      this.triggerSync();
    }, this.debounceIntervalMs);
  }

  private triggerSync() {
    const filesToSync = Array.from(this.changedFiles);
    this.changedFiles.clear();
    this.debouncedTimer = null;

    this.onChange?.(filesToSync);

    console.log(`=== Debounce Trigger: Syncing ${filesToSync.length} files to LadybugDB ===`);
    for (const file of filesToSync) {
      console.log(`Syncing delta: ${file}`);
      // ast_context outliner data stream pipe to codegraph-rust / LadybugDB
    }
  }
}
