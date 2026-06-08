"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtifactStore = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
class ArtifactStore {
    rootDir;
    constructor(rootDir) {
        this.rootDir = rootDir;
    }
    list(evaluationId) {
        const evaluationDir = this.evaluationDir(evaluationId);
        try {
            return (0, node_fs_1.readdirSync)(evaluationDir, { withFileTypes: true })
                .filter((entry) => entry.isFile())
                .map((entry) => {
                const artifactPath = (0, node_path_1.resolve)(evaluationDir, entry.name);
                return {
                    name: entry.name,
                    sizeBytes: (0, node_fs_1.statSync)(artifactPath).size,
                    contentType: contentTypeFor(entry.name)
                };
            })
                .sort((left, right) => left.name.localeCompare(right.name));
        }
        catch {
            return [];
        }
    }
    open(evaluationId, rawName) {
        const evaluationDir = this.evaluationDir(evaluationId);
        const artifactPath = (0, node_path_1.resolve)(evaluationDir, rawName);
        if (!artifactPath.startsWith(`${evaluationDir}/`) || (0, node_path_1.basename)(artifactPath) !== rawName) {
            return 'invalid';
        }
        try {
            const stats = (0, node_fs_1.statSync)(artifactPath);
            if (!stats.isFile()) {
                return undefined;
            }
            return {
                name: rawName,
                path: artifactPath,
                contentType: contentTypeFor(rawName),
                stream: (0, node_fs_1.createReadStream)(artifactPath)
            };
        }
        catch {
            return undefined;
        }
    }
    evaluationDir(evaluationId) {
        return (0, node_path_1.resolve)(this.rootDir, evaluationId);
    }
}
exports.ArtifactStore = ArtifactStore;
function contentTypeFor(name) {
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
