"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDuckDbPageSpeedCache = createDuckDbPageSpeedCache;
const cache_1 = require("./cache");
const schemas_1 = require("./db/schemas");
function createDuckDbPageSpeedCache(options) {
    const cache = new cache_1.DuckDbJsonCache(options.cachePath, schemas_1.pageSpeedSummarySchema);
    return {
        get: (key, ttlMs) => cache.get(key, ttlMs),
        set: (key, value) => cache.set(key, value),
        close: () => cache.close()
    };
}
