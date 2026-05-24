"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultEvaluators = createDefaultEvaluators;
const aeo_1 = require("../evaluators/aeo");
const accessibility_1 = require("../evaluators/accessibility");
const drupalSecurity_1 = require("../evaluators/drupalSecurity");
const geo_1 = require("../evaluators/geo");
const performance_1 = require("../evaluators/performance");
const seo_1 = require("../evaluators/seo");
const ux_1 = require("../evaluators/ux");
function createDefaultEvaluators() {
    return [
        new performance_1.PerformanceEvaluator(),
        new seo_1.SeoEvaluator(),
        new aeo_1.AeoEvaluator(),
        new geo_1.GeoEvaluator(),
        new accessibility_1.AccessibilityEvaluator(),
        new ux_1.UxEvaluator(),
        new drupalSecurity_1.DrupalSecurityEvaluator()
    ];
}
