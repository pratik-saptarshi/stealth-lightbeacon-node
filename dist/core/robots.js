"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RobotsPolicy = void 0;
const robots_parser_1 = __importDefault(require("robots-parser"));
class RobotsPolicy {
    parser;
    constructor(robotsUrl, content) {
        this.parser = (0, robots_parser_1.default)(robotsUrl, content);
    }
    isAllowed(userAgent, targetUrl) {
        return this.parser.isAllowed(targetUrl, userAgent) ?? true;
    }
    getSitemaps() {
        return this.parser.getSitemaps();
    }
}
exports.RobotsPolicy = RobotsPolicy;
