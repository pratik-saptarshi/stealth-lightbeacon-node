"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceWatcher = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const defaultScheduler = {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle)
};
class WorkspaceWatcher {
    workspaceRoot;
    debounceIntervalMs;
    debouncedTimer = null;
    changedFiles = new Set();
    watcher = null;
    scheduler;
    watch;
    onChange;
    constructor(workspaceRoot, debounceIntervalMs = 2000, options = {}) {
        this.workspaceRoot = workspaceRoot;
        this.debounceIntervalMs = debounceIntervalMs;
        this.scheduler = options.scheduler ?? defaultScheduler;
        this.watch = options.watch ?? node_fs_1.watch;
        this.onChange = options.onChange;
    }
    start() {
        console.log(`Starting WorkspaceWatcher on ${this.workspaceRoot}...`);
        this.watcher = this.watch((0, node_path_1.join)(this.workspaceRoot, 'src'), { recursive: true }, (eventType, filename) => {
            const changedFile = filename ? String(filename) : '';
            if (changedFile.endsWith('.ts') || changedFile.endsWith('.js')) {
                this.onFileChanged((0, node_path_1.join)('src', changedFile));
            }
        });
    }
    close() {
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
    onFileChanged(relativeFilePath) {
        this.changedFiles.add(relativeFilePath);
        if (this.debouncedTimer) {
            this.scheduler.clearTimeout(this.debouncedTimer);
        }
        this.debouncedTimer = this.scheduler.setTimeout(() => {
            this.triggerSync();
        }, this.debounceIntervalMs);
    }
    triggerSync() {
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
exports.WorkspaceWatcher = WorkspaceWatcher;
