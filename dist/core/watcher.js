"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceWatcher = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
class WorkspaceWatcher {
    workspaceRoot;
    debounceIntervalMs;
    debouncedTimer = null;
    changedFiles = new Set();
    constructor(workspaceRoot, debounceIntervalMs = 2000) {
        this.workspaceRoot = workspaceRoot;
        this.debounceIntervalMs = debounceIntervalMs;
    }
    start() {
        console.log(`Starting WorkspaceWatcher on ${this.workspaceRoot}...`);
        (0, node_fs_1.watch)((0, node_path_1.join)(this.workspaceRoot, 'src'), { recursive: true }, (eventType, filename) => {
            if (filename && (filename.endsWith('.ts') || filename.endsWith('.js'))) {
                this.onFileChanged((0, node_path_1.join)('src', filename));
            }
        });
    }
    onFileChanged(relativeFilePath) {
        this.changedFiles.add(relativeFilePath);
        if (this.debouncedTimer) {
            clearTimeout(this.debouncedTimer);
        }
        this.debouncedTimer = setTimeout(() => {
            this.triggerSync();
        }, this.debounceIntervalMs);
    }
    triggerSync() {
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
exports.WorkspaceWatcher = WorkspaceWatcher;
