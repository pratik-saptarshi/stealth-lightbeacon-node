"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvaluatorRegistry = void 0;
exports.createDefaultEvaluatorRegistry = createDefaultEvaluatorRegistry;
const aeo_1 = require("../evaluators/aeo");
const accessibility_1 = require("../evaluators/accessibility");
const drupalSecurity_1 = require("../evaluators/drupalSecurity");
const geo_1 = require("../evaluators/geo");
const performance_1 = require("../evaluators/performance");
const seo_1 = require("../evaluators/seo");
const ux_1 = require("../evaluators/ux");
class EvaluatorRegistry {
    plugins = new Map();
    register(definition) {
        if (this.plugins.has(definition.id)) {
            throw new Error(`Duplicate evaluator plugin id: ${definition.id}`);
        }
        this.plugins.set(definition.id, definition);
    }
    list() {
        return this.sorted().map((plugin) => ({
            id: plugin.id,
            domain: plugin.domain,
            description: plugin.description,
            prerequisites: [...plugin.prerequisites],
            order: plugin.order
        }));
    }
    createEvaluators() {
        return this.sorted().map((plugin) => plugin.create());
    }
    sorted() {
        return [...this.plugins.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }
}
exports.EvaluatorRegistry = EvaluatorRegistry;
function createDefaultEvaluatorRegistry() {
    const registry = new EvaluatorRegistry();
    registry.register({
        id: 'performance',
        domain: 'Performance',
        description: 'Evaluates Core Web Vitals and baseline page performance signals.',
        prerequisites: ['pagespeed'],
        order: 10,
        create: () => new performance_1.PerformanceEvaluator()
    });
    registry.register({
        id: 'seo',
        domain: 'SEO',
        description: 'Validates crawlability, metadata, canonicalization, and search visibility signals.',
        prerequisites: [],
        order: 20,
        create: () => new seo_1.SeoEvaluator()
    });
    registry.register({
        id: 'aeo',
        domain: 'AEO',
        description: 'Checks answer-engine metadata and concise answer structure.',
        prerequisites: [],
        order: 30,
        create: () => new aeo_1.AeoEvaluator()
    });
    registry.register({
        id: 'geo',
        domain: 'GEO',
        description: 'Evaluates authority, recency, and geographic trust indicators.',
        prerequisites: [],
        order: 40,
        create: () => new geo_1.GeoEvaluator()
    });
    registry.register({
        id: 'accessibility',
        domain: 'Accessibility',
        description: 'Detects accessibility issues including semantics, labels, and interaction affordances.',
        prerequisites: [],
        order: 50,
        create: () => new accessibility_1.AccessibilityEvaluator()
    });
    registry.register({
        id: 'ux',
        domain: 'UX',
        description: 'Assesses readability, viewport readiness, and interaction ergonomics.',
        prerequisites: [],
        order: 60,
        create: () => new ux_1.UxEvaluator()
    });
    registry.register({
        id: 'drupal-security',
        domain: 'Drupal Security',
        description: 'Finds Drupal-specific exposure and hardening gaps.',
        prerequisites: ['auxiliaryResponses.jsonApiUser'],
        order: 70,
        create: () => new drupalSecurity_1.DrupalSecurityEvaluator()
    });
    return registry;
}
