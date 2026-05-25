"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultEvaluators = createDefaultEvaluators;
exports.listDefaultEvaluatorPlugins = listDefaultEvaluatorPlugins;
const evaluatorRegistry_1 = require("./evaluatorRegistry");
function createDefaultEvaluators() {
    return (0, evaluatorRegistry_1.createDefaultEvaluatorRegistry)().createEvaluators();
}
function listDefaultEvaluatorPlugins() {
    return (0, evaluatorRegistry_1.createDefaultEvaluatorRegistry)().list();
}
